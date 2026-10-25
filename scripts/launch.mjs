#!/usr/bin/env node
// scripts/launch.mjs — cross-platform "prepare + start + open the browser", used by scripts/start-windows.bat,
// scripts/start-windows.ps1 and scripts/start.sh (docs/DEPLOY.md).
//
//   node scripts/launch.mjs [--port 3000] [--host ::] [--no-open] [--no-setup] [--scripts sandbox] [--test-mode 1] [setup options…]
//
//   1. If our server already answers on the port, just open the browser (double-clicking twice is harmless).
//   2. An update package extracted over the folder (UPDATE.json) is finished (server/update.js; the server does it too,
//      for the routes that skip this script); one that does not fit this install stops here with the message.
//   3. node tools/setup.mjs --quiet (dependencies, vendor libs, art download / resume, optional local extraction);
//      setup options such as --no-assets, --no-local, --local, --game <dir>, -y are passed through.
//   4. node server/index.js (PORT / HOST from the options or the environment; SP_COMBAT / SP_VERIFY / TRUST_PROXY /
//      DEBUG are inherited; --scripts off | sandbox | trusted | trusted-force sets SP_PLUGIN_SCRIPTS for it, the plugin
//      script mode of docs/PLUGINS.md §13 — scripts/start-windows-sandbox.bat is `--scripts sandbox` on a double click).
//      --test-mode off | 1 | force sets SP_TEST_MODE for it (docs/DEPLOY.md 测试控制台): off removes an inherited value,
//      a bare --test-mode means 1. 1 enables test rooms on a local or LAN listener, including a wildcard
//      bind when every interface address is private. A public address or a wildcard bind on a machine
//      with a public address is refused with a Chinese hint unless the value is force. An unrecognised
//      SP_TEST_MODE word stays off and warns.
//      then — once /healthz answers — prints the addresses to share and opens http://localhost:<port> (not with
//      --no-open, SP_NO_BROWSER=1, or on a Linux box without a display).
// Ctrl+C stops the server (it gets the signal from the terminal itself); the exit code is the server's.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { runningInstance } from '../server/instance.js';
import { acquireLease, superviseServer, openTunnel } from './host-runtime.mjs';
// 打开浏览器只有一份实现（走 shell 关联 = 默认浏览器，且不会把浏览器拉成提权）
import { openBrowser as openInBrowser } from './open-browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error(`Node.js ${process.versions.node} 太旧，需要 22 或更高（22 / 24 LTS）：https://nodejs.org/zh-cn/download`);
  process.exit(1);
}

const { c, mark } = await import('../tools/setup.mjs');
const { probePort, classifyAddresses, hostUrl, KIND_LABEL } = await import('../tools/doctor.mjs');
const { applyPendingUpdate, UPDATE_FILE } = await import('../server/update.js');
const { parseTestModeEnv, testModeGate, unrecognizedTestMode } = await import('../server/testMode.js');

/** The values --scripts takes: off, or a mode server/plugins/policy.js reads from SP_PLUGIN_SCRIPTS. */
export const SCRIPT_MODES = Object.freeze(['off', 'sandbox', 'trusted', 'trusted-force']);
/** The values --test-mode takes. `1` is the local/LAN switch; `force` is the public-listener override. */
export const TEST_MODE_FLAGS = Object.freeze(['off', '1', 'force']);

export function parseArgs(argv) {
  const o = { port: Number(process.env.PORT) || 3000, host: process.env.HOST || '::', tunnel: false, open: !/^(1|true|yes)$/i.test(process.env.SP_NO_BROWSER || ''), setup: true, setupArgs: [], help: false, scripts: undefined, testMode: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, v] = a.split('=');
    const val = () => (v !== undefined ? v : argv[++i]);
    if (k === '--port') o.port = Number(val()) || o.port;
    else if (k === '--host') o.host = val() || o.host;
    else if (k === '--room-code') o.roomCode = val() ?? '';
    else if (a === '--no-open') o.open = false;
    else if (a === '--tunnel') o.tunnel = true;
    else if (a === '--no-tunnel') o.tunnel = false;
    else if (a === '--no-setup') o.setup = false;
    else if (k === '--scripts') o.scripts = val() ?? '';
    else if (k === '--test-mode') o.testMode = v !== undefined ? v : argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : '1';
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--game') o.setupArgs.push(a, argv[++i] ?? '');
    else o.setupArgs.push(a);
  }
  return o;
}

/** The server's environment: PORT / HOST, SP_PLUGIN_SCRIPTS from --scripts, SP_TEST_MODE from --test-mode (off removes an inherited one). */
export function serverEnv(o, base = process.env) {
  const env = { ...base, PORT: String(o.port), HOST: o.host };
  delete env.SP_ROOM_CODE;
  if (o.scripts === 'off') delete env.SP_PLUGIN_SCRIPTS;
  else if (o.scripts) env.SP_PLUGIN_SCRIPTS = o.scripts;
  if (o.testMode === 'off') delete env.SP_TEST_MODE;
  else if (o.testMode) env.SP_TEST_MODE = o.testMode;
  return env;
}

function openBrowser(url) {
  return openInBrowser(url) !== null;
}

/**
 * Chinese startup hint for a refused `1` or an unrecognised SP_TEST_MODE. `interfaces` is a test snapshot.
 * @param {{ host?: string }} o @param {NodeJS.ProcessEnv} env @param {{ warn?: (s: string) => void }} [log]
 * @param {object} [interfaces]
 */
export function warnTestMode(o, env, log = console, interfaces) {
  const raw = env && env.SP_TEST_MODE;
  const unknown = unrecognizedTestMode(raw);
  if (unknown) { log.warn?.(unknown); return; }
  const mode = parseTestModeEnv(raw);
  if (mode === 'off') return;
  const gate = testModeGate(mode, o && o.host, interfaces);
  if (gate.warn && mode === 'local') log.warn?.(gate.warn);
}

function printShare(port) {
  const addrs = classifyAddresses().filter((a) => a.kind === 'lan' || a.kind === 'vpn' || a.kind === 'public');
  const line = c.dim('─'.repeat(56));
  console.log(`\n${line}`);
  console.log(`${mark.ok} ${c.bold('服务器已启动')}   本机打开：${c.cyan(`http://localhost:${port}`)}`);
  if (addrs.length) {
    console.log('  发给朋友（需要能访问这台电脑的网络）：');
    for (const a of addrs.slice(0, 4)) console.log(`    ${c.cyan(hostUrl(a.address, port))}  ${c.dim(KIND_LABEL[a.kind])}`);
  } else {
    console.log(c.warn('  没有检测到可以分享的地址：朋友暂时无法连接（检查网线/Wi-Fi）。'));
  }
  console.log(c.dim('  建房后把 4 位「同盟密钥」或「复制链接」（…/?room=密钥）发给朋友。'));
  console.log(c.dim('  朋友打不开？运行 node tools/doctor.mjs 检查防火墙。按 Ctrl+C 停止服务器。'));
  console.log(`${line}\n`);
}

export async function prepareLaunch(o, { root = ROOT, probe = probePort, running = runningInstance,
  update = applyPendingUpdate, setup = () => spawnSync(process.execPath, [path.join(root, 'tools', 'setup.mjs'), '--quiet', ...o.setupArgs], { cwd: root, stdio: 'inherit', windowsHide: true }).status } = {}) {
  const before = await probe(o.port, o.host);
  if (before.state !== 'free') {
    const instance = before.state === 'ours' ? await running(root, o.port) : null;
    return instance ? { state: 'existing', instance } : { state: 'blocked', code: before.code || before.state };
  }
  if (fs.existsSync(path.join(root, 'logs', 'release-update.lock'))) return { state: 'failed', code: 1, error: '更新安装正在进行或需要恢复，请先检查 logs/release-update-status.json。' };
  try {
    const status = JSON.parse(fs.readFileSync(path.join(root, 'logs', 'release-update-status.json'), 'utf8'));
    if (status.state === 'recovery-required') return { state: 'failed', code: 1, error: '更新需要离线恢复，请关闭启动窗口及外部守护器后按恢复说明操作。' };
  } catch { /* no outstanding recovery */ }
  if (update(root).state === 'failed') return { state: 'failed', code: 1 };
  const code = o.setup ? await setup() : 0;
  return code === 0 ? { state: 'ready' } : { state: 'failed', code: code || 1 };
}

export async function launch(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  if (o.help) {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
    const end = src.findIndex((l, i) => i > 0 && !l.startsWith('//'));
    console.log(src.slice(1, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  if (o.scripts !== undefined && !SCRIPT_MODES.includes(o.scripts)) {
    console.error(`${mark.err} --scripts 只接受 ${SCRIPT_MODES.join(' / ')}（插件脚本模式，docs/PLUGINS.md §13） · --scripts takes ${SCRIPT_MODES.join(' / ')}`);
    return 2;
  }
  if (o.testMode !== undefined && !TEST_MODE_FLAGS.includes(o.testMode)) {
    console.error(`${mark.err} --test-mode 只接受 ${TEST_MODE_FLAGS.join(' / ')}（测试房间，docs/DEPLOY.md） · --test-mode takes ${TEST_MODE_FLAGS.join(' / ')}`);
    return 2;
  }
  const localUrl = `http://localhost:${o.port}`;

  const lease = acquireLease(ROOT, `launch-${o.port}`);
  if (!lease.owned) { console.log('当前安装的启动流程正在运行，请查看原启动窗口。'); return 0; }
  let before;
  try { before = await prepareLaunch(o); }
  catch (e) { lease.release(); throw e; }
  if (before.state === 'existing') {
    lease.release();
    console.log(`${mark.ok} 服务器已经在运行（端口 ${o.port}），直接打开浏览器。`);
    if (o.scripts !== undefined) console.log(c.warn(`  --scripts ${o.scripts} 不会改变正在运行的服务器：先停止它（关掉它的窗口），再重新启动。`));
    if (o.testMode !== undefined) console.log(c.warn(`  --test-mode ${o.testMode} 不会改变正在运行的服务器：先停止它（关掉它的窗口），再重新启动。`));
    if (fs.existsSync(path.join(ROOT, UPDATE_FILE))) {
      console.log(c.warn(`  解压过的更新包还没有应用：正在运行的仍是旧版本。先停止它（关掉它的窗口；开机自启用 install-service-windows.ps1 -Restart），再重新启动即可。`));
    }
    printShare(o.port);
    if (o.open) openBrowser(localUrl);
    if (!o.tunnel) return 0;
    const tunnel = openTunnel({ root: ROOT, port: o.port, onUrl: (url) => console.log(`公网地址：${url}`) });
    if (tunnel.existing) return 0;
    const stop = () => tunnel.stop();
    let missingSince = 0, checking = false;
    const monitor = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        if (await runningInstance(ROOT, o.port)) missingSince = 0;
        else {
          missingSince ||= Date.now();
          // Keep the tunnel through normal restarts and the installer's two-minute lock window.
          const grace = fs.existsSync(path.join(ROOT, 'logs', 'release-update.lock')) ? 150000 : 60000;
          if (Date.now() - missingSince > grace) { console.log('本机服务持续离线，正在关闭本窗口创建的公网隧道。'); tunnel.stop(); }
        }
      } finally { checking = false; }
    }, 1000);
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try { return await tunnel.closed; }
    finally { clearInterval(monitor); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); tunnel.stop(); }
  }
  if (before.state === 'blocked') {
    lease.release();
    console.error(`${mark.err} 端口 ${o.port} 被其他程序占用或无权限（${before.code || before.state}）。`);
    console.error(`  换一个端口：${IS_WIN ? 'scripts\\start-windows.bat --port 3001' : 'scripts/start.sh --port 3001'}`);
    return 1;
  }

  if (before.state === 'failed') { lease.release(); console.error(`${mark.err} ${before.error || '准备步骤失败（见上方）。'}`); return before.code; }

  const env = serverEnv(o);
  warnTestMode(o, env);
  const runtime = superviseServer({ root: ROOT, port: o.port, env, serverArgs: o.roomCode ? ['--room-code', o.roomCode] : [],
    onHealthy: ({ first }) => { if (!first) console.log('服务器已恢复，公网隧道保持连接。'); } });
  let tunnel;
  const stop = () => { runtime.stop(); tunnel?.stop(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await runtime.ready; lease.release(); printShare(o.port);
    if (o.open && !openBrowser(localUrl)) console.log(c.dim(`（未能自动打开浏览器，请手动访问 ${localUrl}）`));
    if (o.tunnel) tunnel = openTunnel({ root: ROOT, port: o.port, onUrl: (url) => console.log(`公网地址：${url}\n临时网址更换后，本机个人数据需通过备份迁移。`) });
    return await runtime.done;
  } finally { lease.release(); stop(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}

// Same convention as tools/setup.mjs: the helpers above are importable, but only running this file starts anything.
// Without the guard, importing launch.mjs would fall through to main() in the background and bind a port.
function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) {
  launch().then((code) => { process.exitCode = code; }, (e) => { console.error(e?.stack || e); process.exitCode = 1; });
}
