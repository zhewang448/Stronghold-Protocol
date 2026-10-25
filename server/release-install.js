// Transactional program and changed-art replacement. Unlisted art/settings/packs are retained.
import fs from 'node:fs';
import path from 'node:path';
import { parseManifest, verifyFiles, digestFile, removalProblem, isSetupArt } from './update.js';
import { releaseTarget as targetPath, readStagedArt, verifyStagedArt } from './release-art.js';
import { assertUpdateSpace } from './update-backups.js';
import { prepareLauncherUpdate, backupLaunchers, replaceLaunchers, restoreLaunchers, refreshLauncherLocation } from './release-launcher.js';

/** Backup replaced/deleted files first; restore all touched paths if replacement or verification fails. */
export function applyReleaseStage(root, stage, { copyFile = fs.copyFileSync, launcherReplace, from, to } = {}) {
  root = fs.realpathSync(root);
  const next = parseManifest(fs.readFileSync(path.join(stage, 'MANIFEST.json'), 'utf8'));
  for (const rel of next.files.keys()) if (isSetupArt(rel) || removalProblem(rel)) throw new Error(`程序清单包含保留路径：${rel}`);
  const checked = verifyFiles(stage, next.files);
  if (checked.missing.length || checked.mismatched.length) throw new Error('暂存程序文件校验失败');
  const art = readStagedArt(stage, next.app);
  verifyStagedArt(root, stage, art);
  const launcherPlan = prepareLauncherUpdate(root, stage);
  if (launcherPlan && next.files.has('StrongholdProtocolLauncher.exe')) throw new Error('启动器附件与游戏程序清单冲突');
  if (launcherPlan && to && launcherPlan.tag !== to) throw new Error('启动器目标版本与游戏更新不一致');
  let previous = null;
  try { previous = parseManifest(fs.readFileSync(path.join(root, 'MANIFEST.json'), 'utf8')); } catch { /* source installs have none */ }
  const newNames = new Set([...next.files.keys()].map((rel) => rel.toLowerCase()));
  const removed = [];
  for (const [rel, hash] of previous?.files || []) {
    if (newNames.has(rel.toLowerCase()) || isSetupArt(rel) || removalProblem(rel)) continue;
    const file = targetPath(root, rel);
    if (digestFile(file)?.sha256 === hash.sha256) removed.push(rel);
  }
  const artChanges = [...art.keys()].filter((rel) => fs.existsSync(path.join(stage, rel)));
  const files = [...next.files.keys(), ...artChanges, 'MANIFEST.json'];
  const changed = [...files, ...removed];
  if (fs.existsSync(path.join(root, 'UPDATE.json'))) changed.push('UPDATE.json');
  // Validate every destination before modifying anything.
  for (const rel of changed) {
    const file = targetPath(root, rel);
    if (fs.existsSync(file) && !fs.statSync(file).isFile()) throw new Error(`更新目标不是普通文件：${rel}`);
  }
  const backups = path.join(root, 'logs', 'update-backups');
  let required = 0;
  for (const rel of changed) { try { required += fs.statSync(targetPath(root, rel)).size; } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  for (const rel of files) required += fs.statSync(path.join(stage, rel)).size;
  if (launcherPlan) required += launcherPlan.size * (launcherPlan.targets.length + 1);
  assertUpdateSpace(root, required);
  fs.mkdirSync(backups, { recursive: true });
  const backup = fs.mkdtempSync(path.join(backups, 'release-'));
  const existing = new Set();
  const hashes = {};
  for (const rel of changed) {
    const file = targetPath(root, rel);
    if (!fs.existsSync(file)) continue;
    const dst = path.join(backup, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(file, dst);
    hashes[rel] = digestFile(dst);
    existing.add(rel);
  }
  let versionBefore = null;
  try { versionBefore = fs.readFileSync(path.join(root, 'logs', 'release-version.json'), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const launchers = backupLaunchers(launcherPlan, backup);
  const record = { format: 2, files: changed, existing: [...existing], hashes, versionBefore, at: Date.now(), from, to, state: 'pending', launchers };
  fs.writeFileSync(path.join(backup, 'restore.json'), JSON.stringify(record));
  const touched = [];
  try {
    for (const rel of files) {
      const file = targetPath(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      touched.push(rel);
      copyFile(path.join(stage, rel), file);
    }
    for (const rel of [...removed, ...(changed.includes('UPDATE.json') ? ['UPDATE.json'] : [])]) {
      touched.push(rel);
      fs.unlinkSync(targetPath(root, rel));
    }
    const result = verifyFiles(root, next.files);
    if (result.missing.length || result.mismatched.length) throw new Error('替换后程序文件校验失败');
    verifyStagedArt(root, stage, art, { installed: true });
    const launcher = replaceLaunchers(launcherPlan, launchers, backup, { replace: launcherReplace });
    record.target = Object.fromEntries(changed.map((rel) => [rel, digestFile(targetPath(root, rel))]));
    fs.writeFileSync(path.join(backup, 'restore.json'), JSON.stringify(record));
    return { app: next.app, backup, removed: removed.length, assets: artChanges.length, ...(launcher ? { launcher } : {}) };
  } catch (e) {
    const failures = [];
    try { restoreLaunchers(backup, launchers); refreshLauncherLocation(root, launchers, true); }
    catch (error) { failures.push('启动器：' + error.message); }
    for (const rel of touched.reverse()) {
      try {
        const dst = targetPath(root, rel);
        if (existing.has(rel)) fs.copyFileSync(path.join(backup, rel), dst);
        else fs.rmSync(dst, { force: true });
      } catch (err) { failures.push(`${rel}: ${err.message}`); }
    }
    if (failures.length) {
      record.target = Object.fromEntries(changed.map((rel) => [rel, digestFile(targetPath(root, rel))]));
      fs.writeFileSync(path.join(backup, 'restore.json'), JSON.stringify({ ...record, state: 'recovery-required' }));
      const error = new Error(`更新失败且部分文件恢复失败；备份在 ${backup}：${failures.join('；')}`, { cause: e });
      error.restartSafe = false;
      error.backup = backup;
      throw error;
    }
    fs.writeFileSync(path.join(backup, 'restore.json'), JSON.stringify({ ...record, state: 'restored' }));
    throw new Error(`更新失败，已恢复原程序：${e.message}`, { cause: e });
  }
}
