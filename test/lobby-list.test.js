import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, Room } from '../server/lobby.js';
import { SessionRegistry, HEAVY_TYPES } from '../server/net.js';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { validateC2S } from '../shared/protocol.js';
import { DEFAULT_VERSION } from '../shared/versions.js';
import { MAX_SPECTATORS, ERR } from '../shared/constants.js';
import { setSocialSettings, resetHostSettings } from '../server/match/hostSettings.js';

function fixture(t) {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry });
  t.after(() => { lobby.shutdown(); resetHostSettings(); });
  const host = registry.create('DirectoryHost');
  host.connected = true;
  const room = new Room('OPEN', 'coop', 'NORMAL', 1000);
  room.hostId = host.playerId;
  room.seats[0] = { seat: 0, playerId: host.playerId, name: host.name, isBot: false, left: false, connected: true, token: 'MUST-NOT-PUBLISH' };
  host.roomCode = room.code;
  lobby.rooms.set(room.code, room);
  return { lobby, registry, host, room };
}

test('directory protocol is read-only, strictly validated, and rate limited', () => {
  assert.equal(validateC2S({ t: 'room.list' }), null);
  assert.equal(validateC2S({ t: 'room.list', arbitrary: true }), null, 'unknown fields follow the existing validator contract');
  for (const value of [true, false]) {
    assert.equal(validateC2S({ t: 'room.setPrivate', private: value }), null);
    assert.equal(validateC2S({ t: 'room.create', mode: 'coop', private: value }), null);
  }
  assert.ok(validateC2S({ t: 'room.setPrivate', private: 'false' }));
  assert.ok(validateC2S({ t: 'room.create', mode: 'coop', private: 1 }));
  assert.ok(HEAVY_TYPES.has('room.list'));
});

test('directory excludes solo, private, test, disposed and empty rooms; publishes summary allowlist only', t => {
  const { lobby, room } = fixture(t);
  for (const [code, attrs] of Object.entries({ SOLO: { mode: 'solo' }, PRIV: { private: true }, TEST: { test: true }, DEAD: { disposed: true }, NONE: { seats: [] } })) {
    const other = Object.assign(new Room(code, 'coop', 'NORMAL', 1), { seats: [...room.seats] }, attrs);
    lobby.rooms.set(code, other);
  }
  const result = lobby.listRooms();
  assert.deepEqual(result.rooms.map(r => r.code), ['OPEN']);
  assert.deepEqual(Object.keys(result.rooms[0]).sort(), ['code', 'hostName', 'difficulty', 'version', 'humans', 'bots', 'maxSeats', 'spectators', 'inMatch', 'joinable', 'watchable', 'occupied', 'modded'].sort());
  assert.equal(result.roomsCount, 1);
  assert.equal(result.matchesCount, 0);
  assert.doesNotMatch(JSON.stringify(result), /MUST-NOT-PUBLISH|playerId|token|consent|seats/);
});

test('summaries use actual expanded capacity, AI occupancy, disconnected reservations, plugin and version metadata', t => {
  const { lobby, room } = fixture(t);
  room.capacity = 20;
  room.seats = [room.seats[0], ...Array.from({ length: 19 }, (_, i) => ({ seat: i + 1, playerId: `bot-${i}`, name: 'AI', isBot: true }))];
  room.version = 'act1autochess';
  room.content = { vanilla: false, cs: 'a'.repeat(64), trusted: { consent: { 0: true } } };
  const full = lobby.listRooms().rooms[0];
  assert.equal(full.maxSeats, 20);
  assert.equal(full.occupied, 20);
  assert.equal(full.bots, 19);
  assert.equal(full.joinable, false);
  assert.equal(full.modded, true);
  assert.equal(full.version, 'act1autochess');
  room.seats[19] = null;
  assert.equal(lobby.listRooms().rooms[0].joinable, true);
  room.seats[19] = { playerId: 'departed', left: true, connected: false, isBot: false };
  assert.equal(lobby.listRooms().rooms[0].joinable, false, 'reserved seat stays occupied');
  room.spectators = Array.from({ length: MAX_SPECTATORS }, (_, i) => ({ playerId: `spectator-${i}`, connected: false }));
  assert.equal(lobby.listRooms().rooms[0].watchable, false, 'disconnected spectators retain seats');
});

test('directory follows existing social count and invisible-name settings', t => {
  const { lobby, host } = fixture(t);
  host.presenceStatus = 'invisible';
  assert.equal(lobby.listRooms().rooms[0].hostName, '');
  assert.equal(lobby.listRooms().online, 0);
  setSocialSettings({ counts: false });
  assert.equal(lobby.listRooms().online, null);
});

test('privacy is host-only, unavailable after start, and does not block code-based invitations', t => {
  const { lobby, registry, room, host } = fixture(t);
  const other = registry.create('Other');
  assert.equal(lobby.setPrivate(other, { private: true }).error, ERR.NOT_IN_ROOM);
  other.roomCode = room.code;
  room.seats[1] = { seat: 1, playerId: other.playerId, name: other.name, isBot: false, left: false, connected: true };
  assert.equal(lobby.setPrivate(other, { private: true }).error, ERR.NOT_HOST);
  assert.deepEqual(lobby.setPrivate(host, { private: true }), { ok: true });
  assert.equal(room.toState().private, true);
  assert.equal(lobby.listRooms().rooms.length, 0);
  room.match = { dispose() {} };
  assert.equal(lobby.setPrivate(host, { private: false }).error, ERR.ROOM_STARTED);
  room.match = null;
  assert.deepEqual(lobby.setPrivate(host, { private: false }), { ok: true });
  assert.equal(Object.hasOwn(room.toState(), 'private'), false, 'default room state stays compatible');
});

test('real socket directory reuses join/spectate, preserves private creation, tracks room lifetime and rate limits', { timeout: 30000 }, async t => {
  const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true, recovery: false, MatchClass: StubMatch });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map(c => c.terminate())); await server.close(); });
  const connect = async name => {
    const client = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
    clients.push(client);
    await client.hello(name);
    return client;
  };
  const host = await connect('DirHost'), viewer = await connect('DirViewer');
  assert.equal((await host.request({ t: 'room.create', mode: 'coop', code: 'OPEN', capacity: 8, private: true })).t, 'ok');
  assert.deepEqual((await viewer.request({ t: 'room.list' })).rooms, []);
  assert.equal((await host.request({ t: 'room.setPrivate', private: false })).t, 'ok');
  const result = await viewer.request({ t: 'room.list' });
  assert.equal(result.t, 'ok');
  assert.equal(result.rooms[0].maxSeats, 8);
  assert.equal(result.rooms[0].version, DEFAULT_VERSION);
  assert.equal((await viewer.request({ t: 'room.join', code: result.rooms[0].code })).t, 'ok');
  assert.equal((await host.request({ t: 'room.setPrivate', private: true })).t, 'ok');
  const invite = await connect('Invited');
  assert.equal((await invite.request({ t: 'room.join', code: 'OPEN' })).t, 'ok', 'private room still accepts key');
  await invite.request({ t: 'room.leave' });
  await viewer.request({ t: 'room.leave' });
  await host.request({ t: 'room.setPrivate', private: false });
  assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
  const running = await viewer.request({ t: 'room.list' });
  assert.equal(running.rooms[0].inMatch, true);
  assert.equal(running.rooms[0].joinable, false);
  assert.equal(running.matchesCount, 1);
  assert.equal((await viewer.request({ t: 'room.join', code: 'OPEN' })).code, ERR.ROOM_STARTED);
  assert.equal((await viewer.request({ t: 'room.spectate', code: 'OPEN' })).t, 'ok');
  assert.equal(viewer.log.some(frame => frame.t === 'm.private'), false);
  const spammer = await connect('DirRate');
  const replies = [];
  for (let i = 0; i < 12; i++) replies.push(await spammer.request({ t: 'room.list' }));
  assert.ok(replies.some(reply => reply.code === ERR.RATE));
  await host.request({ t: 'g.leave' });
  const after = await invite.request({ t: 'room.list' });
  assert.equal(after.roomsCount, 0);
});
