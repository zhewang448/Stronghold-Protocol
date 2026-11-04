import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { startAdmin, loadSettings } from '../server/admin.js';
import { getEmoteBarrage, getSignalBar, getEmoteBarrageRate, resetHostSettings } from '../server/match/hostSettings.js';
import { TestClient } from './helpers/wsClient.js';

test('barrage console choices persist and reach connected and new clients', async t => {
  resetHostSettings();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-barrage-host-'));
  const file = path.join(dir, 'settings.json');
  let server, admin, peer, fresh;
  t.after(async () => {
    await peer?.terminate(); await fresh?.terminate(); await admin?.close(); await server?.close();
    resetHostSettings(); fs.rmSync(dir, { recursive: true, force: true });
  });
  server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  admin = await startAdmin({ lobby: server.lobby, network: server.network, port: 0, settingsFile: file, resultsDir: dir,
    log: { info() {}, error() {} } });
  const api = async body => (await fetch(admin.url + '/api/settings', { method: body ? 'POST' : 'GET',
    headers: { 'x-admin-token': admin.token, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) })).json();
  peer = await TestClient.connect(server.url.replace('http', 'ws') + '/ws');
  const welcome = await peer.hello('Barrage');
  assert.equal(welcome.emoteBarrage, undefined, 'default flags stay omitted');
  assert.equal(welcome.emoteBarrageRate, undefined);
  const choices = { emoteBarrage: false, signalBar: false, emoteBarrageRate: 2 };
  assert.equal((await api(choices)).ok, true);
  assert.deepEqual(await peer.waitFor('site.settings', frame => frame.emoteBarrage === false), { t: 'site.settings', ...choices });
  const health = await (await fetch(server.url + '/healthz')).json();
  assert.deepEqual(health.siteSettings, { showPwaInstall: true, ...choices });
  for (const [key, value] of Object.entries(choices)) assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[key], value);
  const saved = fs.readFileSync(file, 'utf8');
  for (const value of [-1, 1.5, 1001, 'invalid']) {
    assert.ok((await api({ emoteBarrageRate: value })).error);
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
  }
  fresh = await TestClient.connect(server.url.replace('http', 'ws') + '/ws');
  const nextWelcome = await fresh.hello('Fresh');
  for (const [key, value] of Object.entries(choices)) assert.equal(nextWelcome[key], value);
  resetHostSettings(); loadSettings(file, { error: assert.fail });
  assert.equal(getEmoteBarrage(), false); assert.equal(getSignalBar(), false); assert.equal(getEmoteBarrageRate(), 2);
  assert.equal((await api({ prep: { mode: 'default' } })).ok, true);
  assert.equal((await api()).emoteBarrageRate, 2, 'unrelated saves preserve barrage policy');
  assert.equal((await api({ emoteBarrageRate: '' })).emoteBarrageRate, 0, 'blank means unlimited');
});
