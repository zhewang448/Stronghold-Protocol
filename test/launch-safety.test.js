import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordInstance, runningInstance, stopInstance } from '../server/instance.js';
import { prepareLaunch, parseArgs } from '../scripts/launch.mjs';
import { freePort } from '../scripts/free-port.mjs';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-launch-safe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('both launch modes share setup, pending-update and failure checks', async () => {
  for (const argv of [[], ['--tunnel']]) {
    const calls = [], options = parseArgs(argv);
    const result = await prepareLaunch(options, { probe: async () => ({ state: 'free' }),
      update: () => { calls.push('update'); return { state: 'none' }; }, setup: () => { calls.push('setup'); return 0; } });
    assert.equal(result.state, 'ready'); assert.deepEqual(calls, ['update', 'setup']);
    assert.equal((await prepareLaunch(options, { probe: async () => ({ state: 'free' }), update: () => ({ state: 'failed' }),
      setup: () => assert.fail('failed update must stop setup') })).state, 'failed');
  }
  assert.equal(parseArgs(['--tunnel', '--no-tunnel']).tunnel, false);
});

test('a healthz lookalike or another installation is never reused or prepared', async () => {
  const options = parseArgs(['--tunnel']);
  const deps = { probe: async () => ({ state: 'ours' }), running: async () => null,
    update: () => assert.fail('occupied port must not change files'), setup: () => assert.fail('must not run setup') };
  assert.equal((await prepareLaunch(options, deps)).state, 'blocked');
  const instance = { pid: 123 };
  assert.deepEqual(await prepareLaunch(options, { ...deps, running: async () => instance }), { state: 'existing', instance });
});

test('instance control requires this boot token and PID; old cleanup cannot erase a replacement', async (t) => {
  const root = temp(t), token = 'a'.repeat(32);
  const cleanup = recordInstance(root, { port: 3000, adminPort: 3100, token, pid: 123 });
  const fetched = [];
  const fetchImpl = async (url, options) => {
    fetched.push({ url, options });
    return { ok: true, json: async () => ({ instanceId: 123, activeMatches: 1 }) };
  };
  assert.equal((await runningInstance(root, 3000, { fetchImpl })).pid, 123);
  assert.equal((await stopInstance(root, 3000, { fetchImpl })).active, true);
  assert.equal(fetched.length, 2, 'active match is not stopped without explicit confirmation');
  assert.equal(await runningInstance(root, 3000, { fetchImpl: async () => ({ ok: true, json: async () => ({ instanceId: 999 }) }) }), null);
  recordInstance(root, { port: 3000, adminPort: 3100, token, pid: 456 }); cleanup();
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'logs/server-instance-3000.json'))).pid, 456);
  assert.equal(fetched[0].options.headers['X-Admin-Token'], token);
});

test('free-port refuses an unowned port without invoking any process killer', async () => {
  let stops = 0;
  assert.equal(await freePort(3000, { probe: async () => ({ state: 'busy' }), log() {},
    stop: async () => { stops++; return { ok: false, error: 'not ours' }; } }), false);
  assert.equal(stops, 1);
  assert.equal(await freePort(3000, { probe: async () => ({ state: 'free' }), stop: () => assert.fail('already free') }), true);
});

test('launch preparation never applies files or runs setup during installation or outstanding recovery', async (t) => {
  const root = temp(t); fs.mkdirSync(path.join(root, 'logs'));
  const options = parseArgs(['--tunnel']), deps = { root, probe: async () => ({ state: 'free' }),
    update: () => assert.fail('must not apply files'), setup: () => assert.fail('must not run setup') };
  fs.writeFileSync(path.join(root, 'logs/release-update.lock'), '{}');
  assert.equal((await prepareLaunch(options, deps)).state, 'failed');
  fs.unlinkSync(path.join(root, 'logs/release-update.lock'));
  fs.writeFileSync(path.join(root, 'logs/release-update-status.json'), '{"state":"recovery-required"}');
  assert.match((await prepareLaunch(options, deps)).error, /离线恢复/);
});
