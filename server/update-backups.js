// Update backups are reverse transactions, not arbitrary-version disk snapshots. Restore newest eligible first.
import fs from 'node:fs';
import path from 'node:path';
import { digestFile, removalProblem } from './update.js';
import { releaseTarget } from './release-art.js';

const ID = /^release-[A-Za-z0-9]+$/;
const base = (root) => path.join(root, 'logs', 'update-backups');
const configFile = (root) => path.join(root, 'logs', 'update-backup-settings.json');
export function assertUpdateSpace(root, required, { statfs = fs.statfsSync, reserve = 64 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(required) || required < 0) throw new Error('更新所需空间无效');
  const s = statfs(root), available = Number(s.bavail) * Number(s.bsize);
  if (!Number.isFinite(available) || available < required + reserve) throw new Error(`磁盘可用空间不足：本阶段至少需要 ${Math.ceil((required + reserve) / 1048576)} MB，请释放空间后重试。`);
  return available;
}

function backupPath(root, id) {
  if (!ID.test(id)) throw new Error('备份名称无效');
  const dir = path.join(base(root), id);
  for (const part of [base(root), dir]) if (fs.existsSync(part) && fs.lstatSync(part).isSymbolicLink()) throw new Error('备份路径包含符号链接');
  return dir;
}
export function readBackup(root, id) {
  const dir = backupPath(root, id), file = path.join(dir, 'restore.json');
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 32 * 1024 * 1024) throw new Error('备份清单无效');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.format !== 2 || !Array.isArray(record.files) || !Array.isArray(record.existing)) throw new Error('旧备份仅支持人工检查与恢复');
  if (record.versionBefore != null && typeof record.versionBefore !== 'string') throw new Error('备份版本元数据无效');
  for (const rel of record.files) if (typeof rel !== 'string' || (rel !== 'MANIFEST.json' && rel !== 'UPDATE.json' && removalProblem(rel))) throw new Error('备份文件路径无效');
  if (new Set(record.files).size !== record.files.length || record.existing.some((rel) => !record.files.includes(rel))) throw new Error('备份清单无效');
  return { dir, record };
}
export function markBackup(root, id, patch) {
  const { dir, record } = readBackup(root, id);
  const tmp = path.join(dir, 'restore.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify({ ...record, ...patch })); fs.renameSync(tmp, path.join(dir, 'restore.json'));
}
export function restoreReleaseBackup(root, id, { requireTarget = true } = {}) {
  const { dir, record } = readBackup(root, id);
  if (requireTarget && (!record.target || record.files.some((rel) => !Object.hasOwn(record.target, rel)))) throw new Error('恢复清单缺少当前目标状态，请人工检查，未写入任何文件。');
  // Verify every backup byte and every destination before modifying the installation.
  for (const rel of record.existing) {
    const file = releaseTarget(dir, rel), got = digestFile(file), want = record.hashes?.[rel];
    if (!got || !want || got.size !== want.size || got.sha256 !== want.sha256) throw new Error(`备份校验失败：${rel}`);
  }
  if (requireTarget) for (const [rel, want] of Object.entries(record.target || {})) {
    const got = digestFile(releaseTarget(root, rel));
    if (want ? (!got || got.sha256 !== want.sha256 || got.size !== want.size) : got) throw new Error('当前程序已变化，请按备份顺序恢复或人工检查，未写入任何文件。');
  }
  for (const rel of record.files) releaseTarget(root, rel);
  for (const rel of [...record.files].reverse()) {
    const dst = releaseTarget(root, rel);
    if (record.existing.includes(rel)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(releaseTarget(dir, rel), dst); }
    else fs.rmSync(dst, { force: true });
  }
  const version = path.join(root, 'logs', 'release-version.json');
  if (record.versionBefore == null) fs.rmSync(version, { force: true });
  else fs.writeFileSync(version, record.versionBefore);
  markBackup(root, id, { state: 'restored', restoredAt: Date.now() });
  return record;
}
export function backupSettings(root) {
  try { const v = JSON.parse(fs.readFileSync(configFile(root), 'utf8')); if (Number.isInteger(v.keep) && v.keep >= 1 && v.keep <= 20) return { keep: v.keep }; } catch {}
  return { keep: 2 };
}
export function configureBackups(root, keep) {
  if (!Number.isInteger(keep) || keep < 1 || keep > 20) throw new Error('备份保留数量应为 1–20');
  fs.mkdirSync(path.dirname(configFile(root)), { recursive: true });
  const tmp = configFile(root) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ keep })); fs.renameSync(tmp, configFile(root));
  return backupSettings(root);
}
function bytesIn(dir) {
  let bytes = 0;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('备份包含符号链接');
    const file = path.join(dir, item.name);
    bytes += item.isDirectory() ? bytesIn(file) : fs.statSync(file).size;
  }
  return bytes;
}
export function listBackups(root) {
  let ids = []; try { ids = fs.readdirSync(base(root)).filter((id) => ID.test(id)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const backups = ids.map((id) => {
    try { const { dir, record } = readBackup(root, id); return { id, bytes: bytesIn(dir), at: record.at || 0, state: record.state || 'pending', from: record.from, to: record.to }; }
    catch (e) { return { id, state: 'unrecognized', error: e.message, bytes: null, at: 0 }; }
  }).sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  const latest = backups.find((r) => r.state === 'verified');
  return { ...backupSettings(root), bytes: backups.some((r) => r.bytes == null) ? null : backups.reduce((sum, r) => sum + r.bytes, 0), backups: backups.map((r) => ({ ...r, protected: r.id === latest?.id || ['pending', 'recovery-required'].includes(r.state) })) };
}
export function deleteBackup(root, id) {
  if (fs.existsSync(path.join(root, 'logs', 'release-update.lock'))) throw new Error('更新进行中，不能清理备份');
  const record = listBackups(root).backups.find((r) => r.id === id);
  if (!record || record.protected || record.state === 'unrecognized') throw new Error('该备份受保护或需要人工检查，不能删除');
  fs.rmSync(backupPath(root, id), { recursive: true });
}
export function pruneBackups(root) {
  if (fs.existsSync(path.join(root, 'logs', 'release-update.lock'))) return;
  const view = listBackups(root);
  for (const record of view.backups.filter((r) => r.state === 'verified').slice(view.keep)) deleteBackup(root, record.id);
}
