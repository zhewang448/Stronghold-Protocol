import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { startAdmin, loadSettings } from '../server/admin.js';
import { ERR } from '../shared/constants.js';
import { ROOM_CONFIG_FIELDS, getRoomCreation, setRoomCreation, normalizeRoomCreation, resetHostSettings,
  getSeatAvatars, getUniteLayerGains, getAllowRoomUniteLayerGains } from '../server/match/hostSettings.js';
import { TestClient } from './helpers/wsClient.js';
import { validateC2S } from '../shared/protocol.js';

test('legacy avatar/unite settings migrate into one validated room configuration', t => {
  resetHostSettings();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-room-config-legacy-'));
  t.after(() => { resetHostSettings(); fs.rmSync(dir, { recursive: true, force: true }); });
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ prep: { mode: 'default' }, seatAvatars: true, uniteLayerGains: true, allowRoomUniteLayerGains: true }));
  loadSettings(file, { error: assert.fail });
  const config = getRoomCreation();
  assert.equal(config.defaults.seatAvatars, getSeatAvatars());
  assert.equal(config.defaults.uniteLayerGains, getUniteLayerGains());
  assert.equal(config.hostControls.uniteLayerGains, getAllowRoomUniteLayerGains());
  assert.equal(Object.keys(config.defaults).length, ROOM_CONFIG_FIELDS.length);
  for (const value of [{ defaults: { capacity: 7 } }, { defaults: { enemyHpMultiplier: 0 } },
    { hostControls: { private: 'false' } }, { defaults: { unknown: true } }, { defaults: { plugins: ['../bad'] } }]) {
    assert.ok(normalizeRoomCreation(value).error);
  }
});

test('explicit empty optional plugin defaults retain mandatory plugins and AI defaults obey content restrictions', t => {
  resetHostSettings();
  const registry = new SessionRegistry(), mandatory = 'mandatory-skin';
  const lobby = new Lobby({ registry, content: { cs: 'ab'.repeat(32) }, plugins: {
    defaults: () => ['optional-skin'], fixed: () => [mandatory],
    resolve: ids => ({ ok: true, set: { cs: 'cd'.repeat(32), plugins: ids.map(id => ({ id, version: '1.0.0', class: 'content' })) } }),
  }, log: { info() {}, warn() {}, error() {} } });
  t.after(() => { lobby.shutdown(); resetHostSettings(); });
  setRoomCreation({ defaults: { plugins: [], aiTakeoverEnabled: true } });
  const host = registry.create('Host');
  assert.deepEqual(lobby.create(host, { mode: 'coop' }), { ok: true });
  const room = lobby.roomOf(host);
  assert.deepEqual(room.content.plugins.map(plugin => plugin.id), [mandatory]);
  assert.equal(room.modded, true);
  assert.equal(room.aiTakeoverEnabled, false);
  room.content = lobby.baseContent(room.version);
  room.aiTakeoverEnabled = true;
  lobby.applyVersion(room, 'act1autochess', 'test');
  assert.equal(room.aiTakeoverEnabled, true, 'official historical versions retain the enabled spectator handover option');
});

test('all room defaults apply on create, per-option permissions reject alternate wire routes, and saves are atomic', async t => {
  resetHostSettings();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-room-config-'));
  const file = path.join(dir, 'settings.json');
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const admin = await startAdmin({ lobby: server.lobby, network: server.network, port: 0, settingsFile: file, resultsDir: dir, log: { info() {}, error() {} } });
  const host = await TestClient.connect(server.url.replace('http', 'ws') + '/ws');
  t.after(async () => { await host.terminate(); await admin.close(); await server.close(); resetHostSettings(); fs.rmSync(dir, { recursive: true, force: true }); });
  await host.hello('Host');
  const api = async body => (await fetch(admin.url + '/api/settings', { method: 'POST', headers: {
    'x-admin-token': admin.token, 'content-type': 'application/json',
  }, body: JSON.stringify(body) })).json();
  const hostControls = Object.fromEntries(ROOM_CONFIG_FIELDS.map(field => [field.key, false]));
  const defaults = { ...getRoomCreation().defaults, difficulty: 'NORMAL', capacity: 8, spectatorLimit: 6,
    private: true, aiPicksLast: false, seatAvatars: true, uniteLayerGains: true,
    enemyHpMultiplier: 1.6, independentPools: true, rescueEnabled: true,
    'convenience.benchEquip': false, 'convenience.soloUnlimited': false, 'convenience.prepLoadout': false,
    'convenience.unequip': true, 'convenience.morphPairing': true };
  assert.ok((await api({ roomCreation: { defaults, hostControls } })).ok);
  assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'FUNNY', capacity: 4, private: false })).t, 'ok');
  const room = [...server.lobby.rooms.values()][0];
  assert.equal(room.difficulty, 'NORMAL'); assert.equal(room.capacity, 8); assert.equal(room.private, true);
  for (const key of ['spectatorLimit', 'aiPicksLast', 'seatAvatars', 'uniteLayerGains', 'enemyHpMultiplier', 'independentPools', 'rescueEnabled']) assert.equal(room[key], defaults[key], key);
  for (const [key, value] of Object.entries(room.convenience)) assert.equal(value, defaults['convenience.' + key], key);
  const requests = [
    { t: 'room.setDifficulty', difficulty: 'FUNNY' }, { t: 'room.setMode', modeId: 'mode_multi_funny' },
    { t: 'room.setCapacity', capacity: 4 }, { t: 'room.setMaxSeats', n: 4 }, { t: 'room.setPrivate', private: false },
    { t: 'room.setSpectatorLimit', limit: 4 }, { t: 'room.setAiPicksLast', on: true },
    { t: 'room.setSeatAvatars', on: false }, { t: 'room.setAiTakeover', on: true },
    { t: 'room.setEnemyHpMultiplier', multiplier: 2 }, { t: 'room.setIndependentPools', on: false },
    { t: 'room.setRescue', on: false }, { t: 'room.proposeVersion', version: 'act1autochess' },
    { t: 'room.setPlugins', plugins: [] },
    ...Object.keys(room.convenience).map(key => ({ t: 'room.setConvenience', key, on: !room.convenience[key] })),
  ];
  for (const request of requests) assert.equal((await host.request(request)).code, ERR.ROOM_OPTION_LOCKED, request.t);
  assert.equal((await host.request({ t: 'room.setUniteLayerGains', on: false })).code, ERR.UNITE_LAYERS_LOCKED);
  assert.ok((await api({ roomCreation: { hostControls: { private: true } } })).ok);
  assert.equal(room.private, true);
  assert.equal((await host.request({ t: 'room.setPrivate', private: false })).t, 'ok');
  assert.equal((await host.request({ t: 'room.setAiPicksLast', on: true })).code, ERR.ROOM_OPTION_LOCKED);
  await host.request({ t: 'room.setPrivate', private: true });
  assert.ok((await api({ roomCreation: { defaults: { private: false } } })).ok);
  assert.equal(room.private, true, 'defaults never overwrite an existing room');
  const saved = fs.readFileSync(file, 'utf8'), before = getRoomCreation();
  assert.ok((await api({ roomCreation: { hostControls: { private: 1 } } })).error);
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
  const backup = file + '.saved'; fs.renameSync(file, backup); fs.mkdirSync(file);
  assert.ok((await api({ roomCreation: { defaults: { private: true } } })).error);
  assert.deepEqual(getRoomCreation(), before);
  fs.rmdirSync(file); fs.renameSync(backup, file);
  resetHostSettings(); loadSettings(file, { error: assert.fail });
  assert.deepEqual(getRoomCreation(), before);
});

async function resetFixture(testContext) {
  resetHostSettings();
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, heavyBurst: 100, rateBurst: 200,
    versions: { default: 'act2autochess' } });
  server.lobby.opts.versionProposeGapMs = 0; server.lobby.opts.versionRetryMs = 0;
  const peers = [];
  testContext.after(async () => { for (const peer of peers) await peer.terminate(); await server.close(); resetHostSettings(); });
  const player = async name => {
    const peer = await TestClient.connect(server.url.replace('http', 'ws') + '/ws'); peers.push(peer);
    peer.playerId = (await peer.hello(name)).playerId; return peer;
  };
  const host = await player('Host');
  await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  return { server, host, room: [...server.lobby.rooms.values()][0], player };
}

test('reset restores every editable room default except difficulty and is idempotent', async testContext => {
  const { host, room, player } = await resetFixture(testContext);
  assert.equal(validateC2S({ t: 'room.resetSettings' }), null);
  const guest = await player('Guest'); await guest.request({ t: 'room.join', code: room.code });
  await guest.request({ t: 'room.ready', ready: true });
  const defaults = { ...getRoomCreation().defaults, difficulty: 'ABYSS', capacity: 8, spectatorLimit: 6, private: true,
    aiPicksLast: false, seatAvatars: true, aiTakeoverEnabled: true, uniteLayerGains: true, enemyHpMultiplier: 1.75,
    independentPools: true, rescueEnabled: true, 'convenience.benchEquip': false, 'convenience.soloUnlimited': false,
    'convenience.prepLoadout': false, 'convenience.unequip': true, 'convenience.morphPairing': true, plugins: [] };
  setRoomCreation({ defaults, hostControls: Object.fromEntries(ROOM_CONFIG_FIELDS.map(field => [field.key, true])) });
  assert.equal((await guest.request({ t: 'room.resetSettings' })).code, ERR.NOT_HOST);
  assert.equal((await host.request({ t: 'room.resetSettings' })).t, 'ok');
  for (const field of ROOM_CONFIG_FIELDS) {
    if (['difficulty', 'version', 'plugins'].includes(field.key)) continue;
    const actual = field.key.startsWith('convenience.') ? room.convenience[field.key.slice('convenience.'.length)] : room[field.key];
    assert.equal(actual, defaults[field.key], field.key);
  }
  assert.equal(room.difficulty, 'NORMAL');
  assert.equal(room.seats.length, 8);
  assert.equal(room.seatOf(guest.playerId).ready, false);
  assert.deepEqual(room.content.plugins, []);
  await guest.request({ t: 'room.ready', ready: true });
  assert.equal((await host.request({ t: 'room.resetSettings' })).t, 'ok');
  assert.equal(room.seatOf(guest.playerId).ready, true, 'an unchanged reset does not clear readiness');
  room.match = { disposed: false, dispose() {} };
  assert.equal((await host.request({ t: 'room.resetSettings' })).code, ERR.ROOM_STARTED);
  room.match = null;
});

test('reset cannot bypass independent locks or evict occupied player and spectator seats', async testContext => {
  const { host, room, player } = await resetFixture(testContext);
  const before = structuredClone({ private: room.private, seatAvatars: room.seatAvatars, convenience: room.convenience,
    capacity: room.capacity, enemyHpMultiplier: room.enemyHpMultiplier, aiPicksLast: room.aiPicksLast });
  setRoomCreation({ defaults: { private: true, seatAvatars: true, capacity: 8, enemyHpMultiplier: 2,
    aiPicksLast: false, 'convenience.benchEquip': false },
  hostControls: { ...Object.fromEntries(ROOM_CONFIG_FIELDS.map(field => [field.key, false])), private: true, seatAvatars: true } });
  assert.equal((await host.request({ t: 'room.resetSettings' })).t, 'ok');
  assert.equal(room.private, true); assert.equal(room.seatAvatars, true);
  for (const key of ['convenience', 'capacity', 'enemyHpMultiplier', 'aiPicksLast']) assert.deepEqual(room[key], before[key]);
  setRoomCreation({ defaults: { capacity: 4, spectatorLimit: 2 }, hostControls: Object.fromEntries(ROOM_CONFIG_FIELDS.map(field => [field.key, true])) });
  await host.request({ t: 'room.setCapacity', capacity: 8 });
  for (let index = 0; index < 4; index++) await host.request({ t: 'room.addBot' });
  const state = room.toState();
  assert.equal((await host.request({ t: 'room.resetSettings' })).code, ERR.ROOM_RESET_BLOCKED);
  assert.deepEqual(room.toState(), state);
  await host.request({ t: 'room.removeBot', seat: 4 });
  await host.request({ t: 'room.setSpectatorLimit', limit: 4 });
  for (let index = 0; index < 3; index++) {
    const spectator = await player('Spectator ' + index); await spectator.request({ t: 'room.spectate', code: room.code });
  }
  assert.equal((await host.request({ t: 'room.resetSettings' })).code, ERR.ROOM_RESET_BLOCKED);
  assert.equal(room.spectatorLimit, 4); assert.equal(room.capacity, 8); assert.equal(room.enemyHpMultiplier, before.enemyHpMultiplier);
});

test('reset version changes require unanimous approval, preserve difficulty and reject stale policy', async testContext => {
  const { server, host, room, player } = await resetFixture(testContext);
  const guest = await player('Guest'); await guest.request({ t: 'room.join', code: room.code });
  await host.request({ t: 'room.setEnemyHpMultiplier', multiplier: 3 });
  setRoomCreation({ defaults: { version: 'act1autochess', enemyHpMultiplier: 2, private: true, difficulty: 'ABYSS' } });
  assert.equal((await host.request({ t: 'room.resetSettings' })).t, 'ok');
  assert.equal(room.version, 'act2autochess'); assert.equal(room.enemyHpMultiplier, 3); assert.equal(room.private, false);
  assert.equal(room.toState().versionVote.resetSettings, true);
  assert.equal(Object.hasOwn(room.toState().versionVote, 'policy'), false);
  assert.equal((await host.request({ t: 'room.setPrivate', private: true })).code, ERR.VERSION_VOTE);
  await guest.request({ t: 'room.versionVote', voteId: room.versionVote.id, agree: false });
  assert.equal(room.version, 'act2autochess'); assert.equal(room.enemyHpMultiplier, 3); assert.equal(room.private, false);
  await host.request({ t: 'room.resetSettings' });
  setRoomCreation({ defaults: { enemyHpMultiplier: 2.5 } });
  assert.equal((await guest.request({ t: 'room.versionVote', voteId: room.versionVote.id, agree: true })).code, ERR.ROOM_RESET_CHANGED);
  assert.equal(room.versionVote, null); assert.equal(room.version, 'act2autochess'); assert.equal(room.enemyHpMultiplier, 3);
  await host.request({ t: 'room.resetSettings' });
  assert.equal((await guest.request({ t: 'room.versionVote', voteId: room.versionVote.id, agree: true })).t, 'ok');
  assert.equal(room.version, 'act1autochess'); assert.equal(room.enemyHpMultiplier, 2.5); assert.equal(room.private, true); assert.equal(room.difficulty, 'NORMAL');
  await host.request({ t: 'room.proposeVersion', version: 'act2autochess' });
  await guest.request({ t: 'room.versionVote', voteId: room.versionVote.id, agree: true });
  await host.request({ t: 'room.setDifficulty', difficulty: 'ABYSS' });
  assert.equal(server.lobby.offered('act1autochess', 'coop').includes('ABYSS'), false);
  const before = room.toState();
  assert.equal((await host.request({ t: 'room.resetSettings' })).code, ERR.ROOM_RESET_BLOCKED);
  assert.deepEqual(room.toState(), before);
});

test('reset includes optional plugin defaults, preserves locked plugin settings and always keeps fixed plugins', async testContext => {
  const { server, host, room } = await resetFixture(testContext);
  server.lobby.plugins = {
    defaults: () => ['default-skin'], fixed: () => ['fixed-skin'],
    resolve: (ids, options) => ({ ok: true, set: { cs: server.content.cs,
      vs: (ids.includes('custom-skin') ? 'a' : 'b').repeat(64), warnings: [], bytes: 0,
      plugins: ids.map(id => ({ id, version: '1.0.0', class: 'cosmetic', ...(options.settings[id] ? { settings: options.settings[id] } : {}) })) } }),
  };
  const custom = [{ id: 'custom-skin', settings: { color: 'red' } }, { id: 'fixed-skin' }];
  assert.equal((await host.request({ t: 'room.setPlugins', plugins: custom })).t, 'ok');
  assert.equal((await host.request({ t: 'room.resetSettings' })).t, 'ok');
  assert.deepEqual(room.content.plugins.map(plugin => plugin.id), ['default-skin', 'fixed-skin']);
  await host.request({ t: 'room.setPlugins', plugins: custom });
  setRoomCreation({ defaults: { plugins: [] }, hostControls: { plugins: false } });
  const before = structuredClone(room.content);
  await host.request({ t: 'room.resetSettings' });
  assert.deepEqual(room.content, before);
  setRoomCreation({ hostControls: { plugins: true } });
  await host.request({ t: 'room.resetSettings' });
  assert.deepEqual(room.content.plugins.map(plugin => plugin.id), ['fixed-skin']);
  const state = room.toState();
  server.lobby.plugins.resolve = () => ({ ok: false, error: ERR.PLUGIN_BLOCKED });
  setRoomCreation({ defaults: { enemyHpMultiplier: 4 } });
  assert.equal((await host.request({ t: 'room.resetSettings' })).code, ERR.PLUGIN_BLOCKED);
  assert.deepEqual(room.toState(), state);
});

test('solo reset updates convenience defaults while preserving difficulty and ignoring co-op-only settings', async testContext => {
  const { server, host } = await resetFixture(testContext);
  await host.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL', version: 'act1autochess' });
  const room = server.lobby.roomOf(server.registry.byId(host.playerId));
  setRoomCreation({ defaults: { version: 'act1autochess', difficulty: 'ABYSS', capacity: 8, private: true,
    aiTakeoverEnabled: true, independentPools: true, rescueEnabled: true, 'convenience.soloUnlimited': false,
    'convenience.benchEquip': false, 'convenience.prepLoadout': false, 'convenience.unequip': true, 'convenience.morphPairing': true } });
  assert.equal((await host.request({ t: 'room.resetSettings' })).t, 'ok');
  assert.equal(room.version, 'act1autochess'); assert.equal(room.difficulty, 'NORMAL'); assert.equal(room.capacity, 1);
  assert.equal(room.soloUnlimited, false);
  assert.deepEqual(room.convenience, { benchEquip: false, soloUnlimited: false, prepLoadout: false, unequip: true, morphPairing: true });
  for (const key of ['private', 'aiPicksLast', 'aiTakeoverEnabled', 'independentPools', 'rescueEnabled']) assert.equal(room[key], false, key);
});
