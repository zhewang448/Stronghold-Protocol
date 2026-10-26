import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry, HEAVY_TYPES } from '../server/net.js';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { validateC2S } from '../shared/protocol.js';
import { ERR } from '../shared/constants.js';
import { setSocialSettings, resetHostSettings } from '../server/match/hostSettings.js';

const request = { t: 'match.queue', mode: 'coop', difficulty: 'NORMAL', version: 'act2autochess', fillBots: false };
function fixture(t, options = {}) {
  const registry = new SessionRegistry();
  let now = 1000;
  const lobby = new Lobby({ registry, options, now: () => now, MatchClass: StubMatch });
  t.after(() => { lobby.shutdown(); resetHostSettings(); });
  const player = name => {
    const session = registry.create(name); session.connected = true; session.frames = [];
    session.ws = { readyState: 1, bufferedAmount: 0, send(data) { session.frames.push(JSON.parse(data)); } };
    return session;
  };
  const queue = (session, extra = {}) => lobby.handleMessage(session, { ...request, ...extra });
  return { registry, lobby, player, queue, tick: () => { now += 1000; lobby.matchmaking.pump(); } };
}

test('queue and cancellation validate exact scope and reuse heavy rate limits', () => {
  assert.equal(validateC2S(request), null);
  assert.equal(validateC2S({ t: 'match.cancel' }), null);
  for (const extra of [{ mode: 'solo' }, { random: true }, { fillBots: true }, { difficulty: 'bad' }, { version: '../x' }]) assert.ok(validateC2S({ ...request, ...extra }));
  assert.ok(HEAVY_TYPES.has('match.queue'));
});

test('four solos form one waiting room: FIFO host, no bots, no start, ready gate unchanged', t => {
  const f = fixture(t), players = ['一', '二', '三', '四'].map(f.player);
  for (const p of players.slice(0, 3)) assert.deepEqual(f.queue(p), { ok: true });
  assert.equal(f.lobby.rooms.size, 0);
  assert.equal(f.lobby.matchmaking.solo.size, 3);
  assert.deepEqual(f.queue(players[0]), { ok: true });
  assert.equal(f.lobby.matchmaking.solo.size, 3, 'queue is idempotent');
  assert.deepEqual(f.queue(players[3]), { ok: true });
  assert.equal(f.lobby.rooms.size, 1);
  const room = f.lobby.roomOf(players[0]);
  assert.ok(players.every(p => f.lobby.roomOf(p) === room));
  assert.equal(room.hostId, players[0].playerId);
  assert.equal(room.match, null);
  assert.equal(room.seats.some(s => s?.isBot), false);
  assert.ok(players.every(p => p.frames.some(frame => frame.t === 'match.found')));
  assert.equal(f.lobby.start(players[0]).error, ERR.NOT_READY);
  assert.equal(f.lobby.matchmaking.solo.size, 0);
});

test('explicit room recruitment preserves existing members and room code, and cancellation preserves room', t => {
  const f = fixture(t), host = f.player('房主'), guest = f.player('队友');
  assert.deepEqual(f.lobby.create(host, { mode: 'coop', difficulty: 'NORMAL', code: 'TEAM' }), { ok: true });
  assert.deepEqual(f.lobby.join(guest, { code: 'TEAM' }), { ok: true });
  assert.equal(f.queue(guest).error, ERR.NOT_HOST);
  assert.deepEqual(f.queue(host), { ok: true });
  const room = f.lobby.roomOf(host), before = room.seats.slice(0, 2);
  assert.equal(room.toState().matching.target, 4);
  const solo = f.player('散人');
  assert.deepEqual(f.queue(solo), { ok: true });
  assert.equal(solo.roomCode, 'TEAM');
  assert.deepEqual(room.seats.slice(0, 2), before);
  assert.equal(room.match, null);
  assert.equal(f.lobby.matchmaking.cancel(guest).error, ERR.NOT_HOST);
  assert.deepEqual(f.lobby.matchmaking.cancel(host), { ok: true });
  assert.equal(room.matching, undefined);
  assert.equal(room.activeHumans().length, 3);
  f.tick(); assert.equal(f.lobby.matchmaking.parties.size, 0);
});

test('public room without opt-in is not automatically filled; queued parties never merge', t => {
  const f = fixture(t), a = f.player('甲'), b = f.player('乙'), solo = f.player('丙');
  f.lobby.create(a, { mode: 'coop', difficulty: 'NORMAL', code: 'AAAA' });
  f.lobby.create(b, { mode: 'coop', difficulty: 'NORMAL', code: 'BBBB' });
  f.queue(solo); assert.equal(solo.roomCode, null);
  f.queue(b); assert.equal(solo.roomCode, 'BBBB');
  f.queue(a); assert.equal(a.roomCode, 'AAAA'); assert.equal(b.roomCode, 'BBBB');
});

test('different difficulties stay isolated; cancel and disconnect remove singles immediately', t => {
  const f = fixture(t), players = ['甲', '乙', '丙'].map(f.player);
  f.queue(players[0]); f.queue(players[1], { difficulty: 'HARD' }); f.queue(players[2]);
  f.lobby.matchmaking.cancel(players[0]);
  assert.equal(f.lobby.matchmaking.solo.has(players[0].playerId), false);
  players[2].connected = false; f.lobby.onDisconnect(players[2]);
  assert.equal(f.lobby.matchmaking.solo.has(players[2].playerId), false);
  assert.equal(f.lobby.matchmaking.solo.size, 1);
  assert.equal(f.lobby.rooms.size, 0);
});

test('room changes cancel recruitment: privacy, difficulty, capacity, custom rules and disconnection', t => {
  const f = fixture(t), host = f.player('房主');
  f.lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' });
  const room = f.lobby.roomOf(host);
  for (const change of [() => f.lobby.setPrivate(host, { private: true }), () => f.lobby.setDifficulty(host, { difficulty: 'HARD' }), () => f.lobby.setCapacity(host, { capacity: 8 }), () => { room.convenience.unequip = true; f.lobby.broadcastState(room); }, () => { host.connected = false; f.lobby.onDisconnect(host); }]) {
    room.private = false; room.difficulty = 'NORMAL'; room.capacity = 4; room.seats = room.seats.slice(0, 4); room.convenience.unequip = false; host.connected = true; room.seats[0].connected = true;
    assert.deepEqual(f.queue(host), { ok: true });
    change(); assert.equal(room.matching, undefined);
  }
});

test('ineligible room types and spectators cannot recruit; bots are neither added nor replaced', t => {
  const f = fixture(t), host = f.player('房主');
  f.lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' });
  const room = f.lobby.roomOf(host);
  for (const attrs of [{ private: true }, { test: true }, { capacity: 8 }, { content: { vanilla: false } }, { match: {} }, { aiPicksLast: false }]) {
    const before = Object.fromEntries(Object.keys(attrs).map(key => [key, room[key]]));
    Object.assign(room, attrs); assert.equal(f.queue(host).error, ERR.BAD_TARGET); Object.assign(room, before);
  }
  f.lobby.addBot(host);
  const bot = room.seats[1];
  f.queue(host); f.queue(f.player('队友甲')); f.queue(f.player('队友乙'));
  assert.equal(room.seats[1], bot); assert.equal(room.match, null); assert.equal(room.matching, undefined);
});

test('counts do not disclose invisible singles; count policy and reconnect snapshots are respected', t => {
  const f = fixture(t), visible = f.player('甲'), hidden = f.player('乙'); hidden.presenceStatus = 'invisible';
  f.queue(visible); f.queue(hidden);
  const frame = visible.frames.filter(x => x.t === 'match.counts').at(-1);
  assert.equal(frame.byVersion.act2autochess.total, 1);
  assert.doesNotMatch(JSON.stringify(frame), /playerId|roomCode|甲|乙/);
  f.lobby.matchmaking.hello(visible);
  assert.equal(visible.frames.filter(x => x.t === 'match.state').at(-1).status, 'searching');
  setSocialSettings({ counts: false }); f.tick();
  assert.equal(visible.frames.filter(x => x.t === 'match.counts').at(-1).byVersion, null);
});

test('allocation failures do not fabricate found rooms or corrupt queue identities', t => {
  const f = fixture(t, { maxRooms: 0 });
  const players = ['甲', '乙', '丙', '丁'].map(f.player); players.forEach(p => f.queue(p));
  assert.equal(f.lobby.rooms.size, 0);
  assert.ok(players.every(p => !p.frames.some(frame => frame.t === 'match.found')));
  assert.equal(f.lobby.matchmaking.solo.size, 3);
});

test('spectator departure and disconnect never stop player recruitment; host departure does', t => {
  const f = fixture(t), host = f.player('房主'), viewer = f.player('观战');
  f.lobby.create(host, { mode: 'coop', difficulty: 'NORMAL', code: 'SPEC' });
  f.lobby.spectate(viewer, { code: 'SPEC' });
  f.queue(host);
  const room = f.lobby.roomOf(host);
  assert.equal(f.queue(viewer).error, ERR.NOT_HOST);
  viewer.connected = false; f.lobby.onDisconnect(viewer);
  assert.ok(room.matching);
  f.lobby.removeMember(room, viewer.playerId);
  assert.ok(room.matching);
  f.lobby.removeMember(room, host.playerId);
  assert.equal(f.lobby.matchmaking.parties.size, 0);
});

test('manual ready/start stops recruitment only after successful start, and no queue silently resumes', t => {
  const f = fixture(t), host = f.player('房主'), guest = f.player('队友');
  f.lobby.create(host, { mode: 'coop', difficulty: 'NORMAL', code: 'PLAY' });
  f.lobby.join(guest, { code: 'PLAY' });
  f.queue(host);
  const room = f.lobby.roomOf(host);
  assert.equal(f.lobby.start(host).error, ERR.NOT_READY);
  assert.ok(room.matching);
  f.lobby.ready(guest, { ready: true });
  assert.deepEqual(f.lobby.start(host), { ok: true });
  assert.ok(room.match);
  assert.equal(room.matching, undefined);
  f.tick(); assert.equal(f.lobby.matchmaking.parties.size, 0);
});

test('a refused join during recruitment stays queued without an endless retry loop', t => {
  const f = fixture(t), host = f.player('房主'), solo = f.player('散人');
  f.lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' });
  f.queue(host);
  const join = f.lobby.join;
  let attempts = 0;
  f.lobby.join = () => { attempts++; return { error: ERR.ROOM_FULL }; };
  assert.deepEqual(f.queue(solo), { ok: true });
  assert.equal(attempts, 1);
  assert.equal(f.lobby.matchmaking.solo.has(solo.playerId), true);
  f.lobby.join = join; f.tick();
  assert.equal(solo.roomCode, host.roomCode);
});

test('real WebSocket queue reports status, supports cancel, and forms a room using normal ready/start', { timeout: 30000 }, async t => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, recovery: false, MatchClass: StubMatch });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map(c => c.terminate())); await srv.close(); });
  for (let i = 0; i < 4; i++) {
    const c = await TestClient.connect('ws://127.0.0.1:' + srv.port + '/ws'); clients.push(c); await c.hello('队友' + i);
  }
  assert.equal((await clients[0].request(request)).t, 'ok');
  assert.equal((await clients[0].waitFor('match.state', m => m.status === 'searching')).target, 4);
  assert.equal((await clients[0].request({ t: 'match.cancel' })).t, 'ok');
  for (const c of clients) assert.equal((await c.request(request)).t, 'ok');
  const found = await Promise.all(clients.map(c => c.waitFor('match.found')));
  assert.equal(new Set(found.map(m => m.roomCode)).size, 1);
  const code = found[0].roomCode;
  assert.equal(srv.lobby.rooms.get(code).match, null);
  for (const c of clients.slice(1)) assert.equal((await c.request({ t: 'room.ready', ready: true })).t, 'ok');
  assert.equal((await clients[0].request({ t: 'room.start' })).t, 'ok');
  assert.ok(srv.lobby.rooms.get(code).match);
});

test('real heavy queue limit rejects repeated entry while cancellation remains available', async t => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, recovery: false, heavyBurst: 1, heavyPerSec: 0 });
  const client = await TestClient.connect('ws://127.0.0.1:' + srv.port + '/ws');
  t.after(async () => { await client.terminate(); await srv.close(); });
  await client.hello('限流队友');
  assert.equal((await client.request(request)).t, 'ok');
  assert.equal((await client.request(request)).code, ERR.RATE);
  assert.equal((await client.request({ t: 'match.cancel' })).t, 'ok');
  assert.equal(srv.lobby.matchmaking.solo.size, 0);
});
