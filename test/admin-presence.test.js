// The console reads connection state from the lobby while the match is catching up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomsView, matchView } from '../server/admin.js';
import { makeMatch } from './match/harness.js';

for (const hosted of [false, true]) {
  test('console presence follows current seats by player ID: ' + (hosted ? 'hosted' : 'local'), async t => {
    const h = makeMatch({ humans: 2, bots: 1, fake: true }).start().toPrep();
    t.after(() => h.m.dispose());
    const snapshot = matchView(h.m);
    const seats = h.m.order.map(p => ({ playerId: p.playerId, seat: p.seat, name: p.name, isBot: p.isBot, connected: p.connected, left: false }));
    const room = { code: 'TEST', seats: [seats[2], null, seats[0], seats[1]], spectators: [], match: hosted ? { hosted: true, admin: async () => snapshot } : h.m };
    const lobby = { rooms: new Map([['TEST', room]]) };
    const read = async () => (await roomsView(lobby))[0];
    const player = view => view.match.players.find(p => p.id === 'p_0');
    assert.equal(player(await read()).connected, true);
    seats[0].connected = false;
    let view = await read();
    assert.equal(player(view).connected, false, 'socket closes before match handles disconnect');
    assert.equal(view.seats.find(p => p.id === 'p_0').connected, false);
    assert.equal(player(view).lp, snapshot.players[0].lp, 'LP still comes from match');
    h.ps('p_0').connected = false;
    snapshot.players[0].connected = false;
    seats[0].connected = true;
    view = await read();
    assert.equal(player(view).connected, true, 'socket reconnects before match resync');
    assert.equal(h.ps('p_0').connected, false, 'projection must not mutate simulation');
    assert.equal(snapshot.players[0].connected, false, 'projection must not mutate host snapshot');
    seats[0].left = true;
    assert.equal(player(await read()).connected, false, 'departed seat is offline');
    seats[0].left = false;
    h.ps('p_0').alive = false;
    assert.equal(player(await read()).connected, true, 'elimination does not disconnect player');
    seats[2].connected = false;
    assert.equal((await read()).match.players.find(p => p.id === 'ai_0').connected, true);
    assert.equal((await read()).match.players.find(p => p.id === 'p_1').connected, true);
  });
}

test('console presence uses seat changes made while hosted view is in flight', async () => {
  let resolveView;
  const pending = new Promise(resolve => { resolveView = resolve; });
  const seat = { playerId: 'p', connected: true, isBot: false };
  const room = { code: 'TEST', seats: [seat], match: { hosted: true, admin: () => pending } };
  const result = roomsView({ rooms: new Map([['TEST', room]]) });
  seat.connected = false;
  resolveView({ players: [{ id: 'p', connected: true, lp: 12 }] });
  assert.equal((await result)[0].match.players[0].connected, false);
});

test('console presence keeps lobby-only and missing-seat harness views readable', async t => {
  const h = makeMatch({ humans: 1, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const rooms = new Map([
    ['WAIT', { code: 'WAIT', seats: [{ playerId: 'wait', connected: false }], match: null }],
    ['TEST', { code: 'TEST', seats: [], match: h.m }],
    ['HOST', { code: 'HOST', seats: [], match: { hosted: true, admin: async () => ({ error: 'stopped' }) } }],
  ]);
  const view = await roomsView({ rooms });
  assert.equal(view[0].seats[0].connected, false);
  assert.equal(view[0].match, null);
  assert.equal(view[1].match.players[0].connected, true);
  assert.deepEqual(view[2].match, { error: 'stopped' });
});
