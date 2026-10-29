import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readZip, zipUnpackedSize } from './release-zip.js';
import { isSetupArt, parseManifest, pathProblem, removalProblem, digestFile } from './update.js';
import { ART_STAGE_FILE, releaseTarget, verifyStagedArt } from './release-art.js';

export function parseSplitIndex(text, tag) {
  const value = JSON.parse(text);
  if (!value || value.format !== 1 || value.tag !== tag || !value.groups || !value.files
    || Array.isArray(value.groups) || Array.isArray(value.files)) throw new Error('素材索引格式错误');
  const manifest = parseManifest(JSON.stringify({ format: 1, app: value.app, files: value.files }));
  if (/^v(\d+\.\d+\.\d+)(?:-extended\.\d+)?$/.exec(tag)?.[1] !== manifest.app) throw new Error('素材索引版本不符');
  const groups = new Map(), files = new Map(), seen = new Set();
  for (const [group, name] of Object.entries(value.groups)) {
    if (!['common', 'local', 'fx'].includes(group) || name !== `Stronghold-Protocol-${tag}-${group}-art.zip`) throw new Error('素材分包名称无效');
    groups.set(group, name);
  }
  for (const [rel, expected] of manifest.files) {
    const group = value.files[rel].group, key = rel.toLowerCase();
    if (!isSetupArt(rel) || removalProblem(rel) || seen.has(key) || !groups.has(group)) throw new Error(`素材索引路径无效：${rel}`);
    seen.add(key);
    const source = value.files[rel].source;
    if (source !== undefined) {
      let url;
      try { url = new URL(source); } catch { throw new Error(`素材来源无效：${rel}`); }
      if (group !== 'common' || url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com'
        || url.username || url.password || url.search || url.hash) throw new Error(`素材来源无效：${rel}`);
    }
    files.set(rel, { ...expected, group, ...(source ? { source } : {}) });
  }
  if (!files.has('data/assets.json')) throw new Error('素材索引缺少 data/assets.json');
  return { app: manifest.app, tag, groups, files };
}

export function neededAssetGroups(root, index, stage = null) {
  const needed = new Set(), missing = [], checkedParents = new Set(), stagedParents = new Set();
  for (const [rel, expected] of index.files) {
    const staged = stage ? releaseTarget(stage, rel, stagedParents) : null;
    const got = staged && fs.existsSync(staged) ? digestFile(staged) : digestFile(releaseTarget(root, rel, checkedParents));
    if (!got || got.size !== expected.size || got.sha256 !== expected.sha256) { needed.add(expected.group); missing.push(rel); }
  }
  return { needed: [...needed], missing };
}

export function stageAssetGroup(zip, root, stage, index, group) {
  const expectedBytes = [...index.files.values()].filter(file => file.group === group).reduce((sum, file) => sum + file.size, 0);
  if (!Number.isSafeInteger(expectedBytes) || zipUnpackedSize(zip) !== expectedBytes) throw new Error('素材分包解压大小不符');
  const seen = new Set(), checkedParents = new Set();
  readZip(zip, (name, bytes) => {
    if (!name.startsWith('Stronghold-Protocol/')) throw new Error(`素材分包路径无效：${name}`);
    const rel = name.slice('Stronghold-Protocol/'.length), expected = index.files.get(rel), key = rel.toLowerCase();
    if (pathProblem(rel) || seen.has(key) || !expected || expected.group !== group) throw new Error(`素材分包包含未知文件：${rel}`);
    seen.add(key);
    if (bytes.length !== expected.size || crypto.createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error(`素材分包文件校验失败：${rel}`);
    const local = digestFile(releaseTarget(root, rel, checkedParents));
    if (local?.size === expected.size && local.sha256 === expected.sha256) return;
    const target = releaseTarget(stage, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  });
  for (const [rel, expected] of index.files) if (expected.group === group && !seen.has(rel.toLowerCase())) throw new Error(`素材分包缺少文件：${rel}`);
}

export function finishSplitStage(root, stage, index) {
  const files = Object.fromEntries([...index.files].map(([rel, { size, sha256 }]) => [rel, { size, sha256 }]));
  fs.writeFileSync(path.join(stage, ART_STAGE_FILE), JSON.stringify({ format: 1, app: index.app, files }));
  verifyStagedArt(root, stage, new Map(Object.entries(files)));
}
