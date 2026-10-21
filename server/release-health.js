// A private loopback probe loads the candidate without restoring matches or writing host settings.
// i18n-ignore-file: host-only update diagnostics, not player UI (same boundary as server/release-update.js).
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { computeBuildTag } from './http/buildTag.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function supportsUpdateProbe(root) {
  return ['server/http/boot.js', 'server/index.js'].some((rel) => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8').includes('SP_UPDATE_PROBE'); } catch { return false; }
  });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}
async function socketCheck(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { handshakeTimeout: 2000 });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket 心跳验证超时')), 2500);
      const finish = (error) => { clearTimeout(timer); if (error) reject(error); else resolve(); };
      ws.once('error', finish);
      ws.once('close', () => finish(new Error('WebSocket 验证期间连接关闭')));
      ws.on('open', () => ws.send(JSON.stringify({ t: 'ping', c: 123456789 })));
      ws.on('message', (bytes) => { try { const m = JSON.parse(String(bytes)); if (m.t === 'pong' && m.c === 123456789) finish(); } catch {} });
    });
  } finally { ws.terminate(); }
}
export async function waitReleaseHealth(root, port, { app, timeout = 30000, exited = () => false } = {}) {
  const build = computeBuildTag(root), until = Date.now() + timeout;
  let last = '服务尚未就绪';
  while (Date.now() < until && !exited()) {
    try {
      const get = (rel) => fetch(`http://127.0.0.1:${port}${rel}`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
      const response = await get('/healthz');
      if (!response.ok) throw new Error('健康接口未就绪');
      const h = await response.json();
      if (h.ok !== true || h.app !== app || h.build !== build) throw new Error('服务版本或构建指纹与目标不一致');
      const page = await get('/'), script = await get('/js/main.js');
      if (!page.ok || !/<html[\s>]/i.test(await page.text()) || !script.ok || !(await script.text()).trim()) throw new Error('关键前端资源验证失败');
      await socketCheck(port);
      return { app, build };
    } catch (e) { last = e.message; await sleep(150); }
  }
  throw new Error(`启动健康验证失败：${last}`);
}
export async function probeRelease(root, { app, timeout = 30000, legacy = false } = {}) {
  const nonce = crypto.randomBytes(16).toString('hex'), port = await freePort();
  let log = '', exited = false, actualPort = legacy ? port : null;
  const child = spawn(process.execPath, [...process.execArgv, path.join(root, 'server', 'index.js')], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), SP_ADMIN: '0', SP_REPLAY: '0',
      SP_PLUGIN_SCRIPTS: 'off', SP_UPDATE_RESTART: '', SP_UPDATE_PROBE: nonce },
  });
  let spawnError;
  const finished = new Promise((resolve) => { child.once('exit', () => { exited = true; resolve(); }); child.once('error', (e) => { spawnError = e; exited = true; resolve(); }); });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (d) => { log = (log + String(d)).slice(-3000); });
  child.on('message', (m) => { if (m?.t === 'sp.updateProbe' && m.nonce === nonce && m.pid === child.pid && Number.isInteger(m.port)) actualPort = m.port; });
  try {
    const until = Date.now() + timeout;
    while (!actualPort && !exited && Date.now() < until) await sleep(100);
    if (!actualPort || exited) throw spawnError || new Error(`候选服务未就绪：${log}`);
    return await waitReleaseHealth(root, actualPort, { app, timeout: Math.max(1, until - Date.now()), exited: () => exited });
  } finally {
    if (!exited) {
      if (!legacy && child.connected) child.send({ t: 'sp.probe.stop', nonce }, () => {});
      else child.kill('SIGTERM');
      let timer;
      try { await Promise.race([finished, new Promise((resolve) => { timer = setTimeout(resolve, 3000); })]); }
      finally { clearTimeout(timer); }
      if (!exited) { child.kill('SIGKILL'); await finished; }
    }
  }
}
