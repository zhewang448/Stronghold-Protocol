import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
// Admin-port conflicts must be caught before any server process is created.


test('desktop launch refuses an occupied admin port without spawning or claiming state', async (t) => {
  const root = fixture(t);
  await assert.rejects(launchDesktop({ port: 19388, host: '127.0.0.1', setup: false, tunnel: false }, {
    root, probe: async port => ({ state: port === 19488 ? 'busy' : 'free' }),
    spawnImpl: () => assert.fail('must not launch when the admin port is occupied'),
  }), /管理端口 19488 已被占用/);
  assert.ok(!fs.existsSync(path.join(root, 'logs/host-launcher-state-19388.json')));
});
import { parseDesktopArgs, desktopStatus, redactLog, restartDesktop, launchDesktop } from '../scripts/host-launcher.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-desktop-'));
  fs.mkdirSync(path.join(root, 'logs'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const write = (root, name, data) => fs.writeFileSync(path.join(root, 'logs', name), JSON.stringify(data));
const instance = { adminPort: 19488, token: 'a'.repeat(32), service: { activeMatches: 2, canRestart: true, canShutdown: true, recoveryEnabled: true } };

test('desktop flags validate ports and bind addresses and reject arbitrary arguments', () => {
  assert.deepEqual(parseDesktopArgs(['--port', '19388', '--host', '127.0.0.1', '--no-open']),
    { action: 'launch', port: 19388, host: '127.0.0.1', tunnel: false, setup: true });
  for (const args of [['--port', '0'], ['--port', '65436'], ['--port', 'NaN'], ['--host', '0.0.0.0'], ['--eval', 'code']])
    assert.throws(() => parseDesktopArgs(args));
});

test('desktop version flags remain separate from installation options', () => {
  const options = parseDesktopArgs(['--versions', 'act2autochess,act1autochess', '--version-default', 'act1autochess']);
  assert.equal(options.versions, 'act2autochess,act1autochess');
  assert.equal(options.versionDefault, 'act1autochess');
  assert.throws(() => parseDesktopArgs(['--versions']), /requires/);
  assert.throws(() => parseDesktopArgs(['--version-default', '--no-open']), /requires/);
});

test('unknown HTTP listener never becomes this installations running server', async (t) => {
  const report = await desktopStatus({ root: fixture(t), running: async () => null, probe: async () => ({ state: 'ours' }) });
  assert.equal(report.state, 'busy'); assert.deepEqual(report.addresses, []);
});

test('only verified instance yields admin URL, without exposing token or credentials', async (t) => {
  const report = await desktopStatus({ root: fixture(t), running: async () => instance });
  assert.equal(report.state, 'online'); assert.equal(report.adminUrl, 'http://127.0.0.1:19488');
  assert.equal(report.activeMatches, 2); assert.equal(report.canRestart, true);
  assert.ok(!JSON.stringify(report).includes(instance.token));
  assert.deepEqual(report.addresses, [{ label: '本机', url: 'http://localhost:3000' }]);
});

test('loopback launch does not advertise LAN addresses and stale tunnel leases stay hidden', async (t) => {
  const root = fixture(t);
  write(root, 'host-launcher-state-3000.json', { pid: 11, port: 3000, host: '127.0.0.1' });
  write(root, 'tunnel-3000.json', { pid: 12, url: 'https://stale.trycloudflare.com' });
  const report = await desktopStatus({ root, running: async () => instance, isAlive: pid => pid === 11, addresses: () => assert.fail('loopback is not shareable') });
  assert.equal(report.tunnelUrl, null); assert.equal(report.addresses.length, 1);
});

test('LAN shares real classified adapters only, including bracketed IPv6', async (t) => {
  const root = fixture(t);
  write(root, 'host-launcher-state-3000.json', { pid: 11, port: 3000, host: '::' });
  write(root, 'tunnel-3000.json', { pid: 12, url: 'https://active.trycloudflare.com' });
  const report = await desktopStatus({ root, running: async () => instance, isAlive: () => true,
    addresses: () => [{ kind: 'lan', address: '192.168.1.3' }, { kind: 'virtual', address: '198.18.0.1' }, { kind: 'public', address: '240e::1' }] });
  assert.equal(report.addresses[0].url, 'https://active.trycloudflare.com');
  assert.ok(report.addresses.some(item => item.url === 'http://[240e::1]:3000'));
  assert.ok(!JSON.stringify(report).includes('198.18.0.1'));
});

test('restart reuses authenticated local console and sends explicit confirmation', async (t) => {
  let calls = 0;
  const result = await restartDesktop({ root: fixture(t), running: async () => instance,
    fetchImpl: async (url, options) => {
      calls++; assert.equal(url, 'http://127.0.0.1:19488/api/service');
      assert.equal(options.headers['X-Admin-Token'], instance.token);
      assert.deepEqual(JSON.parse(options.body), { action: 'restart', confirm: true, confirmActive: true });
      assert.equal(options.redirect, 'error'); return { ok: true, json: async () => ({ ok: true }) };
    } });
  assert.deepEqual(result, { ok: true }); assert.equal(calls, 1);
  const denied = await restartDesktop({ root: fixture(t), running: async () => null, fetchImpl: () => assert.fail('unknown service') });
  assert.equal(denied.ok, false);
});

test('launcher logs scrub plugin studio keys and ANSI codes', () => {
  assert.equal(redactLog('\x1b[31mStudio: http://localhost:3000/studio?key=secret123\x1b[0m\n'),
    'Studio: http://localhost:3000/studio?key=[redacted]\n');
  assert.ok(!redactLog('url?token=secret&next=a').includes('secret'));
});

test('wrapper forwards startup flags and Unicode logs without retaining split access keys', async (t) => {
  const root = fixture(t);
  const result = await launchDesktop({ port: 19388, host: '127.0.0.1', setup: false, tunnel: true, versions: 'act2autochess,act1autochess', versionDefault: 'act1autochess' }, {
    root, probe: async () => ({ state: 'free' }), spawnImpl(_executable, args, options) {
      assert.deepEqual(args.slice(1), ['--port', '19388', '--host', '127.0.0.1', '--no-open', '--versions', 'act2autochess,act1autochess', '--version-default', 'act1autochess', '--tunnel', '--no-setup']);
      assert.equal(options.windowsHide, true);
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
      setImmediate(() => {
        child.stdout.write('中文日志\nStudio: http://localhost/studio?key=par');
        child.stdout.end('tial-secret\n'); child.stderr.end('warning\n');
        setImmediate(() => child.emit('close', 0));
      });
      return child;
    },
  });
  assert.equal(result, 0);
  const log = fs.readFileSync(path.join(root, 'logs/host-launcher-19388.log'), 'utf8');
  assert.ok(log.includes('中文日志')); assert.ok(log.includes('[redacted]')); assert.ok(!log.includes('partial-secret'));
  assert.ok(!fs.existsSync(path.join(root, 'logs/host-launcher-state-19388.json')));
});
