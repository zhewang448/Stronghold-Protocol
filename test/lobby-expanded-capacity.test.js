import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { validateC2S } from '../shared/protocol.js';
import { DEFAULT_SEATS, MAX_SEATS } from '../shared/constants.js';
import { Match } from '../server/match/Match.js';
import { setTimeout as delay } from 'node:timers/promises';

class FastOpeningMatch extends Match {
  constructor(opts) { super({ ...opts, timerScale: 0 }); }
  enterPrep() { super.enterPrep(); this.setDeadline(0); }
}

test('expanded capacity is optional, bounded and compatible with custom room codes', () => {
  assert.equal(DEFAULT_SEATS, 4);
  assert.equal(MAX_SEATS, 20);
  for (const capacity of [4, 8, 10, 16, 20]) {
    assert.equal(validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', code: 'EXPN', capacity }), null);
    assert.equal(validateC2S({ t: 'room.setMaxSeats', n: capacity }), null);
  }
  for (const capacity of [0, 5, 21, '20', NaN]) assert.ok(validateC2S({ t: 'room.setCapacity', capacity }));
});

test('twenty real socket clients resize, join, ready and start while four remains the default', { timeout: 30000 }, async t => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, MatchClass: StubMatch });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map(c => c.terminate())); await srv.close(); });
  const connect = async name => {
    const client = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(client);
    client.id = (await client.hello(name)).playerId;
    return client;
  };
  const host = await connect('CapacityHost');
  assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', code: 'EXPN' })).t, 'ok');
  const initial = await host.waitFor('room.state', s => s.code === 'EXPN');
  assert.equal(initial.seats.length, 4);
  assert.equal((await host.request({ t: 'room.setMaxSeats', n: 20 })).t, 'ok');
  for (let i = 1; i < 20; i++) {
    const client = await connect(`Guest${i}`);
    assert.equal((await client.request({ t: 'room.join', code: 'EXPN' })).t, 'ok');
    assert.equal((await client.request({ t: 'room.ready', ready: true })).t, 'ok');
  }
  const room = srv.lobby.rooms.get('EXPN');
  assert.equal(room.capacity, 20);
  const identity = room.seats.map(s => ({ ...s }));
  assert.equal((await host.request({ t: 'room.setCapacity', capacity: 8 })).code, 'ROOM_FULL');
  assert.deepEqual(room.seats, identity);
  assert.equal((await clients[1].request({ t: 'room.setCapacity', capacity: 20 })).code, 'NOT_HOST');
  assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
  await Promise.all(clients.map(c => c.waitFor('m.public', p => p.players?.length === 20)));
  assert.equal((await host.request({ t: 'room.setCapacity', capacity: 8 })).code, 'ROOM_STARTED');
});

for (const capacity of [8, 20]) test(`${capacity} socket players complete the real Match opening and all group choices`, { timeout: 30000 }, async t => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, MatchClass: FastOpeningMatch });
  const clients = [], byId = new Map();
  t.after(async () => { await Promise.all(clients.map(c => c.terminate())); await srv.close(); });
  for (let i = 0; i < capacity; i++) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    const welcome = await c.hello(`Doctor${i}`);
    byId.set(welcome.playerId, c);
    const intent = i === 0 ? { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', code: 'REAL', capacity }
      : { t: 'room.join', code: 'REAL' };
    assert.equal((await c.request(intent)).t, 'ok');
    if (i) assert.equal((await c.request({ t: 'room.ready', ready: true })).t, 'ok');
  }
  assert.equal((await clients[0].request({ t: 'room.start' })).t, 'ok');
  const m = srv.lobby.rooms.get('REAL').match;
  const until = Date.now() + 15000;
  while (m.phase !== 'PREP' && Date.now() < until) {
    if (m.phase === 'INFO_CHECK') {
      for (const ps of m.order) if (!ps.infoReady) assert.equal((await byId.get(ps.playerId).request({ t: 'g.infoReady' })).t, 'ok');
    } else if (m.phase === 'BAND_DRAFT') {
      for (const group of m.draft.groups) {
        const id = group.order[group.idx];
        if (!id || group.done) continue;
        assert.equal((await byId.get(id).request({ t: 'g.band', bandId: m.defaultBand(id), draftId: m.draft.id, groupId: group.id })).t, 'ok');
      }
    } else if (m.phase === 'SP_DRAFT') {
      for (const group of m.sp.groups) {
        const id = group.order[group.idx], card = group.cards.find(c => m.spCardAvailable(c, group));
        if (!id || !card || group.done) continue;
        assert.equal((await byId.get(id).request({ t: 'g.choice', idx: card.idx, draftId: m.sp.id, groupId: group.id })).t, 'ok');
      }
    }
    await delay(5);
  }
  assert.equal(m.phase, 'PREP');
  assert.equal(m.order.length, capacity);
  assert.deepEqual(m.poolGroups.map(g => g.playerIds.length), Array(capacity / 4).fill(4));
  assert.equal(m.errorCount, 0);
  assert.ok(m.prepSnapshots.get(1)?.data.groups.length === capacity / 4);
  await Promise.all(clients.map(c => c.waitFor('m.public', p => p.phase === 'PREP' && p.players.length === capacity)));
});
