import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { acquireLease, superviseServer, openTunnel } from '../scripts/host-runtime.mjs';
import { computeBuildTag } from '../server/http/buildTag.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-host-runtime-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function child(pid) {
  const c = new EventEmitter(); Object.assign(c, { pid, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
  c.kill = () => { c.killed = true; c.exitCode = 0; c.emit('exit', 0); c.stdout.end(); c.stderr.end(); };
  return c;
}

test('leases prevent duplicate starts and reclaim only verifiably dead owners', (t) => {
  const root = temp(t), first = acquireLease(root, 'launch-3000');
  assert.equal(first.owned, true); assert.equal(acquireLease(root, 'launch-3000').owned, false);
  first.release(); assert.equal(acquireLease(root, 'launch-3000', { isAlive: () => false }).owned, true);
  fs.writeFileSync(path.join(root, 'logs/launch-3001.json'), JSON.stringify({ pid: 999999 }));
  const reclaimed = acquireLease(root, 'launch-3001', { isAlive: () => false }); assert.equal(reclaimed.owned, true); reclaimed.release();
});

test('planned server restart retains one tunnel and explicit shutdown ends the supervisor', async (t) => {
  const root = temp(t), children = []; let tunnelChild, tunnelStarts = 0;
  const tunnel = openTunnel({ root, port: 3000, log() {}, spawnImpl() { tunnelStarts++; return tunnelChild = child(999); } });
  t.after(() => tunnel.stop());
  const runtime = superviseServer({ root, port: 3000, env: {}, log() {}, restartDelay: 1,
    probe: async () => ({ state: 'ours' }), requestStop: async () => ({ ok: false }),
    spawnImpl(_cmd, _args, options) {
      assert.equal(options.env.SP_UPDATE_RESTART, 'supervisor');
      const c = child(100 + children.length); children.push(c);
      setImmediate(() => c.emit('message', { t: 'sp.lifecycle', action: 'ready', pid: c.pid })); return c;
    } });
  t.after(() => runtime.stop());
  await runtime.ready;
  children[0].emit('message', { t: 'sp.lifecycle', action: 'restart' }); children[0].exitCode = 1; children[0].emit('exit', 1);
  for (let i = 0; i < 100 && children.length < 2; i++) await tick();
  assert.equal(children.length, 2); assert.equal(tunnelStarts, 1); assert.equal(tunnelChild.killed, undefined);
  assert.equal(openTunnel({ root, port: 3000, log() {}, spawnImpl: () => assert.fail('duplicate tunnel') }).existing, true);
  children[1].emit('message', { t: 'sp.lifecycle', action: 'shutdown' }); children[1].exitCode = 75; children[1].emit('exit', 75);
  assert.equal(await runtime.done, 0); tunnel.stop(); assert.equal(tunnelChild.killed, true);
});

test('crash retries are bounded and launch failure never pretends readiness', async (t) => {
  let starts = 0;
  const runtime = superviseServer({ root: temp(t), port: 3000, env: {}, log() {}, restartDelay: 1, maxRestarts: 1,
    probe: async () => ({ state: 'busy' }), spawnImpl() { const c = child(++starts); setImmediate(() => { c.exitCode = 1; c.emit('exit', 1); }); return c; } });
  await assert.rejects(runtime.ready, /连续启动失败/); assert.equal(await runtime.done, 1); assert.equal(starts, 2);
});

test('ready IPC with a failed health probe never reports a successful start', async (t) => {
  let reports = 0;
  const runtime = superviseServer({ root: temp(t), port: 3000, env: {}, log() {}, maxRestarts: 0, healthTimeout: 40,
    probe: async () => ({ state: 'busy' }), onHealthy: () => reports++, spawnImpl() {
      const c = child(123); setImmediate(() => c.emit('message', { t: 'sp.lifecycle', action: 'ready', pid: c.pid })); return c;
    } });
  await assert.rejects(runtime.ready); assert.equal(await runtime.done, 1); assert.equal(reports, 0);
});

test('legacy release without lifecycle IPC is accepted only with its build on a previously vacant port', async (t) => {
  const root = temp(t); let started = false;
  const runtime = superviseServer({ root, port: 3000, env: {}, log() {}, requestStop: async () => ({ ok: false }),
    probe: async () => started ? { state: 'ours', health: { build: computeBuildTag(root) } } : { state: 'free' },
    spawnImpl() { started = true; return child(456); } });
  await runtime.ready; runtime.stop(); assert.equal(await runtime.done, 0);
});

test('recovery-required status blocks automatic respawn and releases the runtime lease', async (t) => {
  const root = temp(t); fs.mkdirSync(path.join(root, 'logs'));
  fs.writeFileSync(path.join(root, 'logs/release-update-status.json'), '{"state":"recovery-required"}');
  const runtime = superviseServer({ root, port: 3000, env: {}, log() {}, spawnImpl: () => assert.fail('must not respawn') });
  await assert.rejects(runtime.ready, /离线恢复/); assert.equal(await runtime.done, 1);
  const lease = acquireLease(root, 'runtime-3000'); assert.equal(lease.owned, true); lease.release();
});
