// Art staged from an authenticated full release or delta inventory; unlisted local files are never removed.
import fs from 'node:fs';
import path from 'node:path';
import { isSetupArt, removalProblem, parseManifest, listedArtFiles, digestFile } from './update.js';

export const ART_STAGE_FILE = 'RELEASE-ART.json';

/** Reject linked destinations before reading, backing up or replacing any installation file. */
export function releaseTarget(root, rel, checkedParents = null) {
  if (rel !== 'MANIFEST.json' && rel !== 'UPDATE.json' && removalProblem(rel)) throw new Error(`拒绝替换本机路径：${rel}`);
  let current = root;
  const parts = rel.split('/');
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part);
    const parent = i < parts.length - 1;
    if (parent && checkedParents?.has(current)) continue;
    let stat;
    try { stat = fs.lstatSync(current); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (stat.isSymbolicLink()) throw new Error(`更新目标包含符号链接：${rel}`);
    if (parent && stat.isDirectory()) checkedParents?.add(current);
  }
  return current;
}

export function readStagedArt(stage, app) {
  const file = path.join(stage, ART_STAGE_FILE);
  if (!fs.existsSync(file)) return new Map(); // pending stages created by an older updater
  const manifest = parseManifest(fs.readFileSync(file, 'utf8'));
  if (manifest.app !== app) throw new Error('素材清单与程序版本不一致');
  for (const rel of manifest.files.keys()) {
    if (!isSetupArt(rel) || removalProblem(rel)) throw new Error(`素材清单包含非法路径：${rel}`);
  }
  if (!manifest.files.has('data/assets.json')) throw new Error('完整包缺少素材清单 data/assets.json');
  return manifest.files;
}

/** Verify both changed staged files and unchanged retained files, including manifest references. */
export function verifyStagedArt(root, stage, files, { installed = false } = {}) {
  // Cache directory checks within this synchronous pass, never across staging/install/verification boundaries.
  const localParents = new Set(), stagedParents = new Set();
  const source = (rel) => {
    const local = releaseTarget(root, rel, localParents);
    const staged = releaseTarget(stage, rel, stagedParents);
    return !installed && fs.existsSync(staged) ? staged : local;
  };
  for (const [rel, expected] of files) {
    const got = digestFile(source(rel));
    if (!got || got.size !== expected.size || got.sha256 !== expected.sha256) throw new Error(`素材校验失败：${rel}`);
  }
  for (const rel of ['data/assets.json', 'data/local-assets.json', 'data/local-fx.json']) {
    if (!files.has(rel)) continue;
    const manifest = JSON.parse(fs.readFileSync(source(rel), 'utf8'));
    for (const ref of listedArtFiles(manifest)) {
      if (!files.has(ref)) throw new Error(`完整包素材缺失：${ref}（${rel}）`);
    }
  }
}
