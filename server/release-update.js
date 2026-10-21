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
import { readZip } from './release-zip.js';
import { ART_STAGE_FILE, releaseTarget, readStagedArt, verifyStagedArt } from './release-art.js';
import { RELEASE_TAG } from './release-version.js';
import { SIGNATURE_ASSET, SUMS_ASSET, parseSignature, sumFor, verifySums } from './release-signing.js';
import { fetch as networkFetch, ProxyAgent } from 'undici';
import { DEFAULT_GITHUB_PROXY, normalizeProxyPrefix } from '../tools/assets/sources.mjs';

export const UPDATE_REPOSITORY = 'zhewang448/Stronghold-Protocol';
const API = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases`;
const HEADERS = { accept: 'application/vnd.github+json', 'user-agent': 'Stronghold-Protocol-console' };
const BUSY = new Set(['checking', 'downloading', 'verifying', 'scheduled']);
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
  fs.writeFileSync(file, JSON.stringify(status));
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
  return assets.find((a) => /^Stronghold-Protocol-v[^/\\]+-assets\.zip$/.test(a.name));
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
export function stageZip(zip, stage, releaseTag, { root = null } = {}) {
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
  verifyStagedArt(root || stage, stage, readStagedArt(stage, manifest.app));
  return manifest;
}

/** Build a complete transactional stage from a signed delta and the installed files it leaves unchanged. */
export function stageUpdateZip(zip, stage, releaseTag, root) {
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
  if (compareReleaseTags(releaseTag, installedTag(root)) <= 0) throw new Error('回退和同版修复必须使用完整素材包');
  if (update.tag && update.tag !== releaseTag) throw new Error('增量包目标标签与 Release 不一致');
  const baseVersion = appVersion(root);
  if (!update.from.includes(baseVersion)) throw new Error(`增量包不适用于当前基础版本 v${baseVersion}`);
  if (update.fromTags && !update.fromTags.includes(installedTag(root))) throw new Error('增量包不适用于当前扩展版本');
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
      const source = releaseTarget(root, rel, checkedParents), got = digestFile(source);
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
  verifyStagedArt(root, stage, readStagedArt(stage, manifest.app));
  return manifest;
}

/** Keep ongoing matches responsive while the authenticated archive is unpacked and hashed. */
export function stageReleaseArchive(zip, stage, tag, root, incremental = false) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./release-stage-worker.js', import.meta.url), {
      workerData: { zip, stage, tag, root, incremental }, execArgv: [],
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

const UNSIGNED_VIA_MIRROR = '该版本没有发布签名，只能在直连或代理访问 GitHub 时安装';

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

/** Stream with backpressure, verify published ZIP SHA-256, then verify individual program files. */
export async function downloadAndStage({ root, release, fetchImpl = fetch, listing = 'direct', keys, progress = () => {},
  request = async (url, consume, timeout) => consume(await responseFor(url, fetchImpl, timeout), 'direct') }) {
  const full = pickReleaseAsset(release);
  const installed = installedTag(root);
  const delta = preferredUpdate(release, installed);
  const candidates = [...(delta ? [delta] : []), ...(full ? [full] : [])];
  if (!candidates.length) throw new Error('这个 Release 缺少完整素材包，无法保证素材完整');
  const base = path.join(root, 'logs', 'update-staging');
  fs.mkdirSync(base, { recursive: true });
  const work = fs.mkdtempSync(path.join(base, 'release-'));
  const zip = path.join(work, 'release.zip');
  try {
    let lastError;
    for (const asset of candidates) {
      try {
        const want = await expectedHash({ release, asset, request, listing, keys });
        const staged = await request(assetUrl(asset), async (response) => {
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
          const stage = path.join(work, 'Stronghold-Protocol');
          const manifest = await stageReleaseArchive(zip, stage, release.tag_name, root, asset === delta);
          fs.rmSync(zip);
          return { stage, app: manifest.app, tag: release.tag_name, asset: asset.name };
        }, 15 * 60 * 1000);
        return staged;
      } catch (e) {
        lastError = e;
        if (asset === delta && full) {
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
export async function scheduleInstall({ root, stage, tag, parentPid = process.pid }) {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'apply-release-update.mjs');
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(updatePaths(root).lock, JSON.stringify({ pid: parentPid, at: Date.now() }));
  try {
    const installer = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, root, stage, String(parentPid), tag], {
        cwd: root, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
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

export function createReleaseUpdater({ root, log = console, onReady, hasActive = () => false,
  fetchImpl = networkFetch, stageRelease = downloadAndStage, schedule = scheduleInstall } = {}) {
  let current = { state: 'idle' }, releases = [], prepared = null, opened = false, checking = null, page = 0, hasMore = false;
  const listedVia = new Map(); // tag → route its Release entry was last listed through
  let network = normalizeUpdateNetwork({});
  try { network = normalizeUpdateNetwork(JSON.parse(fs.readFileSync(updatePaths(root).network, 'utf8'))); }
  catch { /* default on first launch or invalid saved settings */ }
  try {
    const last = JSON.parse(fs.readFileSync(updatePaths(root).status, 'utf8'));
    if (last.state === 'error') current = last;
  } catch { /* no previous failure */ }
  function releaseView(release) {
    const full = pickReleaseAsset(release);
    const relation = compareReleaseTags(release.tag_name, installedTag(root));
    const delta = preferredUpdate(release, installedTag(root));
    const asset = delta || full;
    let reason = '';
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
      if (!sums && !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '')
        && (!full || !/^sha256:[a-f0-9]{64}$/i.test(full.digest || ''))) throw new Error('缺少 SHA-256 校验值');
    } catch (e) { reason = e.message; }
    return { tag: release.tag_name, relation: relation > 0 ? 'new' : relation < 0 ? 'old' : 'current',
      asset: asset?.name, size: asset?.size || 0, publishedAt: release.published_at,
      fallbackAsset: delta ? full?.name : undefined, fallbackSize: delta ? (full?.size || 0) : undefined,
      signed: !!release.assets?.some((a) => a.name === SIGNATURE_ASSET), installable: !reason, reason };
  }
  const status = () => {
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
  async function launch(force) {
    if (hasActive() && !force) { current = { ...current, state: 'active-matches' }; return; }
    const cancel = await schedule({ root, ...prepared });
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
        current = { state: newer ? 'available' : 'up-to-date', tag: latest?.tag_name, source: current.source };
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
      if (BUSY.has(current.state)) return status();
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
        fallback: prepared ? current.fallback : false, fallbackReason: prepared ? current.fallbackReason : undefined };
      (async () => {
        try {
          prepared ||= await stageRelease({ root, release, fetchImpl, request, listing: listedVia.get(tag), progress: (p) => { current = { ...current, ...p }; } });
          await launch(force);
        } catch (e) { prepared = null; fail(e); }
      })();
      return status();
    },
  };
}
