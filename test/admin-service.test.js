import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { startAdmin } from '../server/admin.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const silent = { info() {}, error() {}, warn() {} };
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function until(fn) {
  for (let i = 0; i < 120; i++) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error('service did not reach expected state');
}
const browserCookies = new Map();
const pageCookies = new Map();
async function pageToken(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500), headers: pageCookies.has(url) ? { Cookie: pageCookies.get(url) } : {} });
    const token = (await response.text()).match(/const TOKEN = '([a-f0-9]+)'/)?.[1];
    if (token) { const cookie = response.headers.get('set-cookie')?.split(';')[0]; browserCookies.set(token, cookie); pageCookies.set(url, cookie); }
    return token;
  }
  catch { return null; }
}
const call = (url, token, body, headers = {}) => fetch(`${url}/api/service`, {
  method: body ? 'POST' : 'GET', headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json', ...(browserCookies.has(token) ? { Cookie: browserCookies.get(token) } : {}), ...headers },
  body: body && JSON.stringify(body),
});

test('service API requires local authentication and explicit confirmation, serializes updates and service actions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-service-api-'));
  const lobby = { rooms: new Map(), onMatchEnd() {}, safeData: () => ({}) };
  let run = 0, prepared = 0, release;
  const admin = await startAdmin({ root, lobby, port: 0, resultsDir: root, settingsFile: path.join(root, 'settings.json'), log: silent,
    onUpdateReady() {}, updateOptions: { fetchImpl: () => new Promise((r) => { release = () => r(new Response('[]')); }) },
    service: { prepare: async () => { prepared++; return { run: () => { run++; } }; } },
  });
  try {
    assert.equal((await call(admin.url, '')).status, 403);
    const foreignStatus = await new Promise((resolve, reject) => {
      const req = http.request(`${admin.url}/api/service`, { method: 'POST', headers: { Host: 'evil.example', 'X-Admin-Token': admin.token } }, (res) => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject); req.end('{"action":"shutdown","confirm":true}');
    });
    assert.equal(foreignStatus, 403);
    assert.equal((await call(admin.url, admin.token, { action: 'restart' })).status, 400);
    assert.equal((await call(admin.url, admin.token, { action: 'unknown', confirm: true })).status, 400);
    const checking = fetch(`${admin.url}/api/update`, { method: 'POST', headers: { 'X-Admin-Token': admin.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }) });
    await until(() => release);
    assert.equal((await call(admin.url, admin.token, { action: 'restart', confirm: true })).status, 409);
    release(); await checking;
    const responses = await Promise.all(['restart', 'shutdown'].map((action) => call(admin.url, admin.token, { action, confirm: true })));
    assert.deepEqual(responses.map((r) => r.status).sort(), [202, 409]);
    assert.equal(prepared, 1);
    assert.equal(run, 0, 'response delivered before service stops');
    assert.equal((await fetch(`${admin.url}/api/update`, { method: 'POST', headers: { 'X-Admin-Token': admin.token, 'Content-Type': 'application/json' }, body: '{"action":"check"}' })).status, 409);
    await until(() => run === 1);
  } finally { await admin.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('service API disables unsupported shutdown and permits retry after preparation fails', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-service-fail-'));
  let calls = 0;
  const admin = await startAdmin({ root, lobby: { rooms: new Map(), onMatchEnd() {} }, port: 0, resultsDir: root,
    settingsFile: path.join(root, 'settings.json'), log: silent, service: { shutdownReason: '请使用服务管理器',
      prepare: async () => { calls++; throw new Error('helper failed'); } } });
  try {
    const state = await (await call(admin.url, admin.token)).json();
    assert.equal(state.canShutdown, false);
    assert.equal((await call(admin.url, admin.token, { action: 'shutdown', confirm: true })).status, 409);
    for (let i = 0; i < 2; i++) assert.equal((await call(admin.url, admin.token, { action: 'restart', confirm: true })).status, 500);
    assert.equal(calls, 2);
    assert.equal((await (await call(admin.url, admin.token)).json()).action, null);
  } finally { await admin.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('real background server restarts once on the same ports and shutdown releases both listeners', { timeout: 30000 }, async () => {
  const port = await freePort(), adminPort = await freePort();
  const url = `http://127.0.0.1:${adminPort}`;
  const child = spawn(process.execPath, ['server/index.js'], { windowsHide: true,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', SP_ADMIN: '1', SP_ADMIN_PORT: String(adminPort),
      SP_UPDATE_RESTART: '', SP_SERVICE_SHUTDOWN: '', SP_REPLAY: '0' }, stdio: 'ignore' });
  let restartedPid;
  try {
    const token = await until(() => pageToken(url));
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
    assert.equal((await call(url, token, { action: 'restart', confirm: true })).status, 202);
    const newToken = await until(async () => { const t = await pageToken(url); return t && t !== token && t; });
    restartedPid = (await (await call(url, newToken)).json()).instanceId;
    assert.notEqual(restartedPid, child.pid);
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
    assert.equal((await call(url, token, { action: 'shutdown', confirm: true })).status, 403);
    assert.equal((await call(url, newToken, { action: 'shutdown', confirm: true })).status, 202);
    await until(async () => !await pageToken(url));
    // The console closes before the game server finishes its graceful shutdown.
    await until(() => {
      try { process.kill(restartedPid, 0); return false; }
      catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    });
    for (const p of [port, adminPort]) {
      const listener = net.createServer();
      await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(p, '127.0.0.1', resolve); });
      await new Promise((r) => listener.close(r));
    }
  } finally {
    child.kill();
    if (restartedPid) try { process.kill(restartedPid); } catch { /* already exited */ }
  }
});

test('supervised server delegates restart and uses the explicit shutdown exit code only when supported', { timeout: 30000 }, async () => {
  for (const [mode, action, expected] of [['', 'restart', 1], ['exit-code', 'shutdown', 75]]) {
    const port = await freePort(), adminPort = await freePort();
    const url = `http://127.0.0.1:${adminPort}`;
    const child = spawn(process.execPath, ['server/index.js'], { windowsHide: true, stdio: 'ignore',
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', SP_ADMIN: '1', SP_ADMIN_PORT: String(adminPort),
        SP_UPDATE_RESTART: 'supervisor', SP_SERVICE_SHUTDOWN: mode, SP_REPLAY: '0' } });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try {
      const token = await until(() => pageToken(url));
      if (!mode) {
        assert.equal((await (await call(url, token)).json()).canShutdown, false);
        assert.equal((await call(url, token, { action: 'shutdown', confirm: true })).status, 409);
      }
      assert.equal((await call(url, token, { action, confirm: true })).status, 202);
      assert.equal(await exited, expected);
      assert.equal(await pageToken(url), null, 'no detached replacement under supervisor');
    } finally { child.kill(); }
  }
});

test('Windows task runner honors console shutdown without entering its restart loop', { skip: process.platform !== 'win32', timeout: 10000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-task-shutdown-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'server'));
  fs.copyFileSync('scripts/run-server.cmd', path.join(root, 'scripts', 'run-server.cmd'));
  fs.writeFileSync(path.join(root, 'scripts', 'service.env.cmd'), `@set "NODE_EXE=${process.execPath}"\r\n`);
  fs.writeFileSync(path.join(root, 'server', 'index.js'), "require('fs').writeFileSync('started.json', JSON.stringify(process.env)); process.exit(75);\n");
  const child = spawn('cmd.exe', ['/d', '/c', 'scripts\\run-server.cmd'], { cwd: root, windowsHide: true, stdio: 'ignore' });
  try {
    assert.equal(await new Promise((r) => child.once('exit', r)), 0);
    const env = JSON.parse(fs.readFileSync(path.join(root, 'started.json'), 'utf8'));
    assert.equal(env.SP_SERVICE_SHUTDOWN, 'exit-code');
    assert.equal(env.SP_UPDATE_RESTART, 'supervisor');
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'logs', 'server.log'), 'utf8'), /restarting in/);
  } finally { child.kill(); fs.rmSync(root, { recursive: true, force: true }); }
});
