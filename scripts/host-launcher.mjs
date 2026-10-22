#!/usr/bin/env node
// Desktop transport around the existing launcher, doctor and authenticated instance controls.
// i18n-ignore-file: host-only diagnostics, same boundary as scripts/launch.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runningInstance } from '../server/instance.js';
import { probePort, classifyAddresses, hostUrl, KIND_LABEL } from '../tools/doctor.mjs';
import { checkAssets, checkData, checkDeps, checkVendor } from '../tools/setup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const alive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

export function parseDesktopArgs(args) {
  const options = { action: 'launch', port: 3000, host: '::', tunnel: false, setup: true };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--status') options.action = 'status';
    else if (arg === '--inspect') options.action = 'inspect';
    else if (arg === '--restart') options.action = 'restart';
    else if (arg === '--port') options.port = Number(args[++i]);
    else if (arg === '--host') options.host = args[++i];
    else if (arg === '--tunnel') options.tunnel = true;
    else if (arg === '--no-setup') options.setup = false;
    else if (arg !== '--no-open') throw new Error('Unknown desktop launcher option: ' + arg);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65435) throw new Error('Invalid game port (1024–65435)');
  if (!['127.0.0.1', '::'].includes(options.host)) throw new Error('Invalid desktop bind address');
  return options;
}

export function redactLog(text) {
  return String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/([?&](?:key|token|secret)=)[^\s&#)]+/gi, '$1[redacted]');
}

export async function desktopStatus({ root = ROOT, port = 3000, running = runningInstance, probe = probePort, isAlive = alive, addresses = classifyAddresses } = {}) {
  const instance = await running(root, port);
  const desktop = readJson(path.join(root, 'logs', 'host-launcher-state-' + port + '.json'));
  const managed = desktop?.port === port && isAlive(desktop.pid);
  const tunnel = readJson(path.join(root, 'logs', 'tunnel-' + port + '.json'));
  const tunnelUrl = isAlive(tunnel?.pid) && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(tunnel?.url || '') ? tunnel.url : null;
  if (!instance) {
    const report = await probe(port);
    return { state: report.state === 'free' ? managed ? 'starting' : 'stopped' : 'busy', managed, addresses: [] };
  }
  const links = [{ label: '本机', url: hostUrl('localhost', port) }];
  if (managed && desktop.host === '::') {
    for (const address of addresses().filter((item) => ['lan', 'vpn', 'public'].includes(item.kind)).slice(0, 3))
      links.push({ label: KIND_LABEL[address.kind], url: hostUrl(address.address, port) });
  }
  if (tunnelUrl) links.unshift({ label: '公网隧道', url: tunnelUrl });
  return { state: 'online', managed, addresses: links, tunnelUrl, adminUrl: hostUrl('127.0.0.1', instance.adminPort),
    activeMatches: instance.service.activeMatches, canRestart: instance.service.canRestart, canShutdown: instance.service.canShutdown,
    recoveryEnabled: instance.service.recoveryEnabled, action: instance.service.action || null };
}

export async function restartDesktop({ root = ROOT, port = 3000, running = runningInstance, fetchImpl = fetch } = {}) {
  const instance = await running(root, port);
  if (!instance) return { ok: false, error: '无法确认服务属于当前安装，未操作任何进程。' };
  if (!instance.service.canRestart) return { ok: false, error: '当前启动方式不支持重启。' };
  const response = await fetchImpl('http://127.0.0.1:' + instance.adminPort + '/api/service', {
    method: 'POST', headers: { 'X-Admin-Token': instance.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'restart', confirm: true, confirmActive: true }), redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  return response.ok && body.ok ? { ok: true } : { ok: false, error: body.error || '重启请求失败。' };
}

export async function launchDesktop(options, { root = ROOT, spawnImpl = spawn, probe = probePort,
  adminPort = Number(process.env.SP_ADMIN_PORT) || options.port + 100 } = {}) {
  const { port, host } = options;
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  const logPath = path.join(root, 'logs', 'host-launcher-' + port + '.log');
  const statePath = path.join(root, 'logs', 'host-launcher-state-' + port + '.json');
  const own = (await probe(port)).state === 'free';
  if (own && (await probe(adminPort, '127.0.0.1')).state !== 'free')
    throw new Error('管理端口 ' + adminPort + ' 已被占用，请更换游戏端口；未启动服务器，未结束任何进程。');
  const previous = readJson(statePath);
  if (previous && alive(previous.pid)) throw new Error('当前安装的桌面启动流程正在运行。');
  if (own) fs.writeFileSync(statePath, JSON.stringify({ pid: process.pid, port, host }), { mode: 0o600 });
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) {
      const previousLog = logPath + '.previous';
      fs.rmSync(previousLog, { force: true });
      fs.renameSync(logPath, previousLog);
    }
    const fd = fs.openSync(logPath, 'a');
    const log = (line) => fs.writeSync(fd, redactLog(line));
    try {
      log('\n[launcher] ' + new Date().toISOString() + ' starting on port ' + port + '\n');
      const args = [path.join(root, 'scripts', 'launch.mjs'), '--port', String(port), '--host', host, '--no-open'];
      if (options.tunnel) args.push('--tunnel');
      if (!options.setup) args.push('--no-setup');
      const child = spawnImpl(process.execPath, args, { cwd: root, env: { ...process.env, NO_COLOR: '1', SP_ADMIN: '1', SP_REQUIRE_ADMIN: '1' },
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      for (const stream of [child.stdout, child.stderr]) if (stream) {
        stream.setEncoding('utf8');
        let pending = '';
        stream.on('data', (text) => {
          pending += text;
          let end;
          while ((end = pending.indexOf('\n')) >= 0) { log(pending.slice(0, end + 1)); pending = pending.slice(end + 1); }
        });
        stream.on('end', () => { if (pending) log(pending + '\n'); });
      }
      return await new Promise((resolve) => {
        child.once('error', (error) => { log('[launcher] ' + error.message + '\n'); });
        child.once('close', (code) => { log('[launcher] stopped with code ' + (code ?? 1) + '\n'); resolve(code ?? 1); });
      });
    } finally { fs.closeSync(fd); }
  } finally {
    if (own && readJson(statePath)?.pid === process.pid) fs.rmSync(statePath, { force: true });
  }
}

async function main() {
  const options = parseDesktopArgs(process.argv.slice(2));
  if (options.action === 'status') console.log(JSON.stringify(await desktopStatus({ port: options.port })));
  else if (options.action === 'inspect') console.log(JSON.stringify({ deps: checkDeps(), vendor: checkVendor(), data: checkData(), assets: checkAssets() }));
  else if (options.action === 'restart') console.log(JSON.stringify(await restartDesktop({ port: options.port })));
  else process.exitCode = await launchDesktop(options);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(redactLog(error.message)); process.exitCode = 1; });
}
