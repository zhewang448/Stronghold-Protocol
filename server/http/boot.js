// server/http/boot.js — running the server as a process (`node server/index.js`, npm start, scripts/launch.mjs, the
// Windows service's scripts/run-server.cmd, NSSM, systemd):
//
//   * first, an update package extracted over the install (UPDATE.json) is finished — old files deleted, the install
//     verified (server/update.js); one that does not match its MANIFEST.json keeps the server from starting (exit 1);
//   * the boot banner: release version, the Local URL, the LAN URLs when listening on every interface, the plugin
//     studio's address with its key (server/studio/key.js: this machine and the local network only), the cloudflared
//     command for internet play;
//   * a server that cannot start exits 1 (with a hint when the port is in use); unhandled rejections and uncaught
//     exceptions are logged, not fatal;
//   * graceful shutdown on SIGINT/SIGTERM (rooms get room.closed{reason:'shutdown'}, sockets close 1001); a second
//     signal exits at once, and the process exits anyway 5 s after the first.

import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, DEV_BUILD } from '../../shared/constants.js';
import { N_ } from '../../shared/i18n.js';
import { limitKeyOf } from '../net.js';
import { applyPendingUpdate } from '../update.js';
import { ROOT } from './config.js';
import { startAdmin, loadSettings } from '../admin.js';
import { updatePaths } from '../release-update.js';
import { prepareRestart } from '../service-control.js';
import { recordInstance } from '../instance.js';

/**
 * Non-internal addresses as http URLs — IPv4 first, then IPv6 (an IPv6 literal needs brackets: `http://[240e:…]:3000`).
 * Link-local (`fe80::`) is left out: a URL cannot carry the zone id. Several privacy addresses in one /64 collapse
 * to one URL (`limitKeyOf`).
 * @param {number} port
 */
export function lanUrls(port) {
  const v4 = [];
  const v6 = [];
  const v6Seen = new Set();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.internal) continue;
      if (a.family === 'IPv4' || a.family === 4) { v4.push(`http://${a.address}:${port}`); continue; }
      if (a.family !== 'IPv6' && a.family !== 6) continue;
      if (/^fe80:/i.test(a.address)) continue;
      const prefix = limitKeyOf(a.address);
      if (v6Seen.has(prefix)) continue;
      v6Seen.add(prefix);
      v6.push(`http://[${a.address}]:${port}`);
    }
  }
  return [...v4, ...v6];
}

/**
 * The host as it appears in the local URL. A wildcard bind (`0.0.0.0` or `::`) reads `localhost`. An IPv6 literal
 * is bracketed (`http://[2001:db8::1]:3000`); an IPv4 address or a name is kept.
 * @param {string} host
 */
export function displayHost(host) {
  if (host === '0.0.0.0' || host === '::') return 'localhost';
  return host.includes(':') ? `[${host}]` : host;
}

/** Is the module whose `import.meta.url` is `metaUrl` the file node was started with? */
export function isProcessEntry(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

/**
 * Print the boot banner of a started server.
 * @param {{ url: string, host: string, port: number, studio?: { pageUrl: (base: string) => string | null } | null }} srv
 */
export function printBanner(srv) {
  console.log(`\n  卫戍协议：盟约 · Stronghold Protocol: Alliance v${APP_VERSION}`);
  if (DEV_BUILD) console.log('  ! 开发版（dev 分支）：不稳定，请勿用于公开服务器 · development build — unstable, not for public servers');
  console.log(`  Local:   ${srv.url}`);
  if (srv.host === '0.0.0.0' || srv.host === '::') {
    for (const u of lanUrls(srv.port)) console.log(`  LAN:     ${u}`);
  }
  // the plugin studio with its key: what a change in it needs (a raw TCP tunnel looks like this machine; the key does not)
  const studio = srv.studio?.pageUrl?.(srv.url);
  if (studio) console.log(`  Studio:  ${studio}  (插件工作台 · plugin studio — this machine and the LAN; the link carries its key)`);
  console.log('  Internet: cloudflared tunnel --url ' + `http://localhost:${srv.port}` + '\n');
}

/**
 * The process main: finish a pending update package, start the server, print the banner, stop gracefully on SIGINT /
 * SIGTERM.
 * @param {(options?: object) => Promise<{ url: string, host: string, port: number, close: () => Promise<void> }>} start index.js startServer
 */
export async function runMain(start) {
  // Installation validation never loads settings, resumes games, runs extensions, or exposes a public listener.
  if (process.env.SP_UPDATE_PROBE) {
    const nonce = process.env.SP_UPDATE_PROBE;
    const srv = await start({ host: '127.0.0.1', port: 0, recovery: false, studio: false, assetIndex: false });
    let closing = false;
    const stop = async () => { if (closing) return; closing = true; await srv.close(); process.exit(0); };
    const timer = setTimeout(() => { void stop(); }, 45000); timer.unref();
    process.on('message', (m) => { if (m?.t === 'sp.probe.stop' && m.nonce === nonce) void stop(); });
    process.on('disconnect', () => { void stop(); });
    process.send?.({ t: 'sp.updateProbe', nonce, pid: process.pid, port: srv.port });
    return;
  }
  // A service supervisor may restart while the detached installer is still copying. Load fresh code only afterward.
  const lock = updatePaths(ROOT).lock;
  try {
    const status = JSON.parse(fs.readFileSync(updatePaths(ROOT).status, 'utf8'));
    if (status.state === 'recovery-required') {
      console.error('[update] 请先关闭启动窗口及外部守护器，完成离线恢复后再启动。'); process.exitCode = 1; return;
    }
  } catch { /* no outstanding recovery */ }
  if (fs.existsSync(lock)) {
    console.log('[update] 等待安装器完成，请稍候…');
    for (let i = 0; i < 1200 && fs.existsSync(lock); i++) await new Promise((r) => setTimeout(r, 100));
    if (fs.existsSync(lock)) { console.error('[update] 安装锁未释放，请检查 logs/release-update-status.json'); process.exitCode = 1; return; }
    // This process imported old modules before waiting. Start a fresh process through the existing supervisor.
    process.exitCode = 1;
    return;
  }
  process.on('unhandledRejection', (e) => console.error('[process] unhandled rejection', e));
  process.on('uncaughtException', (e) => console.error('[process] uncaught exception', e));
  // before the data, the packs or the browser runtime are read: the files must be the new version's (server/update.js).
  // Nothing is listening yet, so returning ends the process with exit code 1 once the message is written.
  if (applyPendingUpdate(ROOT).state === 'failed') { process.exitCode = 1; return; }
  let srv;
  try {
    loadSettings(ROOT + '/logs/admin-settings.json', console);
    srv = await start({ recovery: true });
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') console.error(`端口已被占用 / port in use: ${e.port ?? process.env.PORT ?? 3000}. Try PORT=3001 npm start`);
    else console.error('[boot] failed to start', e);
    process.exit(1);
  }
  printBanner(srv);
  // the host's local console (server/admin.js): 127.0.0.1 only, never part of what the LAN / tunnel can reach
  let admin = null;
  let removeInstance = () => {};
  let stopping = false;
  const notify = (action) => { if (process.connected) process.send?.({ t: 'sp.lifecycle', action, pid: process.pid }, () => {}); };
  const stop = (signal, code = 0) => {
    if (stopping) { console.log('forced exit'); process.exit(1); }
    stopping = true;
    notify(signal === 'UPDATE' ? 'update' : signal === 'RESTART' ? 'restart' : 'shutdown');
    removeInstance();
    console.log(`\n[${signal}] shutting down…`);
    setTimeout(() => process.exit(code), 5000).unref();
    if (admin) admin.close();
    srv.close().then(() => process.exit(code), () => process.exit(code || 1));
  };
  if (!/^(0|false|no|off)$/i.test(process.env.SP_ADMIN || '')) {
    try {
      const supervised = process.env.SP_UPDATE_RESTART === 'supervisor';
      const managedShutdown = process.env.SP_SERVICE_SHUTDOWN === 'exit-code';
      admin = await startAdmin({ lobby: srv.lobby, network: srv.network, traffic: srv.traffic, root: ROOT, port: Number(process.env.SP_ADMIN_PORT) || srv.port + 100,
        studioUrl: srv.studio?.pageUrl?.(`http://127.0.0.1:${srv.port}`) || null,
        service: {
          shutdownReason: supervised && !managedShutdown ? N_('由外部守护程序管理，请使用服务管理器关闭服务') : '',
          prepare: async (action) => {
            const cancel = action === 'restart' && !supervised ? await prepareRestart(ROOT, {
              PORT: String(srv.port), HOST: srv.host, SP_ADMIN_PORT: String(admin.port),
            }) : null;
            return { cancel, run: () => stop(action.toUpperCase(), supervised ? (action === 'shutdown' ? 75 : 1) : 0) };
          },
        },
        updateOptions: { port: srv.port }, onUpdateReady: () => stop('UPDATE') });
      console.log(`  Console: ${admin.url}  (本机控制台)\n`);
      removeInstance = recordInstance(ROOT, { port: srv.port, adminPort: admin.port, token: admin.token });
    } catch (e) {
      console.warn(`  Console: 未启动（${e.code || e.message}）\n`);
      // A desktop launch must retain its authenticated stop/restart entry. Close only our own service.
      if (process.env.SP_REQUIRE_ADMIN === '1') { stop('ADMIN_FAILED', 75); return; }
    }
  }

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  notify('ready');
}
