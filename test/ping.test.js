import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, GEO, PING_COOLDOWN_MS, PING_KINDS } from '../shared/constants.js';
import { C2S, S2C, validateC2S } from '../shared/protocol.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { makeMatch } from './match/harness.js';
import { activePings, pingTileAt } from '../public/js/ui/fieldPings.js';
import * as fieldPings from '../public/js/ui/fieldPings.js';
import { TestClient } from './helpers/wsClient.js';
import { startServer } from '../server/index.js';

const ping = (fieldId = 'n:p_1', kind = 'question') => ({
  t: 'g.ping', fieldId, area: 'board', row: 3, col: 4, kind,
});

describe('field pings', () => {
  test('boss prep uses shared battlefield coordinates for both own and scouted views', () => {
    assert.equal(typeof fieldPings.pingFieldTile, 'function');
    assert.equal(typeof fieldPings.pingViewTile, 'function');
    assert.equal(typeof fieldPings.pingRect, 'function');
    for (const [side, col] of [['bossL', 4], ['bossR', 16]]) {
      const board = { row: 10, col: 4 }, physical = { row: 3, col };
      assert.deepEqual(fieldPings.pingFieldTile(board, side), physical);
      assert.deepEqual(fieldPings.pingViewTile(physical, side), board);
      assert.deepEqual(fieldPings.pingFieldTile(physical, null), physical);
      assert.deepEqual(fieldPings.pingViewTile(physical, null), physical);
      assert.deepEqual(fieldPings.pingFieldTile(fieldPings.pingViewTile({ row: 3, col: 14 }, side), side), { row: 3, col: 14 });
    }
    const field = { prep: true, kind: 'boss', rect: GEO.BOSS_RECT };
    assert.deepEqual(fieldPings.pingRect(field, false, false), GEO.BOSS_RECT);
    assert.deepEqual(fieldPings.pingRect(field, false, true), GEO.NORMAL_RECT);
    assert.deepEqual(fieldPings.pingRect(field, true, false), GEO.BOSS_RECT);
    const fullBossPrep = { r0: 7, r1: 12, c0: 0, c1: 20 };
    for (const side of ['bossL', 'bossR']) {
      assert.deepEqual(fieldPings.pingRect(field, false, true, side, { kind: 'engine' }), fullBossPrep);
      assert.deepEqual(fieldPings.pingRect(field, false, true, side, { kind: 'fallback' }), GEO.NORMAL_RECT);
    }
    assert.deepEqual(fieldPings.pingRect(field, false, true, 'normal', { kind: 'engine' }), GEO.NORMAL_RECT);
  });

  test('protocol accepts the supported kinds and rejects malformed coordinates', () => {
    assert.ok(C2S['g.ping']);
    assert.ok(PING_KINDS.includes('heart'));
    for (const kind of PING_KINDS) assert.equal(validateC2S(ping('n:p_1', kind)), null, kind);
    assert.ok(S2C.includes('m.ping'));
    for (const bad of [
      { ...ping(), area: 'screen' },
      { ...ping(), kind: 'nope' },
      { ...ping(), row: -1 },
      { ...ping(), row: GEO.ROWS },
      { ...ping(), col: -1 },
      { ...ping(), col: GEO.COLS },
      { ...ping(), fieldId: 'x'.repeat(33) },
    ]) assert.notEqual(validateC2S(bad), null, JSON.stringify(bad));
  });

  test('real Match broadcasts a visible prep ping, rejects a hidden target, and rate limits it', () => {
    const h = makeMatch({ mode: 'coop', humans: 2, seed: 701, fake: true }).start();
    const m = h.m;
    h.toPrep(1);
    assert.deepEqual(m.handle('p_0', { ...ping(), name: 'forged name' }), { ok: true });
    assert.deepEqual(h.lastBc('m.ping'), {
      t: 'm.ping', playerId: 'p_0', name: h.ps('p_0').name, fieldId: 'n:p_1', area: 'board', row: 3, col: 4, kind: 'question',
    });
    assert.equal(m.handle('p_0', ping('n:p_0')).error, ERR.RATE);
    h.sched.advance(PING_COOLDOWN_MS);
    assert.equal(m.handle('p_0', ping('n:nobody')).error, ERR.BAD_TARGET);
    assert.equal(h.bc.filter((x) => x.t === 'm.ping').length, 1);
    assert.equal(m.handle('p_0', { ...ping(), row: GEO.ROWS }).error, ERR.BAD_MSG);
    assert.equal(m.handle('p_0', { ...ping(), col: -1 }).error, ERR.BAD_MSG);
    const own = { fieldId: 'b1', kind: 'boss', players: ['p_0'], live: true, cc: true };
    const other = { fieldId: 'b2', kind: 'boss', players: ['p_1'], live: true, cc: true };
    m.fields = [own, other];
    assert.equal(m.canWatchField(h.ps('p_0'), 'b2'), false, 'other boss group is hidden');
    assert.equal(m.canWatchField(h.ps('p_0'), 'n:p_1'), false, 'prep ID cannot bypass group restriction');
    own.kind = other.kind = 'normal';
    m.clientCombat = true;
    assert.equal(m.canWatchField(h.ps('p_0'), 'b2'), false, 'cannot watch elsewhere during own normal battle');
    own.live = false;
    assert.equal(m.canWatchField(h.ps('p_0'), 'b2'), true, 'can observe teammates after own battle ends');
    other.live = false;
    assert.equal(m.canWatchField(h.ps('p_0'), 'b2'), true, 'completed field remains viewable');
    m.fields = [];
    m.dispose();
  });

  test('StubMatch relays a ping and enforces its cooldown', () => {
    let now = 1000;
    const bc = [];
    const m = new StubMatch({
      roomCode: 'PING', mode: 'coop', difficulty: 'NORMAL', seed: 1,
      seats: [
        { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
        { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true },
      ],
      now: () => now, send() {}, broadcast: (msg) => bc.push(msg), onEnd() {},
    });
    assert.deepEqual(m.handle('p_0', ping()), { ok: true });
    assert.equal(bc.at(-1).t, 'm.ping');
    now += PING_COOLDOWN_MS - 1;
    assert.equal(m.handle('p_0', ping()).error, ERR.RATE);
    assert.equal(bc.filter((x) => x.t === 'm.ping').length, 1);
    now += 1;
    assert.deepEqual(m.handle('p_0', ping()), { ok: true });
    assert.equal(bc.filter((x) => x.t === 'm.ping').length, 2);
    assert.equal(m.handle('p_0', ping('n:nobody')).error, ERR.BAD_TARGET);
    m.dispose();
  });

  test('client filters by field and lifetime and picks tile polygons in viewport coordinates', () => {
    const p = { ...ping(), at: 1000 };
    assert.deepEqual(activePings([p], 'n:p_1', 1000), [p]);
    assert.deepEqual(activePings([p], 'n:p_0', 1000), []);
    assert.deepEqual(activePings([p], 'n:p_1', 3500), []);
    const view = { tileScreen: (r, c) => r === 3 && c === 4 ? { poly: [[100, 200], [120, 200], [120, 220], [100, 220]] } : null };
    const rect = { r0: 0, r1: 12, c0: 0, c1: 10 };
    assert.deepEqual(pingTileAt(view, rect, 110, 210), { row: 3, col: 4 });
    assert.equal(pingTileAt(view, rect, 50, 50), null);
  });

  test('real sockets relay heart pings to players and spectator seats', async (t) => {
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    t.after(() => srv.close());
    const clients = [];
    for (const name of ['P0', 'P1', 'Watcher']) {
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      clients.push(c);
      t.after(() => c.terminate());
      c.id = (await c.hello(name)).playerId;
    }
    const [a, b, watcher] = clients;
    assert.equal((await a.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    const room = await a.waitFor('room.state');
    assert.equal((await b.request({ t: 'room.join', code: room.code })).t, 'ok');
    assert.equal((await watcher.request({ t: 'room.spectate', code: room.code })).t, 'ok');
    assert.equal((await b.request({ t: 'room.ready', ready: true })).t, 'ok');
    assert.equal((await a.request({ t: 'room.start' })).t, 'ok');
    await a.waitFor('m.public');
    assert.equal((await a.request(ping(`n:${b.id}`, 'heart'))).t, 'ok');
    const received = await Promise.all(clients.map((c) => c.waitFor('m.ping')));
    for (const msg of received) assert.deepEqual(msg, { ...ping(`n:${b.id}`, 'heart'), t: 'm.ping', playerId: a.id, name: 'P0' });
    assert.equal((await watcher.request(ping(`n:${b.id}`, 'heart'))).code, ERR.SPECTATOR);
  });
});
