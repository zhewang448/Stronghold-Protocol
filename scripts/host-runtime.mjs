// Own only children created here. Server replacements share one supervisor; the tunnel survives those replacements.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { probePort, hostUrl } from '../tools/doctor.mjs';
import { stopInstance } from '../server/instance.js';
import { computeBuildTag } from '../server/http/buildTag.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };

// Windows can reuse a PID left behind after a forced close or reboot. Unknown start times keep the lease.
function windowsProcessStartedAt(pid) {
  if (process.platform !== 'win32' || !process.env.SystemRoot) return null;
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    `[DateTimeOffset]::new((Get-Process -Id ${pid} -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds()`],
  { encoding: 'utf8', timeout: 5000, windowsHide: true });
  const value = result.stdout?.trim();
  return result.status === 0 && /^\d+$/.test(value ?? '') ? Number(value) : null;
}

export function acquireLease(root, name, { isAlive = alive, processStartedAt = windowsProcessStartedAt } = {}) {
  if (!/^(launch|tunnel|runtime)-\d+$/.test(name)) throw new Error('Invalid launcher lease');
  const file = path.join(root, 'logs', `${name}.json`), owner = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      let record = { pid: process.pid, owner };
      try { fs.writeFileSync(fd, JSON.stringify(record)); } finally { fs.closeSync(fd); }
      return { owned: true, update(patch) { record = { ...record, ...patch }; fs.writeFileSync(file, JSON.stringify(record)); },
        release() { try { if (JSON.parse(fs.readFileSync(file, 'utf8')).owner === owner) fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; } } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let record, raw, stat;
      try {
        const fd = fs.openSync(file, 'r');
        try { raw = fs.readFileSync(fd, 'utf8'); stat = fs.fstatSync(fd); } finally { fs.closeSync(fd); }
        record = JSON.parse(raw);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        return { owned: false };
      }
      if (!Number.isSafeInteger(record?.pid) || record.pid < 1) return { owned: false, record };
      if (isAlive(record.pid)) {
        if (record.pid === process.pid) return { owned: false, record };
        const startedAt = processStartedAt(record.pid);
        // Use the last write for legacy leases too. A valid owner must have started before it wrote the lease.
        if (!Number.isFinite(startedAt) || stat.mtimeMs <= 0 || startedAt <= stat.mtimeMs + 2000) return { owned: false, record };
      }
      try {
        const latest = fs.statSync(file);
        if (latest.ino === stat.ino && latest.mtimeMs === stat.mtimeMs && fs.readFileSync(file, 'utf8') === raw) fs.unlinkSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return { owned: false };
}

export function superviseServer({ root, port, env, serverArgs = [], spawnImpl = spawn, probe = probePort,
  log = console.log, onHealthy = () => {}, maxRestarts = 3, restartDelay = 1000, healthTimeout = 30000,
  requestStop = stopInstance }) {
  let current = null, stopping = false, first = true, resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Callers may observe done before ready, so attach a rejection observer immediately.
  ready.catch(() => {});
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const owned = current;
    if (owned && owned.exitCode === null) void requestStop(root, port, { confirmActive: true }).then((r) => {
      if (!r.ok && owned.exitCode === null) owned.kill('SIGTERM');
    }).catch(() => { if (owned.exitCode === null) owned.kill('SIGTERM'); });
  };
  const done = (async () => {
    const lease = acquireLease(root, `runtime-${port}`);
    if (!lease.owned) throw new Error('当前安装的服务守护器正在运行，请先关闭原启动窗口。');
    try {
      let failures = 0;
      while (!stopping) {
        const lock = path.join(root, 'logs', 'release-update.lock');
        const until = Date.now() + 120000;
        while (!stopping && fs.existsSync(lock) && Date.now() < until) await sleep(200);
        if (stopping) break;
        if (fs.existsSync(lock)) throw new Error('更新安装锁未释放，请检查本机恢复说明。');
        let status;
        try { status = JSON.parse(fs.readFileSync(path.join(root, 'logs', 'release-update-status.json'), 'utf8')); } catch {}
        if (status?.state === 'recovery-required') throw new Error('更新需要离线恢复，请关闭启动窗口并按控制台说明恢复。');
        const vacant = (await probe(port)).state === 'free', build = computeBuildTag(root);
        let intent = null, exited = false, bootReady = false, healthy = false;
        const startedAt = Date.now();
        const child = spawnImpl(process.execPath, [...process.execArgv, path.join(root, 'server', 'index.js'), ...serverArgs], {
          cwd: root, env: { ...env, PORT: String(port), SP_UPDATE_RESTART: 'supervisor', SP_SERVICE_SHUTDOWN: 'exit-code' },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
        });
        current = child;
        for (const stream of [child.stdout, child.stderr]) if (stream) readline.createInterface({ input: stream }).on('line', (line) => log(`[server] ${line}`));
        const exit = new Promise((resolve) => {
          child.once('exit', (code) => { exited = true; resolve({ code }); });
          child.once('error', (error) => { exited = true; resolve({ code: 1, error }); });
        });
        child.on('message', (message) => {
          if (message?.t !== 'sp.lifecycle') return;
          if (message.action === 'ready' && message.pid === child.pid) bootReady = true;
          else if (['restart', 'shutdown', 'update'].includes(message.action)) intent = message.action;
        });
        while (!stopping && !exited && Date.now() - startedAt < healthTimeout) {
          const report = await probe(port);
          // Older releases have no lifecycle IPC. Only accept their build on a port free before our own spawn.
          if (report.state === 'ours' && (bootReady || (vacant && report.health?.build === build))) { healthy = true; break; }
          await sleep(100);
        }
        if (!stopping && !exited && healthy) {
          await onHealthy({ pid: child.pid, first });
          if (first) { first = false; resolveReady(child); }
        } else if (!exited) child.kill('SIGTERM');
        const result = await exit;
        current = null;
        if (stopping || intent === 'shutdown' || result.code === 75) break;
        if (Date.now() - startedAt > 60000) failures = 0;
        if (!['restart', 'update'].includes(intent) && ++failures > maxRestarts) throw new Error('服务器连续启动失败，已停止自动重试，请查看启动日志。');
        log(`[launch] ${intent === 'update' ? '等待更新并重启' : intent === 'restart' ? '正在重启' : '异常退出，重试启动'}…`);
        await sleep(restartDelay);
      }
      if (first) rejectReady(new Error('服务器未完成启动。'));
      return 0;
    } finally { lease.release(); }
  })().catch((error) => { stop(); rejectReady(error); log(`[launch] ${error.message}`); return 1; });
  return { ready, done, stop };
}

export function openTunnel({ root, port, spawnImpl = spawn, log = console.log, onUrl = () => {} }) {
  const lease = acquireLease(root, `tunnel-${port}`);
  if (!lease.owned) {
    log(lease.record?.url ? `公网隧道已在运行：${lease.record.url}` : '公网隧道正在启动，请查看原启动窗口。');
    return { existing: true, stop() {}, closed: Promise.resolve(0) };
  }
  const known = ['C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe'];
  let child;
  try { child = spawnImpl(known.find((p) => fs.existsSync(p)) || 'cloudflared', ['tunnel', '--no-autoupdate', '--url', hostUrl('localhost', port)], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  }); } catch (e) { lease.release(); throw e; }
  let stopping = false, url = null;
  const timeout = setTimeout(() => { if (!url) log('公网隧道尚未就绪，请检查 cloudflared 日志。'); }, 30000);
  const closed = new Promise((resolve) => {
    const finish = (code, error) => {
      clearTimeout(timeout); lease.release();
      if (!stopping) log(`[tunnel] 公网隧道已停止${error ? `：${error.message}；请安装 cloudflared 或检查网络` : `（${code}）`}，本机服务不受影响。`);
      resolve(code || 0);
    };
    child.once('error', (error) => finish(1, error)); child.once('exit', (code) => finish(code));
  });
  for (const stream of [child.stdout, child.stderr]) if (stream) readline.createInterface({ input: stream }).on('line', (line) => {
    const found = !url && line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (found) { url = found[0]; lease.update({ url }); clearTimeout(timeout); onUrl(url); }
    else if (/\b(ERR|WRN)\b|Registered tunnel connection/.test(line)) log(`[tunnel] ${line}`);
  });
  return { existing: false, closed, stop() { stopping = true; if (child.exitCode === null) child.kill(); } };
}
