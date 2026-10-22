#!/usr/bin/env node
// Gracefully stop only the authenticated server belonging to this installation. Never kill port owners.
//
//   node scripts/free-port.mjs [--port 3000]
//
// Used by scripts/stop-server.bat; a port owner is never stopped without this install's authenticated token.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { probePort } from '../tools/doctor.mjs';
import { stopInstance } from '../server/instance.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function freePort(port, { root = ROOT, confirmActive = false, stop = stopInstance, probe = probePort, log = console.log } = {}) {
  if ((await probe(port)).state === 'free') return true;
  const result = await stop(root, port, { confirmActive });
  if (!result.ok) { log(result.error); return false; }
  for (const until = Date.now() + 10000; Date.now() < until;) {
    if ((await probe(port)).state === 'free') { log(`端口 ${port} 已释放。`); return true; }
    await new Promise((r) => setTimeout(r, 200));
  }
  log('服务尚未停止，请检查控制台；未强制结束任何进程。');
  return false;
}

function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) {
  const i = process.argv.indexOf('--port');
  const port = Number(i >= 0 ? process.argv[i + 1] : process.env.PORT) || 3000;
  if ((await probePort(port)).state === 'free') { console.log(`端口 ${port} 已空闲。`); process.exit(0); }
  let confirmed = process.argv.includes('--confirm-active');
  if (!confirmed && process.stdin.isTTY) {
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    try { confirmed = /^(y|yes|是)$/i.test((await readline.question('停止当前安装的服务并结束活动对局？[y/N] ')).trim()); }
    finally { readline.close(); }
    if (!confirmed) process.exit(0);
  }
  process.exitCode = await freePort(port, { confirmActive: confirmed }) ? 0 : 1;
}
