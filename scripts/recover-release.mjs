#!/usr/bin/env node
// Offline recovery: never stop listeners, never overwrite a changed target without manual investigation.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreReleaseBackup } from '../server/update-backups.js';
import { acquireLease } from './host-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), at = args.indexOf('--backup'), p = args.indexOf('--port');
const id = args[at + 1], port = Number(p >= 0 ? args[p + 1] : process.env.PORT) || 3000;
if (at < 0 || !args.includes('--confirm')) {
  console.log('停服后运行：node scripts/recover-release.mjs --backup release-XXXXXX --port 3000 --confirm');
  process.exitCode = 2;
} else {
  let lease;
  const listeners = [];
  try {
    const lockFile = path.join(root, 'logs', 'release-update.lock');
    if (fs.existsSync(lockFile)) {
      const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      for (const pid of [lock.installerPid, lock.pid]) if (Number.isSafeInteger(pid) && pid > 0) {
        let alive = true;
        try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('更新安装器或原服务仍在运行，请等待退出后再恢复。');
      }
    }
    const instanceFile = path.join(root, 'logs', `server-instance-${port}.json`);
    if (fs.existsSync(instanceFile)) {
      const instance = JSON.parse(fs.readFileSync(instanceFile, 'utf8'));
      if (Number.isSafeInteger(instance.pid) && instance.pid > 0) {
        let alive = true;
        try { process.kill(instance.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('当前安装的服务进程仍在运行，请先停服。');
      }
    }
    lease = acquireLease(root, `runtime-${port}`);
    if (!lease.owned) throw new Error('请先关闭启动窗口及外部服务守护器，再执行离线恢复。');
    // Windows can bind a wildcard beside a specific listener. Check and reserve each local address instead.
    const addresses = new Set(['127.0.0.1', '::1', ...Object.values(os.networkInterfaces()).flat().filter(Boolean).map((a) => a.address)]);
    for (const host of addresses) {
      try {
        if (host === '127.0.0.1' || host === '::1') await new Promise((resolve, reject) => {
          const socket = net.connect({ port, host });
          socket.setTimeout(1000, () => { socket.destroy(); reject(new Error(`无法确认 ${host}:${port} 已停服`)); });
          socket.once('connect', () => { socket.destroy(); reject(new Error(`服务仍在监听 ${host}:${port}，请先停服。`)); });
          socket.once('error', (e) => { socket.destroy(); if (e.code === 'ECONNREFUSED') resolve(); else reject(e); });
        });
        const server = net.createServer(); listeners.push(server);
        await new Promise((resolve, reject) => {
          const fail = (e) => { server.removeListener('listening', ready); reject(e); };
          const ready = () => { server.removeListener('error', fail); resolve(); };
          server.once('error', fail); server.once('listening', ready); server.listen({ port, host, ipv6Only: host.includes(':') });
        });
      } catch (e) { if (!host.includes(':') || !['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'ENETUNREACH', 'EINVAL'].includes(e.code)) throw e; }
    }
    restoreReleaseBackup(root, id);
    fs.rmSync(path.join(root, 'logs', 'release-update.lock'), { force: true });
    fs.writeFileSync(path.join(root, 'logs', 'release-update-status.json'), JSON.stringify({ state: 'error', error: '已恢复原程序，请重新启动并检查。' }));
    console.log('原程序与版本元数据已恢复，请使用启动脚本重新启动。');
  } catch (e) { console.error(`恢复未完成：${e.message}`); process.exitCode = 1; }
  finally {
    for (const server of listeners) if (server.listening) await new Promise((resolve) => server.close(resolve));
    lease?.release?.();
  }
}
