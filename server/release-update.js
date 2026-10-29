// Authenticated host console updates. Verify downloads before stopping the live game server.
// i18n-ignore-file: host-only console messages in Chinese, not player UI (same boundary as server/admin.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseManifest, parseUpdate, pathProblem, removalProblem, isSetupArt, verifyFiles, digestFile } from './update.js';
import { readZip, zipUnpackedSize } from './release-zip.js';
import { ART_STAGE_FILE, releaseTarget, readStagedArt, verifyStagedArt } from './release-art.js';
import { RELEASE_TAG } from './release-version.js';
import { SIGNATURE_ASSET, SUMS_ASSET, parseSignature, sumFor, verifySums } from './release-signing.js';
import { fetch as networkFetch, ProxyAgent } from 'undici';
import { DEFAULT_GITHUB_PROXY, normalizeProxyPrefix } from '../tools/assets/sources.mjs';
import { assertUpdateSpace } from './update-backups.js';
import { pickLauncherAsset, stageLauncherArchive, launcherTargets, launcherReceiptMatches } from './release-launcher.js';
import { parseSplitIndex } from './release-split.js';

export const UPDATE_REPOSITORY = 'zhewang448/Stronghold-Protocol';
const API = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases`;
const HEADERS = { accept: 'application/vnd.github+json', 'user-agent': 'Stronghold-Protocol-console' };
const BUSY = new Set(['checking', 'downloading', 'verifying', 'scheduled', 'validating', 'starting', 'rolling-back']);
const TAG = /^v?(\d+)\.(\d+)\.(\d+)(?:-extended\.(\d+))?$/;
export const updatePaths = (root) => ({
  lock: path.join(root, 'logs', 'release-update.lock'),
  status: path.join(root, 'logs', 'release-update-status.json'),
  version: path.join(root, 'logs', 'release-version.json'),
  network: path.join(root, 'logs', 'release-network.json'),
});
export function saveUpdateStatus(root, status) {
  const file = updatePaths(root).status;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(status)); fs.renameSync(file + '.tmp', file);
}
function appVersion(root) { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; }
export function installedIdentity(root) {
  const file = ['server/release-version.js', 'server/index.js'].find((rel) => fs.existsSync(path.join(root, rel)));
  return file ? crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') : null;
}
export function installedTag(root) {
  try {
    const saved = JSON.parse(fs.readFileSync(updatePaths(root).version, 'utf8'));
    if (saved.app === appVersion(root) && TAG.test(saved.tag)
      && (saved.sourceHash ? saved.sourceHash === installedIdentity(root) : compareReleaseTags(saved.tag, RELEASE_TAG) >= 0)) return saved.tag;
  } catch { /* first install */ }
  return RELEASE_TAG;
}
export function compareReleaseTags(a, b) {
  const x = TAG.exec(a), y = TAG.exec(b);
  if (!x || !y) throw new Error('无法识别扩展 Release 版本号');
  for (let i = 1; i <= 4; i++) {
    const d = Number(x[i] || 0) - Number(y[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
export function pickReleaseAsset(release) {
  // Only the full package can supply extracted scenes, effects and their matching manifests.
  const assets = Array.isArray(release.assets) ? release.assets : [];
  return assets.find((a) => /^Stronghold-Protocol-v\d+\.\d+\.\d+(?:-extended\.\d+)?-assets\.zip$/.test(a.name));
}
export function pickReleaseUpdateAsset(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  return assets.find((a) => /^Stronghold-Protocol-v[^/\\]+-update\.zip$/.test(a.name));
}
function preferredUpdate(release, currentTag) {
  const signed = [SUMS_ASSET, SIGNATURE_ASSET].every((name) => release.assets?.some((a) => a.name === name));
  const asset = signed && compareReleaseTags(release.tag_name, currentTag) > 0 ? pickReleaseUpdateAsset(release) : null;
  if (!asset) return null;
  try { assetUrl(asset); return asset; } catch { return null; }
}
function assetUrl(asset) {
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.username || url.password || url.host !== 'github.com' || !url.pathname.startsWith(`/${UPDATE_REPOSITORY}/releases/download/`)) {
    throw new Error('安装包下载地址不属于拓展仓库');
  }
  return url.href;
}
async function responseFor(url, fetchImpl, timeout = 30000) {
  const r = await fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`GitHub 请求失败：HTTP ${r.status}`);
  return r;
}
export function normalizeUpdateNetwork(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('更新网络配置格式错误');
  let proxy = String(value.proxy ?? '').trim();
  if (proxy) {
    let url;
    try { url = new URL(proxy); } catch { throw new Error('代理地址必须是 HTTP 或 HTTPS URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('代理须为 HTTP/HTTPS 地址，不能包含账号、密码、路径或查询参数');
    }
    proxy = url.href;
  }
  let mirror;
  try { mirror = normalizeProxyPrefix(String(value.mirror ?? DEFAULT_GITHUB_PROXY)); }
  catch { throw new Error('镜像前缀须为 HTTPS 地址，不能包含账号、密码、查询参数或片段'); }
  return { proxy, mirror };
}

/** Retry the entire consumer, including JSON parsing, streaming and SHA checks, through the mirror. */
export function createUpdateRequest(config, { fetchImpl = networkFetch, onSource = () => {} } = {}) {
  return async (url, consume, timeout = 30000) => {
    const routes = [{ url, source: config.proxy ? 'proxy' : 'direct', proxy: config.proxy }];
    if (config.mirror) routes.push({ url: `${config.mirror}${url}`, source: 'mirror' });
    let last;
    for (const route of routes) {
      const agent = route.proxy ? new ProxyAgent(route.proxy) : null;
      const headersController = new AbortController();
      const timer = setTimeout(() => headersController.abort(), 12000);
      let response;
      try {
        onSource(route.source);
        response = await fetchImpl(route.url, { headers: HEADERS,
          signal: AbortSignal.any([headersController.signal, AbortSignal.timeout(timeout)]), ...(agent ? { dispatcher: agent } : {}) });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await consume(response, route.source);
      } catch (e) { last = e; }
      finally {
        clearTimeout(timer);
        try { await response?.body?.cancel(); } catch { /* consumed or stream already closed */ }
        if (agent) await agent.destroy();
      }
    }
    throw new Error(`${config.mirror ? 'GitHub 和镜像访问均失败' : 'GitHub 访问失败'}：${last?.message || last}`);
  };
}
const skip = (rel) => isSetupArt(rel) || removalProblem(rel) !== null;

/** Only manifest-listed program files may be installed; reject traversal, duplicates and incremental archives. */
export function stageZip(zip, stage, releaseTag, { root = null, allowIncompleteArt = false } = {}) {
  const seen = new Set();
  const art = new Map();
  const checkedParents = new Set();
  let manifestText;
  fs.mkdirSync(stage, { recursive: true });
  readZip(zip, (name, data) => {
    if (pathProblem(name) || !name.startsWith('Stronghold-Protocol/')) throw new Error(`压缩包包含非法路径：${name}`);
    const rel = name.slice('Stronghold-Protocol/'.length);
    const key = rel.toLowerCase();
    if (seen.has(key)) throw new Error(`压缩包包含重复文件：${rel}`);
    seen.add(key);
    if (rel === 'UPDATE.json') throw new Error('必须使用完整素材包，不能使用增量更新包');
    if (rel === ART_STAGE_FILE) throw new Error('安装包包含保留的素材暂存清单');
    if (rel === 'MANIFEST.json') manifestText = data.toString('utf8');
    else if (isSetupArt(rel) && !removalProblem(rel)) {
      const digest = { size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
      art.set(rel, digest);
      const local = root ? digestFile(releaseTarget(root, rel, checkedParents)) : null;
      if (local?.size === digest.size && local.sha256 === digest.sha256) return;
    }
    else if (skip(rel)) return;
    const target = path.join(stage, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  });
  if (!manifestText) throw new Error('更新包缺少 MANIFEST.json');
  const manifest = parseManifest(manifestText);
  const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
  if (pkg.version !== manifest.app || TAG.exec(releaseTag)?.slice(1, 4).join('.') !== manifest.app) {
    throw new Error('更新包基础版本与 Release 标签或 MANIFEST.json 不一致');
  }
  const expected = new Map();
  for (const [rel, digest] of manifest.files) {
    if (skip(rel)) throw new Error(`程序清单包含本机保留路径：${rel}`);
    expected.set(rel, digest);
  }
  const listed = new Set([...expected.keys()].map((rel) => rel.toLowerCase()));
  for (const key of seen) {
    if (key === 'manifest.json' || skip(key)) continue;
    if (!listed.has(key)) throw new Error(`文件不在程序清单中：${key}`);
  }
  for (const required of ['package.json', 'server/index.js']) if (!expected.has(required)) throw new Error(`程序清单缺少 ${required}`);
  const result = verifyFiles(stage, expected);
  if (result.missing.length || result.mismatched.length) throw new Error(`文件校验失败：${[...result.missing, ...result.mismatched].slice(0, 3).join('、')}`);
  fs.writeFileSync(path.join(stage, ART_STAGE_FILE), JSON.stringify({ format: 1, app: manifest.app, files: Object.fromEntries(art) }));
  if (!allowIncompleteArt) verifyStagedArt(root || stage, stage, readStagedArt(stage, manifest.app));
  return manifest;
}

/** Build a complete transactional stage from a signed delta and the installed files it leaves unchanged. */
export function stageUpdateZip(zip, stage, releaseTag, root, { baseTag = installedTag(root), previousStages = [], consolidate = false } = {}) {
  const seen = new Set();
  const shipped = new Map();
  let manifestText, updateText;
  fs.mkdirSync(stage, { recursive: true });
  readZip(zip, (name, data) => {
    if (pathProblem(name) || !name.startsWith('Stronghold-Protocol/')) throw new Error(`压缩包包含非法路径：${name}`);
    const rel = name.slice('Stronghold-Protocol/'.length), key = rel.toLowerCase();
    if (seen.has(key)) throw new Error(`压缩包包含重复文件：${rel}`);
    seen.add(key);
    if (rel === 'MANIFEST.json') manifestText = data.toString('utf8');
    else if (rel === 'UPDATE.json') updateText = data.toString('utf8');
    else {
      if (rel === ART_STAGE_FILE || removalProblem(rel)) throw new Error(`增量包包含保留路径：${rel}`);
      const target = path.join(stage, ...rel.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
      shipped.set(rel, { size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
    }
  });
  if (!manifestText || !updateText) throw new Error('增量包缺少 MANIFEST.json 或 UPDATE.json');
  const manifest = parseManifest(manifestText), update = parseUpdate(updateText);
  if (manifest.app !== update.app || TAG.exec(releaseTag)?.slice(1, 4).join('.') !== manifest.app) throw new Error('增量包基础版本与 Release 标签不一致');
  if (compareReleaseTags(releaseTag, baseTag) <= 0) throw new Error('回退和同版修复必须使用完整素材包');
  if (update.tag && update.tag !== releaseTag) throw new Error('增量包目标标签与 Release 不一致');
  const baseRoot = previousStages.at(-1) || root;
  const baseVersion = appVersion(baseRoot);
  if (!update.from.includes(baseVersion)) throw new Error(`增量包不适用于当前基础版本 v${baseVersion}`);
  if (update.fromTags && !update.fromTags.includes(baseTag)) throw new Error('增量包不适用于当前扩展版本');
  if (!update.art) throw new Error('增量包缺少完整目标素材哈希清单');
  const art = update.art;
  for (const rel of art.keys()) if (!isSetupArt(rel) || removalProblem(rel)) throw new Error(`素材清单包含非法路径：${rel}`);
  for (const rel of manifest.files.keys()) if (isSetupArt(rel) || removalProblem(rel)) throw new Error(`程序清单包含保留路径：${rel}`);
  const target = new Map([...manifest.files, ...art]);
  const names = new Set(['manifest.json', 'update.json', ART_STAGE_FILE.toLowerCase(), '.update-applied.json']);
  for (const rel of target.keys()) {
    if (names.has(rel.toLowerCase())) throw new Error(`目标清单包含重复文件：${rel}`);
    names.add(rel.toLowerCase());
  }
  let bytes = 0;
  for (const [rel, expected] of update.files) {
    const want = target.get(rel), got = shipped.get(rel);
    if (!want || want.size !== expected.size || want.sha256 !== expected.sha256) throw new Error(`增量包文件不在目标清单中：${rel}`);
    if (!got || got.size !== expected.size || got.sha256 !== expected.sha256) throw new Error(`增量包文件校验失败：${rel}`);
    bytes += expected.size;
  }
  for (const rel of shipped.keys()) if (!update.files.has(rel)) throw new Error(`增量包包含未列出的文件：${rel}`);
  if (update.count !== shipped.size || update.bytes !== bytes) throw new Error('增量包文件数量或总大小不符');
  for (const required of ['package.json', 'server/index.js']) if (!manifest.files.has(required)) throw new Error(`程序清单缺少 ${required}`);
  const checkedParents = new Set();
  for (const [rel, expected] of manifest.files) {
    if (!shipped.has(rel)) {
      const source = releaseTarget(baseRoot, rel, checkedParents), got = digestFile(source);
      if (!got || got.size !== expected.size || got.sha256 !== expected.sha256) throw new Error(`本机文件与增量包基线不符：${rel}`);
      const file = path.join(stage, ...rel.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.copyFileSync(source, file);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
  if (pkg.version !== manifest.app) throw new Error('增量包程序版本与 MANIFEST.json 不一致');
  const checked = verifyFiles(stage, manifest.files);
  if (checked.missing.length || checked.mismatched.length) throw new Error('增量包合并后程序校验失败');
  fs.writeFileSync(path.join(stage, 'MANIFEST.json'), manifestText);
  fs.writeFileSync(path.join(stage, ART_STAGE_FILE), JSON.stringify({ format: 1, app: manifest.app, files: Object.fromEntries(art) }));
  verifyStagedArt(root, stage, readStagedArt(stage, manifest.app), { previousStages });
  if (consolidate) {
    for (const [rel, expected] of art) {
      const staged = path.join(stage, ...rel.split('/'));
      if (fs.existsSync(staged)) continue;
      const original = digestFile(releaseTarget(root, rel));
      if (original?.size === expected.size && original.sha256 === expected.sha256) continue;
      const source = [...previousStages].reverse().map(dir => releaseTarget(dir, rel)).find(file => {
        const got = digestFile(file);
        return got?.size === expected.size && got.sha256 === expected.sha256;
      });
      if (!source) throw new Error(`增量链缺少目标素材：${rel}`);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      fs.copyFileSync(source, staged);
    }
    verifyStagedArt(root, stage, art);
  }
  return manifest;
}

/** Keep ongoing matches responsive while the authenticated archive is unpacked and hashed. */
export function stageReleaseArchive(zip, stage, tag, root, incremental = false, options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./release-stage-worker.js', import.meta.url), {
      workerData: { zip, stage, tag, root, incremental, options }, execArgv: [],
    });
    let result, failure;
    worker.once('message', value => { result = value; });
    worker.once('error', error => { failure = error; });
    // Wait for exit before retrying or cleaning the staging directory after an error.
    worker.once('exit', code => {
      if (failure) reject(failure);
      else if (code !== 0 || !result) reject(new Error('素材校验工作线程提前退出'));
      else resolve(result);
    });
  });
}

export function planUpdateRoute(currentTag, targetTag, candidates) {
  const queue = [{ tag: currentTag, bytes: 0, route: [] }], best = new Map();
  while (queue.length) {
    queue.sort((left, right) => left.bytes - right.bytes || left.route.length - right.route.length || left.tag.localeCompare(right.tag));
    const next = queue.shift();
    if (best.has(next.tag) && best.get(next.tag) <= next.bytes) continue;
    best.set(next.tag, next.bytes);
    if (next.tag === targetTag) return next.route;
    for (const candidate of candidates) {
      if (!Array.isArray(candidate.fromTags) || !candidate.fromTags.includes(next.tag)
        || !Number.isSafeInteger(candidate.size) || candidate.size < 0
        || (candidate.remaining !== undefined && (!Number.isSafeInteger(candidate.remaining) || candidate.remaining < 0))) continue;
      if (candidate.requiresStartup && candidate.tag !== targetTag) continue;
      if (compareReleaseTags(candidate.tag, next.tag) <= 0 || compareReleaseTags(candidate.tag, targetTag) > 0) continue;
      queue.push({ tag: candidate.tag, bytes: next.bytes + (candidate.remaining ?? candidate.size), route: [...next.route, candidate.tag] });
    }
  }
  return null;
}

export function inspectUpdateZip(zip, tag) {
  let update = null, manifest = null, requiresStartup = false;
  readZip(zip, (name, bytes) => {
    if (name === 'Stronghold-Protocol/MANIFEST.json') {
      if (manifest || bytes.length > 32 * 1024 * 1024) throw new Error('程序清单重复或过大');
      manifest = parseManifest(bytes.toString('utf8'));
    }
    if (name !== 'Stronghold-Protocol/UPDATE.json') return;
    if (update || bytes.length > 32 * 1024 * 1024) throw new Error('增量包元数据重复或过大');
    const text = bytes.toString('utf8'), raw = JSON.parse(text);
    if (raw.requiresStartup !== undefined && typeof raw.requiresStartup !== 'boolean') throw new Error('增量包启动要求无效');
    requiresStartup = raw.requiresStartup === true;
    update = parseUpdate(text);
  });
  if (!update || !manifest || manifest.app !== update.app || !update.fromTags || !update.tag || update.tag !== tag || !update.art) throw new Error('增量包缺少适用版本信息');
  const programBytes = [...manifest.files.values()].reduce((sum, file) => sum + file.size, 0);
  if (!Number.isSafeInteger(programBytes)) throw new Error('增量包程序大小无效');
  return { tag, fromTags: update.fromTags, requiresStartup, programBytes };
}

function inspectReleaseArchive(zip, tag) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./release-stage-worker.js', import.meta.url), {
      workerData: { zip, tag, inspect: true }, execArgv: [],
    });
    let result, failure;
    worker.once('message', value => { result = value; });
    worker.once('error', error => { failure = error; });
    worker.once('exit', code => {
      if (failure) reject(failure);
      else if (code !== 0 || !result) reject(new Error('增量包检查线程提前退出'));
      else resolve(result);
    });
  });
}

function runSplitWorker(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./release-stage-worker.js', import.meta.url), { workerData: data, execArgv: [] });
    let result, failure;
    worker.once('message', value => { result = value; });
    worker.once('error', error => { failure = error; });
    worker.once('exit', code => {
      if (failure) reject(failure);
      else if (code !== 0 || !result) reject(new Error('素材分包检查线程提前退出'));
      else resolve(result);
    });
  });
}

const UNSIGNED_VIA_MIRROR = '该版本没有发布签名，只能在直连或代理访问 GitHub 时安装';

async function readBounded(response, maximum) {
  if (!response.body || Number(response.headers.get('content-length') || 0) > maximum) throw new Error('更新索引过大或为空');
  const chunks = []; let size = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    size += chunk.length;
    if (size > maximum) throw new Error('更新索引过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * The expected ZIP SHA-256. A signed release (SHA256SUMS.txt.sig) may come through any route: the signature anchors
 * the checksums. An unsigned one is trusted only when the Release list and the checksum both came from GitHub
 * itself (direct or through the host's own proxy), never from the mirror.
 */
async function expectedHash({ release, asset, request, listing, keys }) {
  const sums = release.assets?.find((a) => a.name === SUMS_ASSET);
  const sig = release.assets?.find((a) => a.name === SIGNATURE_ASSET);
  if (sig) {
    if (!sums) throw new Error('签名附件缺少对应的 SHA256SUMS.txt');
    const signature = await request(assetUrl(sig), async (r) => parseSignature(await r.text()));
    return request(assetUrl(sums), async (r) => {
      const bytes = Buffer.from(await r.arrayBuffer());
      if (!verifySums(release.tag_name, bytes, signature, keys)) throw new Error('发布签名校验失败');
      return sumFor(bytes.toString('utf8'), asset.name);
    });
  }
  if (listing === 'mirror') throw new Error(UNSIGNED_VIA_MIRROR);
  if (sums) {
    return request(assetUrl(sums), async (r, source) => {
      if (source === 'mirror') throw new Error(UNSIGNED_VIA_MIRROR);
      return sumFor(await r.text(), asset.name);
    });
  }
  if (/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '')) return asset.digest.slice(7).toLowerCase();
  throw new Error('Release 缺少 SHA-256 校验值，无法安装');
}

async function stageDeltaRoute({ root, work, release, releases, request, keys, progress, maxBytes = Infinity }) {
  const currentTag = installedTag(root), targetTag = release.tag_name;
  const all = new Map(releases.map(item => [item.tag_name, item]));
  all.set(targetTag, release);
  const pending = [targetTag], checked = new Set(), candidates = [], archives = new Map();
  const download = async (item, asset, zip) => {
    const want = await expectedHash({ release: item, asset, request, listing: 'mirror', keys });
    assertUpdateSpace(root, asset.size);
    await request(assetUrl(asset), async response => {
      if (!response.body) throw new Error('增量包响应为空');
      let received = 0;
      const hash = crypto.createHash('sha256');
      const meter = new Transform({ transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > asset.size) return callback(new Error('增量包大小不符'));
        hash.update(chunk);
        progress({ state: 'downloading', asset: asset.name, received, size: asset.size, routeDiscovery: true });
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(zip));
      if (received !== asset.size || hash.digest('hex') !== want) throw new Error('增量包哈希或大小不符');
    }, 15 * 60 * 1000);
    return inspectReleaseArchive(zip, item.tag_name);
  };
  let legacyBytes = 0;
  const fullSize = pickReleaseAsset(release)?.size;
  const discoveryBudget = Math.min(256 * 1024 * 1024, Number.isSafeInteger(fullSize) && fullSize > 0 ? fullSize : Infinity);
  while (pending.length && checked.size < 128) {
    const tag = pending.shift();
    if (checked.has(tag)) continue;
    checked.add(tag);
    const item = all.get(tag), asset = item && preferredUpdate(item, currentTag);
    if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0) continue;
    const zip = path.join(work, `delta-${checked.size}.zip`);
    try {
      const indexAsset = item.assets.find(entry => entry.name === `Stronghold-Protocol-${tag}-update-index.json`);
      let metadata;
      if (indexAsset) {
        const expected = await expectedHash({ release: item, asset: indexAsset, request, listing: 'mirror', keys });
        metadata = await request(assetUrl(indexAsset), async response => {
          const bytes = await readBounded(response, 1024 * 1024);
          if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('更新索引哈希不符');
          const value = JSON.parse(bytes.toString('utf8'));
          if (value.format !== 1 || value.tag !== tag || value.archive !== asset.name || value.size !== asset.size
            || !/^[a-f0-9]{64}$/.test(value.sha256 || '') || !Array.isArray(value.fromTags)
            || !value.fromTags.every(base => typeof base === 'string' && /^v\d+\.\d+\.\d+(?:-extended\.\d+)?$/.test(base))
            || (value.requiresStartup !== undefined && typeof value.requiresStartup !== 'boolean')) throw new Error('更新索引格式错误');
          return value;
        });
      } else {
        if (legacyBytes + asset.size > discoveryBudget) continue;
        metadata = await download(item, asset, zip);
        legacyBytes += asset.size;
      }
      candidates.push({ ...metadata, size: asset.size, remaining: indexAsset ? asset.size : 0 });
      archives.set(tag, { zip, asset, item, metadata, downloaded: !indexAsset });
      if (tag === targetTag && metadata.fromTags.includes(currentTag) && indexAsset && asset.size >= maxBytes) return null;
      for (const base of metadata.fromTags) {
        if (compareReleaseTags(base, currentTag) > 0 && compareReleaseTags(base, tag) < 0 && all.has(base)) pending.push(base);
      }
    } catch (error) {
      fs.rmSync(zip, { force: true });
      if (tag === targetTag) throw error;
    }
  }
  const route = planUpdateRoute(currentTag, targetTag, candidates);
  if (!route?.length) {
    const blocked = planUpdateRoute(currentTag, targetTag, candidates.map(candidate => ({ ...candidate, requiresStartup: false })));
    if (blocked?.length) {
      const error = new Error('中间版本需要先启动并完成数据迁移，请先单独安装该版本');
      error.code = 'UPDATE_REQUIRES_STARTUP';
      throw error;
    }
    return null;
  }
  const remainingBytes = route.reduce((sum, tag) => sum + (archives.get(tag).downloaded ? 0 : archives.get(tag).asset.size), 0);
  if (remainingBytes >= maxBytes) return null;
  const previousStages = [];
  let baseTag = currentTag, manifest;
  for (const [index, tag] of route.entries()) {
    const archive = archives.get(tag);
    if (!archive.downloaded) {
      const actual = await download(archive.item, archive.asset, archive.zip);
      if (JSON.stringify([...actual.fromTags].sort()) !== JSON.stringify([...archive.metadata.fromTags].sort())
        || actual.requiresStartup !== (archive.metadata.requiresStartup === true)
        || digestFile(archive.zip)?.sha256 !== archive.metadata.sha256) throw new Error('增量包与签名索引不符');
      archive.metadata.programBytes = actual.programBytes;
    }
    assertUpdateSpace(root, archive.metadata.programBytes + zipUnpackedSize(archive.zip));
    const stage = path.join(work, index === route.length - 1 ? 'Stronghold-Protocol' : `chain-${index}`);
    progress({ state: 'verifying', asset: archive.asset.name, route, routeStep: index + 1, routeTotal: route.length });
    manifest = await stageReleaseArchive(archive.zip, stage, tag, root, true, {
      baseTag, previousStages, consolidate: index === route.length - 1,
    });
    previousStages.push(stage);
    baseTag = tag;
  }
  return { stage: previousStages.at(-1), app: manifest.app, tag: targetTag,
    asset: archives.get(targetTag).asset.name, route };
}

async function stageSplitRelease({ root, work, release, request, keys, progress, full, planOnly = false, cachedPlan = null }) {
  const tag = release.tag_name, assets = release.assets || [];
  const indexAsset = assets.find(asset => asset.name === `Stronghold-Protocol-${tag}-art-index.json`);
  const lite = assets.find(asset => asset.name === `Stronghold-Protocol-${tag}-lite.zip`);
  if (!indexAsset || !lite || !assets.some(asset => asset.name === SIGNATURE_ASSET)) return null;
  let text = cachedPlan?.text, index = cachedPlan?.index, initial = cachedPlan?.initial;
  if (!cachedPlan) {
    const wantedIndex = await expectedHash({ release, asset: indexAsset, request, listing: 'mirror', keys });
    text = await request(assetUrl(indexAsset), async response => {
      const bytes = await readBounded(response, 32 * 1024 * 1024);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== wantedIndex) throw new Error('素材索引哈希不符');
      return bytes.toString('utf8');
    });
    index = parseSplitIndex(text, tag);
    initial = await runSplitWorker({ root, tag, splitIndex: text, planSplit: true });
  }
  const groupAsset = group => {
    const asset = assets.find(item => item.name === index.groups.get(group));
    if (!asset) throw new Error(`缺少素材分包：${group}`);
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error('素材分包大小未知');
    return asset;
  };
  if (!Number.isSafeInteger(lite.size) || lite.size <= 0) throw new Error('精简包大小未知');
  const estimate = initial.needed.reduce((total, group) => {
    const missing = initial.missing.filter(rel => index.files.get(rel).group === group && rel !== 'data/assets.json');
    if (!missing.length) return total;
    const asset = groupAsset(group), rawBytes = missing.reduce((sum, rel) => sum + index.files.get(rel).size, 0);
    const publicSources = group === 'common' && missing.length <= 64 && rawBytes <= 128 * 1024 * 1024
      && missing.every(rel => index.files.get(rel).source && index.files.get(rel).size <= 32 * 1024 * 1024);
    return total + (publicSources ? Math.min(rawBytes, asset.size) : asset.size);
  }, lite.size);
  if (full && Number.isSafeInteger(full.size) && full.size > 0 && estimate >= full.size) return null;
  if (planOnly) return { text, index, initial, estimate };
  const download = async (asset, filename) => {
    const want = await expectedHash({ release, asset, request, listing: 'mirror', keys });
    assertUpdateSpace(root, asset.size);
    await request(assetUrl(asset), async response => {
      if (!response.body) throw new Error('分包响应为空');
      let received = 0;
      const hash = crypto.createHash('sha256');
      const meter = new Transform({ transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > asset.size) return callback(new Error('分包大小不符'));
        hash.update(chunk);
        progress({ state: 'downloading', asset: asset.name, received, size: asset.size, split: true });
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(filename));
      if (received !== asset.size || hash.digest('hex') !== want) throw new Error('分包哈希或大小不符');
    }, 15 * 60 * 1000);
  };
  const zip = path.join(work, 'split.zip'), stage = path.join(work, 'Stronghold-Protocol');
  await download(lite, zip);
  assertUpdateSpace(root, zipUnpackedSize(zip));
  const manifest = await stageReleaseArchive(zip, stage, tag, root, false, { allowIncompleteArt: true });
  if (manifest.app !== index.app) throw new Error('精简包与素材索引版本不符');
  let sourcedBytes = 0;
  let plan = await runSplitWorker({ root, stage, tag, splitIndex: text, planSplit: true });
  const common = plan.missing.filter(rel => index.files.get(rel).group === 'common');
  const commonBytes = common.reduce((sum, rel) => sum + index.files.get(rel).size, 0);
  if (common.length && common.length <= 64 && commonBytes <= 128 * 1024 * 1024
    && common.every(rel => index.files.get(rel).source && index.files.get(rel).size <= 32 * 1024 * 1024)
    && commonBytes < groupAsset('common').size) {
    for (const rel of common) {
      const expected = index.files.get(rel);
      try {
        const bytes = await request(expected.source, async response => {
          if (!response.body) throw new Error('公开素材响应为空');
          const parts = []; let size = 0;
          for await (const chunk of Readable.fromWeb(response.body)) {
            size += chunk.length;
            if (size > expected.size) throw new Error('公开素材大小不符');
            parts.push(chunk);
          }
          const data = Buffer.concat(parts);
          if (data.length !== expected.size || crypto.createHash('sha256').update(data).digest('hex') !== expected.sha256) throw new Error('公开素材哈希不符');
          return data;
        });
        const target = releaseTarget(stage, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
        sourcedBytes += bytes.length;
        progress({ state: 'downloading', asset: rel, received: bytes.length, size: bytes.length, split: true });
      } catch { break; }
    }
    plan = await runSplitWorker({ root, stage, tag, splitIndex: text, planSplit: true });
  }
  const groupAssets = plan.needed.map(group => ({ group, asset: groupAsset(group) }));
  const bytes = lite.size + sourcedBytes + groupAssets.reduce((total, item) => total + item.asset.size, 0);
  if (full && Number.isSafeInteger(full.size) && full.size > 0 && bytes >= full.size) throw new Error('完整包比素材分包更小');
  for (const { group, asset } of groupAssets) {
    await download(asset, zip);
    assertUpdateSpace(root, zipUnpackedSize(zip));
    progress({ state: 'verifying', asset: asset.name, split: true });
    await runSplitWorker({ zip, root, stage, tag, splitIndex: text, splitGroup: group });
  }
  await runSplitWorker({ root, stage, tag, splitIndex: text, finishSplit: true });
  fs.rmSync(zip, { force: true });
  return { stage, app: manifest.app, tag, asset: lite.name, split: true, groups: plan.needed, downloadBytes: bytes };
}

/** Stream with backpressure, verify published ZIP SHA-256, then verify individual program files. */
export async function downloadAndStage({ root, release, fetchImpl = fetch, listing = 'direct', keys, progress = () => {}, platform = process.platform,
  releases = [], request = async (url, consume, timeout) => consume(await responseFor(url, fetchImpl, timeout), 'direct') }) {
  const full = pickReleaseAsset(release);
  const installed = installedTag(root);
  const delta = preferredUpdate(release, installed);
  const candidates = [...(delta ? [delta] : []), ...(full ? [full] : [])];
  if (!candidates.length && !release.assets?.some(asset => asset.name === `Stronghold-Protocol-${release.tag_name}-art-index.json`)) {
    throw new Error('这个 Release 缺少完整素材包，无法保证素材完整');
  }
  const base = path.join(root, 'logs', 'update-staging');
  fs.mkdirSync(base, { recursive: true });
  const work = fs.mkdtempSync(path.join(base, 'release-'));
  const zip = path.join(work, 'release.zip');
  try {
    let lastError;
    let routed = null;
    let split = null;
    let splitPlan = null;
    if (releases.length || !delta) {
      try { splitPlan = await stageSplitRelease({ root, work, release, request, keys, progress, full, planOnly: true }); }
      catch (error) { lastError = error; }
    }
    if (delta && releases.length) {
      const fullSize = Number.isSafeInteger(full?.size) && full.size > 0 ? full.size : Infinity;
      try { routed = await stageDeltaRoute({ root, work, release, releases, request, keys, progress, maxBytes: Math.min(fullSize, splitPlan?.estimate ?? Infinity) }); }
      catch (error) {
        if (error.code === 'UPDATE_REQUIRES_STARTUP') throw error;
        lastError = error;
      }
      if (!routed) {
        candidates.splice(0, candidates.length, ...(full ? [full] : []));
        if (full) progress({ state: 'downloading', received: 0, size: full.size || 0, fallback: true,
          fallbackReason: lastError?.message || '没有可用的增量更新路径', asset: full.name,
          route: undefined, routeStep: undefined, routeTotal: undefined });
      }
    }
    if (!routed && splitPlan) {
      try {
        fs.rmSync(path.join(work, 'Stronghold-Protocol'), { recursive: true, force: true });
        split = await stageSplitRelease({ root, work, release, request, keys, progress, full, cachedPlan: splitPlan });
        if (split) {
          candidates.unshift(release.assets.find(asset => asset.name === split.asset));
          progress({ state: 'verifying', asset: split.asset, split: true, fallback: false, fallbackReason: undefined,
            route: undefined, routeStep: undefined, routeTotal: undefined });
        }
      } catch (error) {
        lastError = error;
        fs.rmSync(path.join(work, 'Stronghold-Protocol'), { recursive: true, force: true });
        if (full) progress({ state: 'downloading', asset: full.name, received: 0, size: full.size || 0,
          split: false, fallback: true, fallbackReason: error.message });
      }
    }
    if (!candidates.length) throw lastError || new Error('没有可用的更新包');
    for (const asset of candidates) {
      let gameStaged = false;
      try {
        assertUpdateSpace(root, Number.isSafeInteger(asset.size) && asset.size > 0 ? asset.size : 0);
        const prepared = asset === delta && routed ? routed : split && asset?.name === split.asset ? split : null;
        const want = prepared ? null : await expectedHash({ release, asset, request, listing, keys });
        const staged = prepared || await request(assetUrl(asset), async (response) => {
          fs.rmSync(path.join(work, 'Stronghold-Protocol'), { recursive: true, force: true });
          if (!response.body) throw new Error('安装包响应为空');
          let received = 0;
          const hash = crypto.createHash('sha256');
          const meter = new Transform({ transform(chunk, _encoding, cb) {
            received += chunk.length; hash.update(chunk);
            progress({ state: 'downloading', received, size: asset.size || 0, asset: asset.name }); cb(null, chunk);
          } });
          await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(zip));
          if (asset.size && received !== asset.size) throw new Error('下载包大小不符，请重试');
          if (hash.digest('hex') !== want) throw new Error('安装包 SHA-256 校验失败，请重试');
          progress({ state: 'verifying', received, size: asset.size || received, asset: asset.name });
          assertUpdateSpace(root, zipUnpackedSize(zip));
          const stage = path.join(work, 'Stronghold-Protocol');
          const manifest = await stageReleaseArchive(zip, stage, release.tag_name, root, asset === delta);
          fs.rmSync(zip);
          return { stage, app: manifest.app, tag: release.tag_name, asset: asset.name };
        }, 15 * 60 * 1000);
        gameStaged = true;
        let launcher = { state: platform === 'win32' ? 'unavailable' : 'not-applicable' };
        const launcherAsset = platform === 'win32' ? pickLauncherAsset(release) : null;
        if (launcherAsset) {
          if (!release.assets?.some(a => a.name === SIGNATURE_ASSET)) throw new Error('启动器更新要求维护者发布签名，未安装任何文件');
          const wantLauncher = await expectedHash({ release, asset: launcherAsset, request, listing, keys });
          const targets = launcherTargets(root);
          const targetVersion = /^StrongholdProtocolLauncher-v(\d+\.\d+\.\d+)-win-x64\.zip$/.exec(launcherAsset.name)?.[1] || null;
          if (targets.every(target => launcherReceiptMatches(target, wantLauncher, targetVersion))) {
            launcher = { state: 'unchanged', asset: launcherAsset.name, paths: targets };
          } else {
            if (launcherAsset.size > 160 * 1024 * 1024) throw new Error('启动器附件过大');
            const launcherZip = path.join(work, 'launcher.zip');
            assertUpdateSpace(root, launcherAsset.size || 160 * 1024 * 1024);
            launcher = await request(assetUrl(launcherAsset), async response => {
              if (!response.body) throw new Error('启动器附件响应为空');
              let received = 0; const hash = crypto.createHash('sha256');
              const meter = new Transform({ transform(chunk, _encoding, callback) {
                received += chunk.length;
                if (received > 160 * 1024 * 1024) { callback(new Error('启动器附件过大')); return; }
                hash.update(chunk); progress({ state: 'downloading', launcher: { state: 'downloading', asset: launcherAsset.name },
                  asset: launcherAsset.name, received, size: launcherAsset.size || 0 }); callback(null, chunk);
              } });
              await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(launcherZip));
              if (launcherAsset.size && received !== launcherAsset.size) throw new Error('启动器附件大小不符');
              if (hash.digest('hex') !== wantLauncher) throw new Error('启动器附件 SHA-256 校验失败');
              const result = stageLauncherArchive(launcherZip, staged.stage, { tag: release.tag_name, asset: launcherAsset.name, zipHash: wantLauncher });
              fs.rmSync(launcherZip); return result;
            }, 10 * 60 * 1000);
          }
        }
        progress({ state: 'verifying', asset: staged.asset, received: 0, size: asset.size || 0, launcher });
        return { ...staged, launcher };
      } catch (e) {
        lastError = e;
        if (asset === delta && full && !gameStaged) {
          fs.rmSync(zip, { force: true });
          progress({ state: 'downloading', received: 0, size: full.size || 0, fallback: true, fallbackReason: e.message, asset: full.name });
          continue;
        }
        throw e;
      }
    }
    throw lastError || new Error('没有可用的更新包');
  } catch (e) { fs.rmSync(work, { recursive: true, force: true }); throw e; }
}

/** The installer must load and acknowledge startup before shutdown is allowed. */
export async function scheduleInstall({ root, stage, tag, parentPid = process.pid, port = Number(process.env.PORT) || 3000 }) {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'apply-release-update.mjs');
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(updatePaths(root).lock, JSON.stringify({ pid: parentPid, at: Date.now() }), { flag: 'wx', mode: 0o600 });
  try {
    const installer = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, root, stage, String(parentPid), tag], {
        cwd: root, env: { ...process.env, SP_UPDATE_PORT: String(port) }, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
      });
      const timer = setTimeout(() => { child.kill(); reject(new Error('更新安装器启动超时')); }, 10000);
      const fail = (e) => { clearTimeout(timer); reject(e); };
      child.once('error', fail);
      child.once('exit', () => fail(new Error('更新安装器提前退出')));
      child.once('message', (msg) => {
        if (msg !== 'ready') return;
        clearTimeout(timer);
        child.removeAllListeners('exit');
        child.disconnect();
        child.unref();
        resolve(child);
      });
    });
    return () => { installer.kill(); fs.rmSync(updatePaths(root).lock, { force: true }); };
  } catch (e) { fs.rmSync(updatePaths(root).lock, { force: true }); throw e; }
}

export function createReleaseUpdater({ root, port = Number(process.env.PORT) || 3000, log = console, onReady, hasActive = () => false,
  fetchImpl = networkFetch, stageRelease = downloadAndStage, schedule = scheduleInstall } = {}) {
  let current = { state: 'idle' }, releases = [], prepared = null, opened = false, checking = null, page = 0, hasMore = false;
  const listedVia = new Map(); // tag → route its Release entry was last listed through
  let network = normalizeUpdateNetwork({});
  try { network = normalizeUpdateNetwork(JSON.parse(fs.readFileSync(updatePaths(root).network, 'utf8'))); }
  catch { /* default on first launch or invalid saved settings */ }
  try {
    const last = JSON.parse(fs.readFileSync(updatePaths(root).status, 'utf8'));
    if (['error', 'recovery-required', 'starting', 'validating', 'rolling-back', 'installed'].includes(last.state)) current = last;
  } catch { /* no previous failure */ }
  function releaseView(release) {
    const full = pickReleaseAsset(release);
    const relation = compareReleaseTags(release.tag_name, installedTag(root));
    const delta = preferredUpdate(release, installedTag(root));
    const split = release.assets?.some(item => item.name === SIGNATURE_ASSET)
      && release.assets?.some(item => item.name === `Stronghold-Protocol-${release.tag_name}-art-index.json`)
      ? release.assets.find(item => item.name === `Stronghold-Protocol-${release.tag_name}-lite.zip`) : null;
    const asset = delta || full || split;
    let reason = '';
    let launcherAsset;
    try {
      if (!asset) throw new Error('缺少完整素材包，无法保证素材完整');
      const sums = release.assets?.find((a) => a.name === SUMS_ASSET);
      const sig = release.assets?.find((a) => a.name === SIGNATURE_ASSET);
      assetUrl(asset);
      if (sums) assetUrl(sums);
      if (sig) {
        assetUrl(sig);
        if (!sums) throw new Error('签名附件缺少对应的 SHA256SUMS.txt');
      } else if (listedVia.get(release.tag_name) === 'mirror') throw new Error(UNSIGNED_VIA_MIRROR);
      launcherAsset = process.platform === 'win32' ? pickLauncherAsset(release) : null;
      if (launcherAsset) {
        assetUrl(launcherAsset);
        if (!sig) throw new Error('包含启动器的更新必须提供发布签名');
      }
      if (!sums && !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '')
        && (!full || !/^sha256:[a-f0-9]{64}$/i.test(full.digest || ''))) throw new Error('缺少 SHA-256 校验值');
    } catch (e) { reason = e.message; }
    return { tag: release.tag_name, relation: relation > 0 ? 'new' : relation < 0 ? 'old' : 'current',
      asset: asset?.name, size: asset?.size || 0, publishedAt: release.published_at,
      fallbackAsset: delta ? full?.name : undefined, fallbackSize: delta ? (full?.size || 0) : undefined,
      launcherAsset: launcherAsset?.name,
      signed: !!release.assets?.some((a) => a.name === SIGNATURE_ASSET), installable: !reason, reason };
  }
  const status = () => {
    if (['starting', 'validating', 'rolling-back'].includes(current.state) || current.launcher?.state === 'pending') {
      try { const disk = JSON.parse(fs.readFileSync(updatePaths(root).status, 'utf8'));
        if (disk.tag === current.tag || (current.launcher?.state === 'pending' && disk.backup === current.backup)) current = disk;
      } catch {}
    }
    const versions = releases.map(releaseView);
    const currentVersion = installedTag(root);
    if (!versions.some((r) => r.relation === 'current')) versions.push({ tag: currentVersion, relation: 'current', installable: false });
    versions.sort((a, b) => compareReleaseTags(b.tag, a.tag));
    return { ...current, currentVersion, latestVersion: releases[0]?.tag_name, repository: UPDATE_REPOSITORY, canInstall: typeof onReady === 'function', versions, hasMore, network: { ...network } };
  };
  const request = (url, consume, timeout) => createUpdateRequest(network, { fetchImpl,
    onSource: (source) => { current = { ...current, source }; } })(url, consume, timeout);
  const fail = (e) => {
    current = { ...current, state: 'error', error: e?.message || String(e) };
    log.warn?.(`[update] ${current.error}`);
    try { saveUpdateStatus(root, current); } catch { /* still report the original failure through the API */ }
    return status();
  };
  async function routeReleases() {
    const currentTag = installedTag(root);
    while (hasMore && page < 5 && (!releases.length || compareReleaseTags(releases.at(-1).tag_name, currentTag) > 0)) {
      const nextPage = page + 1;
      try {
        const { data, via } = await request(`${API}?per_page=30&page=${nextPage}`, async (response, source) => {
          const found = await response.json();
          if (!Array.isArray(found) || found.some(item => !item || typeof item.tag_name !== 'string')) throw new Error('Release 列表响应格式错误');
          return { data: found, via: source };
        });
        const formal = data.filter(item => !item.draft && !item.prerelease && TAG.test(item.tag_name));
        for (const item of formal) listedVia.set(item.tag_name, via);
        releases = [...new Map([...releases, ...formal].map(item => [item.tag_name, item])).values()]
          .sort((left, right) => compareReleaseTags(right.tag_name, left.tag_name));
        page = nextPage;
        hasMore = data.length === 30;
      } catch { break; }
    }
    return releases;
  }
  async function launch(force) {
    if (hasActive() && !force) { current = { ...current, state: 'active-matches' }; return; }
    const cancel = await schedule({ root, port, ...prepared });
    current = { ...current, state: 'scheduled' };
    saveUpdateStatus(root, current);
    setTimeout(() => {
      // A room can start during the installer handshake or the UI's two-second notification window.
      if (hasActive() && !force) {
        cancel?.();
        current = { ...current, state: 'active-matches' };
        saveUpdateStatus(root, current);
      } else onReady();
    }, 2000).unref();
  }
  function check(more = false) {
    if (current.state === 'recovery-required') return Promise.resolve(status());
    if (checking) return checking;
    if (BUSY.has(current.state) || prepared || (more && !hasMore)) return Promise.resolve(status());
    const nextPage = more ? page + 1 : 1;
    current = { ...current, state: 'checking', error: undefined };
    checking = (async () => {
      try {
        const { data: found, via } = await request(`${API}?per_page=30&page=${nextPage}`, async (r, source) => {
          const data = await r.json();
          if (!Array.isArray(data) || data.some((v) => !v || typeof v !== 'object' || typeof v.tag_name !== 'string')) throw new Error('Release 列表响应格式错误');
          return { data, via: source };
        });
        hasMore = found.length === 30;
        page = nextPage;
        const formal = found.filter((r) => !r.draft && !r.prerelease && TAG.test(r.tag_name));
        for (const r of formal) listedVia.set(r.tag_name, via);
        releases = [...new Map([...(more ? releases : []), ...formal].map((r) => [r.tag_name, r])).values()]
          .sort((a, b) => compareReleaseTags(b.tag_name, a.tag_name));
        const latest = releases[0];
        const newer = latest && compareReleaseTags(latest.tag_name, installedTag(root)) > 0;
        current = { state: newer ? 'available' : 'up-to-date', tag: latest?.tag_name, source: current.source,
          ...(current.launcher ? { launcher: current.launcher, backup: current.backup, warning: current.warning } : {}) };
        return status();
      } catch (e) { return fail(e); }
      finally { checking = null; }
    })();
    return checking;
  }
  return {
    status, check,
    async open() {
      if (opened) return status();
      opened = true;
      const result = await check();
      return { ...result, notify: result.state === 'available' };
    },
    configure(value) {
      if (BUSY.has(current.state) || prepared) return { ...status(), error: '更新进行中，暂不能修改网络配置' };
      try {
        const next = normalizeUpdateNetwork(value);
        fs.mkdirSync(path.dirname(updatePaths(root).network), { recursive: true });
        fs.writeFileSync(updatePaths(root).network, JSON.stringify(next));
        network = next;
        current = { ...current, error: undefined };
        return { ...status(), saved: true };
      } catch (e) { return { ...status(), error: e.message }; }
    },
    install({ force = false, tag, allowDowngrade = false, repairAssets = false } = {}) {
      if (current.state === 'recovery-required') return { ...status(), error: '更新需要人工恢复，请按恢复说明操作后重新启动服务器。' };
      if (BUSY.has(current.state)) return status();
      if (current.launcher?.state === 'pending') return { ...status(), error: '启动器仍待替换，请先关闭启动器并等待完成后再安装其他版本。' };
      if (!onReady) return { ...status(), error: '当前启动方式不支持自动重启' };
      const release = releases.find((r) => r.tag_name === tag);
      if (!release) return { ...status(), error: '请先检查更新并选择列表中的 Release' };
      const view = releaseView(release);
      if (view.relation === 'current' && !repairAssets) return { ...status(), error: '选中的 Release 已是当前版本，请选择修复素材' };
      if (!view.installable) return { ...status(), error: view.reason };
      if (view.relation === 'old' && !allowDowngrade) return { ...status(), error: '回退旧版本需要确认', code: 'DOWNGRADE_CONFIRM' };
      if (hasActive() && !force) return { ...status(), state: 'active-matches', target: tag };
      if (prepared && prepared.tag !== tag) {
        const base = path.join(root, 'logs', 'update-staging');
        const relative = path.relative(base, prepared.stage);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) fs.rmSync(path.dirname(prepared.stage), { recursive: true, force: true });
        prepared = null;
      }
      const preparedAsset = prepared?.asset && release.assets?.find((a) => a.name === prepared.asset);
      current = { ...current, ...view, ...(preparedAsset ? { asset: preparedAsset.name, size: preparedAsset.size || 0 } : {}),
        target: tag, state: prepared ? 'verifying' : 'downloading', error: undefined, received: 0,
        route: prepared ? current.route : undefined, routeStep: prepared ? current.routeStep : undefined,
        routeTotal: prepared ? current.routeTotal : undefined, split: prepared ? current.split : false,
        groups: prepared ? current.groups : undefined, downloadBytes: prepared ? current.downloadBytes : undefined,
        fallback: prepared ? current.fallback : false, fallbackReason: prepared ? current.fallbackReason : undefined };
      (async () => {
        try {
          const candidates = prepared ? releases : await routeReleases();
          prepared ||= await stageRelease({ root, release, releases: candidates, fetchImpl, request, listing: listedVia.get(tag), progress: (p) => { current = { ...current, ...p }; } });
          current = { ...current, ...(prepared.route ? { route: prepared.route } : {}),
            ...(prepared.split ? { split: true, groups: prepared.groups, downloadBytes: prepared.downloadBytes } : {}) };
          if (prepared.launcher) current = { ...current, launcher: prepared.launcher };
          await launch(force);
        } catch (e) { prepared = null; fail(e); }
      })();
      return status();
    },
  };
}
