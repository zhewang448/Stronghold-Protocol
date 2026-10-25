// i18n-ignore-file: authenticated host update diagnostics; no player UI strings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readZip, zipUnpackedSize } from './release-zip.js';

export const LAUNCHER_EXE = 'StrongholdProtocolLauncher.exe';
const HEX = /^[a-f0-9]{64}$/;
const digest = file => { try { const bytes = fs.readFileSync(file); return { size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const equal = (a, b) => a === null ? b === null : !!b && a.size === b.size && a.sha256 === b.sha256;
const stagedDir = stage => path.join(path.dirname(stage), 'launcher');

export function pickLauncherAsset(release) {
  const candidates = (release.assets || []).filter(a => /^StrongholdProtocolLauncher-v\d+\.\d+\.\d+-win-x64\.zip$/.test(a.name)
    || /^Stronghold-Protocol-v\d+\.\d+\.\d+(?:-extended\.\d+)?-launcher-win-x64\.zip$/.test(a.name));
  if (candidates.length > 1) throw new Error('Release 包含多个启动器附件，无法确定目标');
  return candidates[0] || null;
}

/** Called only after the archive SHA256 and tag-bound release signature have been checked. */
export function stageLauncherArchive(zip, stage, { tag, asset }) {
  if (zipUnpackedSize(zip) > 170 * 1024 * 1024) throw new Error('启动器压缩包解压大小超出限制');
  let executable = null; const names = new Set();
  readZip(zip, (name, bytes) => {
    const parts = name.split('/');
    if (parts.length > 2 || parts.some(p => !p || p === '.' || p === '..' || /[\\:]/.test(p))) throw new Error('启动器压缩包路径无效');
    const leaf = parts.at(-1), key = leaf.toLowerCase();
    if (names.has(key)) throw new Error('启动器压缩包包含重复文件');
    names.add(key);
    if (leaf === LAUNCHER_EXE) {
      if (bytes.length < 64 || bytes.length > 160 * 1024 * 1024 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('启动器 EXE 格式或大小无效');
      const pe = bytes.readUInt32LE(60);
      if (pe > bytes.length - 4 || bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error('启动器不是有效 Windows 程序');
      executable = bytes;
    } else if (!/^(?:README\.(?:md|txt)|THIRD-PARTY-NOTICES\.md)$/i.test(leaf)) throw new Error('启动器压缩包包含未知文件');
  });
  if (!executable) throw new Error('启动器附件缺少 StrongholdProtocolLauncher.exe');
  const directory = stagedDir(stage); fs.mkdirSync(directory, { recursive: true });
  const record = { format: 1, tag, asset, size: executable.length, sha256: crypto.createHash('sha256').update(executable).digest('hex') };
  fs.writeFileSync(path.join(directory, LAUNCHER_EXE), executable);
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(record));
  return { state: 'staged', asset, sha256: record.sha256 };
}

export function safeLauncherPath(file) {
  if (!path.isAbsolute(file) || path.basename(file) !== LAUNCHER_EXE) throw new Error('启动器目标路径无效');
  for (let current = file; current; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('启动器路径包含链接');
    const parent = path.dirname(current); if (parent === current) break;
  }
  return path.resolve(file);
}

export function prepareLauncherUpdate(root, stage) {
  const directory = stagedDir(stage), metadata = path.join(directory, 'manifest.json');
  if (!fs.existsSync(metadata)) return null;
  const value = JSON.parse(fs.readFileSync(metadata, 'utf8')), source = path.join(directory, LAUNCHER_EXE);
  if (fs.lstatSync(metadata).isSymbolicLink() || fs.lstatSync(source).isSymbolicLink() || fs.statSync(metadata).size > 8192) throw new Error('暂存启动器路径无效');
  if (value.format !== 1 || !HEX.test(value.sha256) || !equal(value, digest(source))) throw new Error('暂存启动器校验失败');
  const targets = [safeLauncherPath(path.join(root, LAUNCHER_EXE))];
  const location = path.join(root, 'logs', 'launcher-location.json');
  if (fs.existsSync(location)) {
    if (fs.lstatSync(location).isSymbolicLink() || fs.statSync(location).size > 8192) throw new Error('启动器位置记录无效');
    const registered = JSON.parse(fs.readFileSync(location, 'utf8'));
    if (typeof registered.path !== 'string') throw new Error('启动器位置记录无效');
    const file = safeLauncherPath(registered.path);
    const current = digest(file);
    // Only a launcher that registered its own exact executable bytes can be an external update target.
    if (registered.format === 1 && HEX.test(registered.sha256) && current?.sha256 === registered.sha256 && !targets.some(p => p.toLowerCase() === file.toLowerCase())) targets.push(file);
  }
  return { ...value, source, targets, root };
}

/** Advance only the exact location registration that authorized this transaction. */
export function refreshLauncherLocation(root, records, restoring = false) {
  const file = path.join(root, 'logs', 'launcher-location.json');
  if (!fs.existsSync(file)) return;
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 8192) throw new Error('启动器位置记录无效');
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  const record = records.find(item => item.path === current.path);
  if (!record) return;
  const from = restoring ? record.desired : record.before, to = restoring ? record.before : record.desired;
  if (!from || !to || current.sha256 !== from.sha256 || !equal(digest(record.path), to)) return;
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ ...current, sha256: to.sha256 })); fs.renameSync(temporary, file);
}

export function backupLaunchers(plan, backup) {
  if (!plan) return [];
  return plan.targets.map((file, index) => {
    const before = digest(file), stored = 'launcher-backup-' + index + '.exe';
    if (before) fs.copyFileSync(file, path.join(backup, stored));
    return { path: file, stored, before, desired: { size: plan.size, sha256: plan.sha256 }, state: 'ready' };
  });
}

export function replaceLaunchers(plan, targets, backup, { replace = fs.renameSync } = {}) {
  if (!plan) return null;
  const payload = path.join(backup, 'launcher-payload.exe'); fs.copyFileSync(plan.source, payload);
  const worker = path.join(backup, 'launcher-update-worker.mjs');
  fs.copyFileSync(fileURLToPath(new URL('./launcher-update-worker.mjs', import.meta.url)), worker);
  for (const target of targets) {
    if (equal(digest(target.path), target.desired)) { target.state = 'unchanged'; continue; }
    if (!equal(digest(target.path), target.before)) throw new Error('启动器在更新期间已变化，未覆盖');
    const temporary = target.path + '.update-' + crypto.randomBytes(8).toString('hex') + '.tmp';
    const lock = target.path + '.update.lock'; let lease;
    try {
      try { lease = fs.openSync(lock, 'wx'); fs.writeSync(lease, String(process.pid)); }
      catch (error) { if (error.code === 'EEXIST') { target.state = 'pending'; continue; } throw error; }
      if (!equal(digest(target.path), target.before)) throw new Error('启动器在等待更新锁期间已变化');
      fs.copyFileSync(payload, temporary); replace(temporary, target.path);
      if (!equal(digest(target.path), target.desired)) throw new Error('启动器替换后校验失败');
      target.state = 'installed';
    } catch (error) {
      if (['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) target.state = 'pending';
      else throw error;
    } finally { fs.rmSync(temporary, { force: true }); if (lease !== undefined) { fs.closeSync(lease); fs.rmSync(lock, { force: true }); } }
  }
  refreshLauncherLocation(plan.root, targets);
  return { state: targets.some(t => t.state === 'pending') ? 'pending' : 'installed', asset: plan.asset,
    paths: targets.map(t => t.path), warning: targets.some(t => t.state === 'pending') ? '启动器正在使用中，已下载并验签；关闭启动器后将自动替换，游戏更新不受影响。' : undefined };
}

export function validateLauncherBackup(backup, records, { target = true } = {}) {
  if (!Array.isArray(records)) throw new Error('启动器备份清单无效');
  for (const record of records) {
    safeLauncherPath(record.path);
    if (!/^launcher-backup-\d+\.exe$/.test(record.stored) || !HEX.test(record.desired?.sha256)
        || !Number.isSafeInteger(record.desired?.size) || record.desired.size < 64) throw new Error('启动器备份条目无效');
    if (record.before && !equal(digest(path.join(backup, record.stored)), record.before)) throw new Error('启动器原文件备份校验失败');
    const current = digest(record.path);
    if (target && !equal(current, record.before) && !equal(current, record.desired)) throw new Error('当前启动器已变化，拒绝覆盖恢复');
  }
}

export function restoreLaunchers(backup, records, { target = true } = {}) {
  validateLauncherBackup(backup, records, { target });
  for (const record of [...records].reverse()) {
    if (equal(digest(record.path), record.before)) continue;
    const lock = record.path + '.update.lock'; let lease;
    try {
      lease = fs.openSync(lock, 'wx'); fs.writeSync(lease, String(process.pid));
      if (record.before) fs.copyFileSync(path.join(backup, record.stored), record.path);
      else fs.rmSync(record.path, { force: true });
      if (!equal(digest(record.path), record.before)) throw new Error('启动器回滚后校验失败');
    } finally { if (lease !== undefined) { fs.closeSync(lease); fs.rmSync(lock, { force: true }); } }
  }
}

export function startLauncherWorker(root, backup) {
  const child = spawn(process.execPath, [path.join(backup, 'launcher-update-worker.mjs'), root, backup],
    { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {}); child.unref();
}

/** Resume only verified pending transactions under this installation's update backups. */
export function resumeLauncherUpdate(root) {
  if (process.platform !== 'win32') return;
  const base = path.join(root, 'logs', 'update-backups');
  let entries;
  try { entries = fs.readdirSync(base).filter(name => /^release-[A-Za-z0-9]+$/.test(name)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const name of entries) {
    const directory = path.join(base, name);
    try {
      const file = path.join(directory, 'restore.json');
      if (fs.lstatSync(directory).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink()) continue;
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (record.state === 'verified' && record.launchers?.some(item => item.state === 'pending')) startLauncherWorker(root, directory);
    } catch { /* Unreadable backups remain available for manual recovery. */ }
  }
}
