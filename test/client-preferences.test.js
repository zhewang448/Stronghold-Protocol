import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLIENT_PREFERENCE_FIELDS, defaultClientPreferencePolicy, normalizeClientPreferencePolicy } from '../shared/clientPreferences.js';
import { DEFAULT_SETTINGS } from '../public/js/ui/gameLogic/settings.js';
import { createClientPreferenceStore, setClientPreferencePolicy } from '../public/js/clientPreferences.js';
import { sanitizeSettings } from '../public/js/ui/gameLogic/settings.js';
import { migrateClientSettings } from '../shared/clientPreferences.js';
import { startServer } from '../server/index.js';
import { startAdmin, loadSettings } from '../server/admin.js';
import { resetHostSettings } from '../server/match/hostSettings.js';
import { getClientPreferencePolicy } from '../server/clientPreferences.js';
import { TestClient } from './helpers/wsClient.js';
import { reminderState, updateReminder, BACKUP_REMINDER_KEY } from '../public/js/ui/backupReminder.js';

test('every client setting has a validated default and allows user changes initially', () => {
  const fields = new Map(CLIENT_PREFERENCE_FIELDS.map(f => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (key === 'prepDeployFold') continue;
    assert.ok(fields.has('settings.' + key), key);
    assert.deepEqual(fields.get('settings.' + key).default, value, key);
  }
  const policy = defaultClientPreferencePolicy();
  assert.ok(Object.values(policy.userControls).every(v => v === true));
  assert.deepEqual(normalizeClientPreferencePolicy(policy).config, policy);
  for (const raw of [{ defaults: { 'settings.bgm': -1 } }, { defaults: { 'settings.fpsLimit': 45 } },
    { userControls: { 'settings.bgm': 'false' } }, { defaults: { unknown: true } },
    { defaults: { 'settings.keys': { ...DEFAULT_SETTINGS.keys, sell: DEFAULT_SETTINGS.keys.buy } } },
    { defaults: { 'cosmetics.ids': ['../bad'] } }, { defaults: { 'uiPlugins.ids': Array.from({ length: 9 }, (_, i) => 'theme-' + i) } },
    { defaults: { 'cosmetics.ids': ['a'] } }, { defaults: { 'screenFit.ui': 77 } }]) assert.ok(normalizeClientPreferencePolicy(raw).error);
});

test('live lock uses the host default without touching sparse saved values, then restores them', t => {
  const previous = globalThis.localStorage, values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  t.after(() => { setClientPreferencePolicy(null); globalThis.localStorage = previous; });
  const saved = createClientPreferenceStore({ prefix: 'settings', preference: 'test.clientPolicy.saved', initial: { bgm: 0.21, muted: false }, normalize: sanitizeSettings, migrate: migrateClientSettings });
  const fresh = createClientPreferenceStore({ prefix: 'settings', preference: 'test.clientPolicy.fresh', initial: null, normalize: sanitizeSettings, migrate: migrateClientSettings });
  setClientPreferencePolicy({ defaults: { 'settings.bgm': 0.75, 'settings.dynamicIllustrations': 'static' } });
  assert.equal(saved.get().bgm, 0.21); assert.equal(fresh.get().bgm, 0.75);
  saved.set({ sfx: 0.4 }); assert.equal(saved.get().dynamicIllustrations, 'static');
  const baseline = values.get('sp.pref.test.clientPolicy.saved');
  assert.deepEqual(JSON.parse(baseline), { bgm: 0.21, muted: false, sfx: 0.4 });
  setClientPreferencePolicy({ defaults: { 'settings.bgm': 0.8 }, userControls: { 'settings.bgm': false } });
  assert.equal(saved.get().bgm, 0.8); saved.set({ bgm: 0.1 }); assert.equal(saved.get().bgm, 0.8);
  assert.equal(values.get('sp.pref.test.clientPolicy.saved'), baseline, 'forced state never writes the saved layer');
  saved.set({ voice: 0.5 }); assert.equal(JSON.parse(values.get('sp.pref.test.clientPolicy.saved')).bgm, 0.21);
  setClientPreferencePolicy({ defaults: { 'settings.bgm': 0.6 }, userControls: { 'settings.bgm': true } });
  assert.equal(saved.get().bgm, 0.21); assert.equal(saved.get().voice, 0.5); assert.equal(fresh.get().bgm, 0.6);
});

test('retired explicit off preferences remain off while new keys override stale aliases', t => {
  t.after(() => setClientPreferencePolicy(null));
  for (const raw of [{ dynamicIllust: false }, { dynamicIllustrations: false }, { dynamicIllustrations: 'static' }]) {
    const s = createClientPreferenceStore({ prefix: 'settings', preference: 'test.clientPolicy.migration', initial: raw, normalize: sanitizeSettings, migrate: migrateClientSettings });
    assert.equal(s.get().dynamicIllustrations, 'static');
    setClientPreferencePolicy({ defaults: { 'settings.dynamicIllustrations': 'auto' } }); assert.equal(s.get().dynamicIllustrations, 'static');
  }
  const current = createClientPreferenceStore({ prefix: 'settings', preference: 'test.clientPolicy.current', initial: { dynamicIllustrations: 'auto', dynamicIllust: false }, normalize: sanitizeSettings, migrate: migrateClientSettings });
  assert.equal(current.get().dynamicIllustrations, 'auto');
});

test('array preferences and nested maps keep their legacy storage shape through locks and reloads', t => {
  const previous = globalThis.localStorage, values = new Map([['sp.pref.test.plugins', '["my-theme"]']]);
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  t.after(() => { setClientPreferencePolicy(null); globalThis.localStorage = previous; });
  const plugins = () => createClientPreferenceStore({ prefix: 'uiPlugins', preference: 'test.plugins',
    migrate: raw => Array.isArray(raw) ? { ids: raw } : {}, normalize: raw => ({ ids: raw.ids || [] }), persist: raw => raw.ids });
  const original = plugins();
  setClientPreferencePolicy({ defaults: { 'uiPlugins.ids': ['host-theme'] }, userControls: { 'uiPlugins.ids': false } });
  assert.deepEqual(original.get().ids, ['host-theme']);
  original.set({ ids: [] }); assert.equal(values.get('sp.pref.test.plugins'), '["my-theme"]');
  const reloaded = plugins(); assert.deepEqual(reloaded.get().ids, ['host-theme']);
  setClientPreferencePolicy(null); assert.deepEqual(reloaded.get().ids, ['my-theme']);
  reloaded.set({ ids: ['other-theme'] }); assert.deepEqual(JSON.parse(values.get('sp.pref.test.plugins')), ['other-theme']);
  const map = createClientPreferenceStore({ prefix: 'skinRandom', preference: 'test.random', initial: { scope: 'equipped', locked: { char_222_bpipe: true } } });
  setClientPreferencePolicy({ defaults: { 'skinRandom.locked': {} }, userControls: { 'skinRandom.locked': false } });
  assert.deepEqual(map.get().locked, {}); map.set({ auto: true, locked: {} });
  assert.deepEqual(map.saved().locked, { char_222_bpipe: true });
  setClientPreferencePolicy(null); assert.deepEqual(map.get().locked, { char_222_bpipe: true });
  assert.equal(map.get().auto, true);
});

test('legacy aliases and locked hotkey maps cannot be written through full-object updates', t => {
  t.after(() => setClientPreferencePolicy(null));
  const saved = createClientPreferenceStore({ prefix: 'settings', preference: 'test.legacy',
    initial: { prepDeployFold: true, ammoCount: true, keys: { ...DEFAULT_SETTINGS.keys, buy: 'KeyA' } }, normalize: sanitizeSettings, migrate: migrateClientSettings });
  setClientPreferencePolicy({ defaults: { 'settings.deploymentZoom': false, 'settings.ammoEnergyCount': false },
    userControls: { 'settings.deploymentZoom': false, 'settings.ammoEnergyCount': false, 'settings.keys': false } });
  assert.equal(saved.get().deploymentZoom, false); assert.equal(saved.get().prepDeployFold, false); assert.equal(saved.get().ammoEnergyCount, false);
  saved.set({ ...saved.get(), voice: 0.37, keys: DEFAULT_SETTINGS.keys });
  assert.equal(saved.saved().keys.buy, 'KeyA');
  setClientPreferencePolicy(null); assert.equal(saved.get().deploymentZoom, true); assert.equal(saved.get().ammoEnergyCount, true);
  assert.equal(saved.get().voice, 0.37);
});

test('explicit choices equal to a host default are saved, and backup bookkeeping never saves forced preferences', t => {
  t.after(() => setClientPreferencePolicy(null));
  setClientPreferencePolicy({ defaults: { 'settings.bgm': 0.8 } });
  const store = createClientPreferenceStore({ prefix: 'settings', preference: 'test.explicit', initial: null, normalize: sanitizeSettings });
  store.set({ bgm: 0.8 });
  setClientPreferencePolicy({ defaults: { 'settings.bgm': 0.4 } });
  assert.equal(store.get().bgm, 0.8, 'an explicit choice stays personal even if it matched the former default');
  const values = new Map([[BACKUP_REMINDER_KEY, JSON.stringify({ enabled: false, firstSeen: 1 })]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  setClientPreferencePolicy({ defaults: { 'backupReminder.enabled': true }, userControls: { 'backupReminder.enabled': false } });
  assert.equal(reminderState(storage).enabled, true);
  updateReminder({ exportedAt: 100, enabled: true }, storage, 100);
  assert.equal(JSON.parse(values.get(BACKUP_REMINDER_KEY)).enabled, false);
  setClientPreferencePolicy(null); assert.equal(reminderState(storage).enabled, false);
  assert.equal(reminderState(storage).exportedAt, 100);
});

test('console policy is atomic, persistent and visible to pre-hello, online and reconnected clients', async t => {
  resetHostSettings();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-client-policy-')), file = path.join(dir, 'admin-settings.json');
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const admin = await startAdmin({ lobby: server.lobby, network: server.network, port: 0, settingsFile: file, resultsDir: dir, log: { info() {}, error() {} } });
  const socket = await TestClient.connect(server.url.replace('http', 'ws') + '/ws');
  t.after(async () => { await socket.terminate(); await admin.close(); await server.close(); resetHostSettings(); fs.rmSync(dir, { recursive: true, force: true }); });
  const api = async body => (await fetch(admin.url + '/api/settings', { method: 'POST', headers: { 'x-admin-token': admin.token, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const policy = { defaults: { 'settings.bgm': 0.9, 'language': 'ja' }, userControls: { 'settings.bgm': false } };
  const result = await api({ clientPreferences: policy }); assert.equal(result.ok, true);
  const pushed = await socket.waitFor('site.settings'); assert.equal(pushed.clientPreferences.defaults['settings.bgm'], 0.9);
  await socket.hello('Policy');
  assert.equal(server.lobby.welcomeInfo().clientPreferences.userControls['settings.bgm'], false);
  const health = await (await fetch(server.url + '/healthz')).json(); assert.equal(health.siteSettings.clientPreferences.defaults.language, 'ja');
  const before = fs.readFileSync(file, 'utf8');
  assert.ok((await api({ clientPreferences: { defaults: { 'settings.bgm': 5 } } })).error);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  resetHostSettings(); loadSettings(file, { error: assert.fail }); assert.equal(getClientPreferencePolicy().userControls['settings.bgm'], false);
  const data = await (await fetch(admin.url + '/api/settings', { headers: { 'x-admin-token': admin.token } })).json();
  assert.equal(data.clientPreferenceFields.length, CLIENT_PREFERENCE_FIELDS.length);
  assert.equal(data.clientPreferences.defaults['settings.bgm'], 0.9);
  assert.equal((await api({ roundCharts: false })).ok, true);
  assert.equal(getClientPreferencePolicy().defaults.language, 'ja', 'other console saves retain the policy');
});
