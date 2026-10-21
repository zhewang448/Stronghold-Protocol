#!/usr/bin/env node
// Loaded before the old server stops. Keep recovery code alive independently of the installed candidate.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { applyReleaseStage } from '../server/release-install.js';
import { updatePaths, saveUpdateStatus, installedIdentity, installedTag } from '../server/release-update.js';
import { supportsUpdateProbe, probeRelease, waitReleaseHealth } from '../server/release-health.js';
import { markBackup, restoreReleaseBackup, pruneBackups } from '../server/update-backups.js';

const [root, stage, pidText, tag] = process.argv.slice(2);
const pid = Number(pidText), port = Number(process.env.SP_UPDATE_PORT) || Number(process.env.PORT) || 3000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
const paths = updatePaths(root), base = path.resolve(root, 'logs', 'update-staging');
const relative = path.relative(base, path.resolve(stage));
if (!Number.isSafeInteger(pid) || pid < 1 || !relative || relative.startsWith('..') || path.isAbsolute(relative)) process.exit(1);
fs.writeFileSync(paths.lock, JSON.stringify({ pid, installerPid: process.pid, at: Date.now() }));
process.send?.('ready');
for (let i = 0; i < 160 && alive(); i++) await sleep(250);
if (alive()) {
  saveUpdateStatus(root, { state: 'error', error: '原服务器未退出，更新已取消' });
  fs.rmSync(paths.lock, { force: true }); process.exit(1);
}
let result, error, failureBackup, restartSafe = true, validated = false;
const safeProbe = supportsUpdateProbe(stage);
try {
  const app = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8')).version;
  saveUpdateStatus(root, { state: 'validating', tag });
  // Older releases lack the read-only probe contract: test their isolated stage, never the user's logs.
  if (!safeProbe) await probeRelease(stage, { app, legacy: true });
  result = applyReleaseStage(root, stage, { from: installedTag(root), to: tag });
  saveUpdateStatus(root, { state: 'validating', tag, backup: result.backup });
  if (safeProbe) await probeRelease(root, { app });
  fs.writeFileSync(paths.version, JSON.stringify({ app: result.app, tag, sourceHash: installedIdentity(root) }));
  validated = true;
} catch (e) {
  error = e.message; restartSafe = e.restartSafe !== false;
  failureBackup = e.backup;
  if (result && safeProbe) {
    try {
      saveUpdateStatus(root, { state: 'rolling-back', tag, backup: result.backup, error });
      restoreReleaseBackup(root, path.basename(result.backup));
      error = '新版只读启动验证失败，已恢复原程序与版本信息：' + error;
    } catch (restoreError) { restartSafe = false; error += '；恢复失败：' + restoreError.message; }
  }
}
if (!restartSafe) {
  const backup = result?.backup || failureBackup;
  if (backup) markBackup(root, path.basename(backup), { state: 'recovery-required' });
  saveUpdateStatus(root, { state: 'recovery-required', tag, backup, error,
    recovery: backup ? 'node scripts/recover-release.mjs --backup ' + path.basename(backup) + ' --port ' + port + ' --confirm' : '请检查更新日志与备份，安装锁已保留。' });
  process.exit(1);
}
saveUpdateStatus(root, { state: 'starting', tag, backup: result?.backup, ...(error ? { error } : {}) });
fs.rmSync(paths.lock, { force: true });
let child, exited = false;
if (process.env.SP_UPDATE_RESTART !== 'supervisor') {
  const fd = fs.openSync(path.join(root, 'logs', 'release-restart.log'), 'a');
  child = spawn(process.execPath, [...process.execArgv, path.join(root, 'server', 'index.js')], {
    cwd: root, env: { ...process.env, PORT: String(port) }, detached: true, stdio: ['ignore', fd, fd], windowsHide: true,
  });
  child.on('error', (e) => { exited = true; error = e.message; });
  child.on('exit', () => { exited = true; }); child.unref(); fs.closeSync(fd);
}
try {
  await waitReleaseHealth(root, port, { app: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, exited: () => exited });
  if (validated) {
    markBackup(root, path.basename(result.backup), { state: 'verified', verifiedAt: Date.now() });
    saveUpdateStatus(root, { state: 'installed', tag, backup: result.backup });
    try { fs.rmSync(path.dirname(stage), { recursive: true, force: true }); pruneBackups(root); }
    catch (cleanupError) { saveUpdateStatus(root, { state: 'installed', tag, backup: result.backup, warning: `更新已验证，但清理未完成：${cleanupError.message}` }); }
  } else saveUpdateStatus(root, { state: 'error', tag, backup: result?.backup, error: error || '更新取消，原程序已启动。' });
} catch (e) {
  // Normal startup can touch persistent data; never automatically reverse it after accepting traffic.
  if (result) markBackup(root, path.basename(result.backup), { state: 'recovery-required' });
  saveUpdateStatus(root, { state: 'recovery-required', tag, backup: result?.backup, error: error || e.message,
    recovery: result ? 'node scripts/recover-release.mjs --backup ' + path.basename(result.backup) + ' --port ' + port + ' --confirm' : '请查看 logs/release-restart.log 并重新启动。' });
  process.exitCode = 1;
}
