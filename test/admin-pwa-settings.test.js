import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { startAdmin, loadSettings } from '../server/admin.js';
import { getShowPwaInstall, setShowPwaInstall, resetHostSettings } from '../server/match/hostSettings.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';

test('installation visibility defaults on and accepts only boolean host settings', t => {
  resetHostSettings(); t.after(resetHostSettings);
  assert.equal(getShowPwaInstall(), true);
  assert.deepEqual(setShowPwaInstall(false), { ok: true });
  for (const value of [null, 0, 1, '', 'false', {}, []]) {
    assert.ok(setShowPwaInstall(value).error);
    assert.equal(getShowPwaInstall(), false);
  }
});

test('console installation visibility persists, broadcasts, survives unrelated saves and rejects failed writes', async t => {
  resetHostSettings();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-pwa-host-'));
  const file = path.join(dir, 'settings.json');
  let server, admin, peer, fresh, anonymous;
  t.after(async () => {
    await peer?.terminate(); await fresh?.terminate(); await anonymous?.terminate(); await admin?.close(); await server?.close();
    resetHostSettings(); fs.rmSync(dir, { recursive: true, force: true });
  });
  server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch, recovery: false });
  admin = await startAdmin({ lobby: server.lobby, network: server.network, port: 0, settingsFile: file, resultsDir: dir, log: { info() {}, error() {} } });
  const api = async body => {
    const res = await fetch(admin.url + '/api/settings', { method: body ? 'POST' : 'GET',
      headers: { 'x-admin-token': admin.token, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return res.json();
  };
  const health = async () => (await (await fetch(`http://127.0.0.1:${server.port}/healthz`)).json()).siteSettings;
  peer = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`); await peer.hello('Visibility');
  anonymous = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
  assert.equal((await api()).showPwaInstall, true);
  assert.deepEqual(await health(), { showPwaInstall: true });
  const unauth = await fetch(admin.url + '/api/settings', { method: 'POST', body: JSON.stringify({ showPwaInstall: false }) });
  assert.equal(unauth.status, 403);
  assert.equal((await api({ showPwaInstall: false })).showPwaInstall, false);
  assert.deepEqual(await peer.waitFor('site.settings'), { t: 'site.settings', showPwaInstall: false });
  assert.deepEqual(await anonymous.waitFor('site.settings'), { t: 'site.settings', showPwaInstall: false });
  assert.deepEqual(await health(), { showPwaInstall: false });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).showPwaInstall, false);
  const saved = fs.readFileSync(file, 'utf8');
  for (const value of [null, 'true', 1, {}]) {
    assert.ok((await api({ showPwaInstall: value, roundCharts: false })).error);
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
    assert.equal(getShowPwaInstall(), false);
  }
  assert.ok((await api({ prep: { mode: 'default' } })).ok);
  assert.equal((await api()).showPwaInstall, false);
  fresh = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
  assert.equal((await fresh.hello('Fresh')).showPwaInstall, false, 'new pages receive policy with welcome');
  resetHostSettings(); loadSettings(file, { error: assert.fail });
  assert.equal(getShowPwaInstall(), false, 'restart reloads the saved choice');
  const backup = file + '.saved'; fs.renameSync(file, backup); fs.mkdirSync(file);
  assert.ok((await api({ showPwaInstall: true })).error);
  assert.equal(getShowPwaInstall(), false, 'failed persistence leaves runtime policy unchanged');
  fs.rmdirSync(file); fs.renameSync(backup, file);
  assert.equal((await api({ showPwaInstall: true })).showPwaInstall, true);
  assert.deepEqual(await peer.waitFor('site.settings', m => m.showPwaInstall === true), { t: 'site.settings', showPwaInstall: true });
});

test('older settings files default to a visible installation entry', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-pwa-legacy-'));
  t.after(() => { resetHostSettings(); fs.rmSync(dir, { recursive: true, force: true }); });
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ prep: { mode: 'default' } }));
  setShowPwaInstall(false); loadSettings(file, { error: assert.fail });
  assert.equal(getShowPwaInstall(), true);
});
