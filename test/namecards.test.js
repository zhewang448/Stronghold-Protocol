import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { NAMECARD_BONDS, normalizeNamecard, resolveNamecard, validNamecard, dragNamecard } from '../shared/namecards.js';
import { validateC2S } from '../shared/protocol.js';

test('automatic backgrounds cover eight core bonds, use Yan emblem and allow safe manual overrides', () => {
  const manifest = { ui: Object.fromEntries(Object.values(NAMECARD_BONDS).map(k => ['campLogo/logo_' + k, '/assets/' + k + '.png'])) };
  const auto = normalizeNamecard(null);
  assert.equal(auto.mode, 'auto');
  for (const [id, camp] of Object.entries(NAMECARD_BONDS)) assert.equal(resolveNamecard(auto, id, manifest).resolved, 'camp:' + camp);
  assert.equal(resolveNamecard(auto, 'yanShip', manifest).resolved, 'camp:yan');
  for (const [bond, assets] of [[null, manifest], ['unknown', manifest], ['yanShip', {}]]) assert.equal(resolveNamecard(auto, bond, assets).resolved, null);
  const manual = { ...auto, mode: 'manual', id: 'camp:yan' };
  assert.equal(resolveNamecard(manual, 'egirShip', manifest).resolved, 'camp:yan');
  assert.equal(resolveNamecard({ ...auto, mode: 'none' }, 'yanShip', manifest).resolved, null);
  for (const value of [{ ...manual, id: 'https://example.com/a.png' }, { ...auto, zoom: 99 }, { ...auto, x: Infinity }, { ...auto, url: '/assets/x.png' }]) {
    assert.equal(validNamecard(value), false); assert.notEqual(validateC2S({ t: 'room.namecard', selection: value }), null);
  }
});

test('background framing follows the actual image overflow and stops at the crop edges', () => {
  const frame = { x: 50, y: 50, zoom: 100 }, plate = { width: 600, height: 186, aspect: 1 };
  assert.deepEqual(dragNamecard(frame, 30, 207, plate), { x: 50, y: 0, zoom: 100 });
  assert.equal(dragNamecard(frame, 0, -207, plate).y, 100);
  assert.equal(dragNamecard({ ...frame, zoom: 200 }, 300, 0, plate).x, 0);
  assert.deepEqual(dragNamecard(frame, 50, 50, { ...plate, aspect: 0 }), frame);
});

test('two players and a spectator receive automatic/manual/none backgrounds; reconnect and room changes preserve selection', async t => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', log: { info() {}, warn() {}, error() {} } });
  t.after(() => srv.close());
  const clients = [];
  const player = async (name, token) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c);
    const w = await c.hello(name, token); c.id = w.playerId; c.token = w.token;
    assert.equal(w.uiMigration.namecards, true); return c;
  };
  t.after(async () => { await Promise.all(clients.map(c => c.terminate())); });
  const ok = async (c, msg) => { assert.equal((await c.request(msg)).t, 'ok', JSON.stringify(msg)); };
  const host = await player('Host'), guest = await player('Guest'), watcher = await player('Watcher');
  await ok(host, { t: 'room.create', mode: 'coop' });
  let state = await host.waitFor('room.state', s => s.hostId === host.id);
  await ok(guest, { t: 'room.join', code: state.code }); await ok(watcher, { t: 'room.spectate', code: state.code });
  await ok(host, { t: 'room.bondPlan', bondId: 'yanShip' });
  for (const c of [host, guest, watcher]) {
    state = await c.waitFor('room.state', s => s.seats.some(x => x?.playerId === host.id && x.namecard?.resolved === 'camp:yan'));
    assert.equal(state.seats.find(x => x?.playerId === host.id).namecard.mode, 'auto');
  }
  const manual = { mode: 'manual', id: 'loading:core', x: 23, y: 76, zoom: 175 };
  await ok(host, { t: 'room.namecard', selection: manual });
  await ok(host, { t: 'room.bondPlan', bondId: 'egirShip' });
  state = await watcher.waitFor('room.state', s => s.seats.some(x => x?.playerId === host.id && x.bondPlan === 'egirShip'));
  assert.deepEqual(state.seats.find(x => x?.playerId === host.id).namecard, { ...manual, resolved: 'loading:core' });
  await host.terminate(); const resumed = await player('Host', host.token);
  state = await resumed.waitFor('room.state', s => s.seats.some(x => x?.playerId === host.id));
  assert.deepEqual(state.seats.find(x => x?.playerId === host.id).namecard, { ...manual, resolved: 'loading:core' });
  await ok(resumed, { t: 'room.leave' }); await ok(resumed, { t: 'room.create', mode: 'coop' });
  state = await resumed.waitFor('room.state', s => s.hostId === host.id && s.seats.filter(Boolean).length === 1);
  assert.deepEqual(state.seats[0].namecard, { ...manual, resolved: 'loading:core' });
  await ok(resumed, { t: 'room.namecard', selection: { ...manual, mode: 'none', id: '' } });
  state = await resumed.waitFor('room.state', s => s.seats[0]?.namecard?.mode === 'none');
  assert.equal(state.seats[0].namecard.resolved, null);
  await ok(resumed, { t: 'room.addBot' });
  state = await resumed.waitFor('room.state', s => s.seats.some(x => x?.isBot));
  assert.equal(state.seats.find(x => x?.isBot).namecard, undefined);
});
