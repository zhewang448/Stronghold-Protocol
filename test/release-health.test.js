import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { probeRelease } from '../server/release-health.js';
import { scheduleInstall, updatePaths } from '../server/release-update.js';
import { APP_VERSION } from '../shared/constants.js';
import { put, read, manifest, healthServerSource, tag } from './helpers/release-fixture.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function temp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-release-health-')); t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })); return root; }
async function port() { const s = net.createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function terminal(root) {
  for (let i = 0; i < 150; i++) {
    try { const s = JSON.parse(read(root, 'logs/release-update-status.json')); if (['error', 'installed', 'recovery-required'].includes(s.state)) return s; } catch {}
    await delay(100);
  }
  throw new Error('installer did not finish');
}
function stage(root, source) {
  const dir = path.join(root, 'logs/update-staging/test/Stronghold-Protocol');
  const files = { 'package.json': JSON.stringify({ version: APP_VERSION, type: 'module' }), 'server/index.js': source };
  for (const [name, body] of Object.entries(files)) put(dir, name, body);
  put(dir, 'MANIFEST.json', manifest(files)); return dir;
}
test('read-only candidate validation checks HTTP, build identity, assets and WebSocket and exits its child', async (t) => {
  const root = temp(t); put(root, 'package.json', JSON.stringify({ version: APP_VERSION, type: 'module' }));
  put(root, 'server/index.js', healthServerSource(0));
  const result = await probeRelease(root, { app: APP_VERSION, timeout: 10000 });
  assert.equal(result.app, APP_VERSION); assert.equal(fs.existsSync(path.join(root, 'logs')), false);
});

test('candidate probe invoked from inline Node code starts the server script, not the caller payload', { timeout: 15000 }, t => {
  const root = temp(t);
  put(root, 'package.json', JSON.stringify({ version: APP_VERSION, type: 'module' }));
  put(root, 'server/index.js', healthServerSource(0));
  const module = new URL('../server/release-health.js', import.meta.url).href;
  const code = 'import { probeRelease } from ' + JSON.stringify(module)
    + '; console.log(JSON.stringify(await probeRelease(' + JSON.stringify(root)
    + ',{app:' + JSON.stringify(APP_VERSION) + ',timeout:8000})));';
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 12000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(JSON.parse(result.stdout.trim()).app, APP_VERSION);
});
test('a candidate that crashes during its private probe restores the old program and version before restarting', { timeout: 20000 }, async (t) => {
  const root = temp(t), p = await port(), oldSource = healthServerSource(p);
  put(root, 'package.json', JSON.stringify({ version: APP_VERSION, type: 'module' })); put(root, 'server/index.js', oldSource);
  put(root, 'logs/release-version.json', '{"tag":"previous-version"}');
  const dir = stage(root, '// SP_UPDATE_PROBE\nthrow new Error("candidate crash");');
  let pid;
  try {
    await scheduleInstall({ root, stage: dir, tag, parentPid: 987654, port: p });
    const status = await terminal(root);
    assert.equal(status.state, 'error'); assert.match(status.error, /已恢复原程序与版本信息/);
    assert.equal(read(root, 'server/index.js'), oldSource);
    assert.equal(JSON.parse(read(root, 'logs/release-version.json')).tag, 'previous-version');
    pid = (await (await fetch(`http://127.0.0.1:${p}/healthz`)).json()).pid;
    assert.equal(fs.existsSync(updatePaths(root).lock), false);
  } finally { if (pid) { process.kill(pid); await delay(150); } }
});
test('failure after normal startup is reported for manual recovery, never as installed or automatic rollback', { timeout: 20000 }, async (t) => {
  const root = temp(t), p = await port();
  put(root, 'package.json', JSON.stringify({ version: APP_VERSION, type: 'module' })); put(root, 'server/index.js', 'old');
  const source = 'if (!process.env.SP_UPDATE_PROBE) throw new Error("normal-start-failed");\n' + healthServerSource(p);
  await scheduleInstall({ root, stage: stage(root, source), tag, parentPid: 987654, port: p });
  const status = await terminal(root);
  assert.equal(status.state, 'recovery-required'); assert.match(status.recovery, /recover-release/);
  assert.equal(read(root, 'server/index.js'), source);
  assert.ok(fs.existsSync(path.join(status.backup, 'restore.json')));
});
