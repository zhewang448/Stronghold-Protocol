import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { scriptFixture } from './helpers/scriptFixtures.js';
import { ROOT } from './e2e/client.mjs';
import { probeRelease } from '../server/release-health.js';
import { superviseServer, openTunnel } from '../scripts/host-runtime.mjs';
import { runningInstance } from '../server/instance.js';
import { APP_VERSION } from '../shared/constants.js';
import { applyReleaseStage } from '../server/release-install.js';
import { acquireLease } from '../scripts/host-runtime.mjs';
import { manifest } from './helpers/release-fixture.js';


test('desktop-required admin bind failure closes only its own game service', { timeout: 30000 }, async (t) => {
  const f = checkout(t), port = await freePort();
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const adminPort = listener.address().port;
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const child = spawn(process.execPath, [path.join(f.root, 'server/index.js')], {
    cwd: f.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', SP_ADMIN: '1', SP_ADMIN_PORT: String(adminPort),
      SP_REQUIRE_ADMIN: '1', SP_REPLAY: '0', SP_ASSET_INDEX: '0' },
  });
  let output = '';
  child.stdout.on('data', value => { output += value; });
  child.stderr.on('data', value => { output += value; });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 75, output);
  assert.match(output, /Console: 未启动/);
  assert.equal(listener.listening, true, 'the unrelated admin-port owner was not stopped');
  assert.equal(await runningInstance(f.root, port), null);
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 300; i++) { const result = await fn(); if (result) return result; await sleep(100); }
  throw new Error('Lifecycle integration timed out');
}
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port; await new Promise((r) => server.close(r)); return port;
}
function checkout(t) {
  const f = scriptFixture(t);
  for (const dir of ['server', 'shared', 'data', 'public']) fs.cpSync(path.join(ROOT, dir), path.join(f.root, dir), {
    recursive: true, filter: (src) => !['assets', 'vendor', 'fonts'].includes(path.basename(src)),
  });
  fs.cpSync(path.join(ROOT, 'tools'), path.join(f.root, 'tools'), { recursive: true, filter: (src) => !path.basename(src).startsWith('.') });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(f.root, 'package.json'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(f.root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return f;
}
function snapshot(dir) {
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map((item) => [item.name,
    item.isDirectory() ? snapshot(path.join(dir, item.name)) : fs.readFileSync(path.join(dir, item.name)).toString('base64')]);
}

test('real project update probe leaves settings, recovery, plugin files and cache unchanged and disables trusted scripts', { timeout: 60000 }, async (t) => {
  const f = checkout(t);
  f.put('probe-service', 'export default () => {};', { class: 'trusted', scope: ['server'], permissions: ['trusted.server'], entry: { server: 'server.js' } }, {
    'server.js': `import fs from 'node:fs'; fs.writeFileSync('logs/trusted-ran', 'unsafe'); export function activate() { throw new Error('must not run'); }`,
  });
  fs.mkdirSync(path.join(f.root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'logs/admin-settings.json'), '{"recovery":{"enabled":true}}');
  fs.writeFileSync(path.join(f.root, 'logs/recovery.json'), '{"sentinel":"preserve"}');
  const before = ['logs', '.cache', 'plugins'].map((dir) => snapshot(path.join(f.root, dir)));
  const result = await probeRelease(f.root, { app: APP_VERSION });
  assert.equal(result.app, APP_VERSION); assert.ok(result.build);
  assert.deepEqual(['logs', '.cache', 'plugins'].map((dir) => snapshot(path.join(f.root, dir))), before);
});

test('real supervised server restarts with the same tunnel and graceful shutdown ends both lifecycles', { timeout: 60000 }, async (t) => {
  const f = checkout(t), port = await freePort(), adminPort = await freePort();
  const runtime = superviseServer({ root: f.root, port, log() {}, restartDelay: 10,
    env: { ...process.env, HOST: '127.0.0.1', SP_ADMIN_PORT: String(adminPort), SP_REPLAY: '0', SP_ASSET_INDEX: '0' } });
  t.after(async () => { runtime.stop(); await runtime.done; });
  await runtime.ready;
  let tunnels = 0;
  const child = new EventEmitter(); Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null });
  child.kill = () => { child.exitCode = 0; child.emit('exit', 0); child.stdout.end(); child.stderr.end(); };
  const tunnel = openTunnel({ root: f.root, port, log() {}, spawnImpl: () => { tunnels++; return child; } });
  t.after(() => tunnel.stop());
  const original = await runningInstance(f.root, port);
  const call = (instance, action) => fetch(`http://127.0.0.1:${instance.adminPort}/api/service`, {
    method: 'POST', headers: { 'X-Admin-Token': instance.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, confirm: true }),
  });
  assert.equal((await call(original, 'restart')).status, 202);
  const next = await until(async () => { const r = await runningInstance(f.root, port); return r && r.pid !== original.pid && r; });
  assert.equal(tunnels, 1); assert.equal(child.exitCode, null);
  assert.equal((await call(next, 'shutdown')).status, 202);
  assert.equal(await runtime.done, 0); tunnel.stop(); await tunnel.closed;
  assert.equal(await runningInstance(f.root, port), null);
});

test('offline recovery refuses active launchers, listeners and installers, then restores verified files and metadata', { timeout: 60000 }, async (t) => {
  const f = checkout(t), port = await freePort(), root = f.root;
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const file of ['host-runtime.mjs', 'recover-release.mjs']) fs.copyFileSync(path.join(ROOT, 'scripts', file), path.join(root, 'scripts', file));
  const old = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true }); fs.writeFileSync(path.join(root, 'logs/release-version.json'), '{"tag":"previous"}');
  const files = { 'server/index.js': '// replacement', 'package.json': fs.readFileSync(path.join(root, 'package.json'), 'utf8') };
  fs.mkdirSync(path.join(root, 'stage/server'), { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(root, 'stage', name), body);
  fs.writeFileSync(path.join(root, 'stage/MANIFEST.json'), manifest(files));
  const result = applyReleaseStage(root, path.join(root, 'stage'));
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/recover-release.mjs'), '--backup', path.basename(result.backup), '--port', String(port), '--confirm'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', (d) => { output += d; }); child.stderr.on('data', (d) => { output += d; });
    child.on('error', reject); child.on('exit', (code) => resolve({ code, output }));
  });
  const lease = acquireLease(root, `runtime-${port}`);
  try { const r = await run(); assert.equal(r.code, 1); assert.match(r.output, /启动窗口/); } finally { lease.release(); }
  const listener = net.createServer(); await new Promise((r) => listener.listen(port, '127.0.0.1', r));
  try { assert.equal((await run()).code, 1); } finally { await new Promise((r) => listener.close(r)); }
  fs.writeFileSync(path.join(root, 'logs/release-update.lock'), JSON.stringify({ installerPid: process.pid }));
  assert.match((await run()).output, /安装器/);
  assert.equal(fs.readFileSync(path.join(root, 'server/index.js'), 'utf8'), '// replacement');
  fs.writeFileSync(path.join(root, 'logs/release-update.lock'), '{}');
  const recovered = await run(); assert.equal(recovered.code, 0, recovered.output);
  assert.equal(fs.readFileSync(path.join(root, 'server/index.js'), 'utf8'), old);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'logs/release-version.json'))).tag, 'previous');
  assert.equal(fs.existsSync(path.join(root, 'logs/release-update.lock')), false);
});
