// Local records bind graceful service control to this directory and boot's admin token.
// i18n-ignore-file: host-only launcher and console diagnostics, not player UI (same boundary as server/admin.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function instanceFile(root, port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid game port');
  return path.join(root, 'logs', `server-instance-${port}.json`);
}

export function recordInstance(root, { port, adminPort, token, pid = process.pid }) {
  const file = instanceFile(root, port), boot = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('服务实例记录包含符号链接');
  }
  const tmp = `${file}.${boot}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ port, adminPort, token, pid, boot }), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return () => {
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).boot === boot) fs.unlinkSync(file); }
    catch (error) { if (error.code !== 'ENOENT') console.warn('[instance] cleanup failed', error.message); }
  };
}

export async function runningInstance(root, port, { fetchImpl = fetch } = {}) {
  try {
    const file = instanceFile(root, port), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return null;
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (r.port !== port || !Number.isInteger(r.pid) || r.pid < 1 || !Number.isInteger(r.adminPort)
      || r.adminPort < 1 || r.adminPort > 65535 || !/^[a-f0-9]{32}$/.test(r.token)) return null;
    const response = await fetchImpl(`http://127.0.0.1:${r.adminPort}/api/service`, {
      headers: { 'X-Admin-Token': r.token }, signal: AbortSignal.timeout(2000), redirect: 'error',
    });
    if (!response.ok) return null;
    const service = await response.json();
    return service.instanceId === r.pid ? { ...r, service } : null;
  } catch { return null; }
}

export async function stopInstance(root, port, { confirmActive = false, fetchImpl = fetch } = {}) {
  const r = await runningInstance(root, port, { fetchImpl });
  if (!r) return { ok: false, error: '无法确认端口属于当前安装，未停止任何进程。' };
  if (r.service.activeMatches && !confirmActive) return { ok: false, active: true, error: '当前有活动对局，请确认后再停止。' };
  try {
    const response = await fetchImpl(`http://127.0.0.1:${r.adminPort}/api/service`, {
      method: 'POST', headers: { 'X-Admin-Token': r.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'shutdown', confirm: true, confirmActive }), signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    const body = await response.json();
    return response.ok && body.ok ? { ok: true } : { ok: false, error: body.error || '停服请求失败。' };
  } catch (error) { return { ok: false, error: `停服请求失败：${error.message}` }; }
}
