import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { validateC2S } from '../shared/protocol.js';
import { cardArtKey, isCardArtFrame, isCardArtKey, normalizeCardArt, sharedCardArt } from '../shared/cardArt.js';

test('room artwork accepts bounded finite framing and keeps appearances separate', () => {
  const frame = { zoom: 1.7, ox: 23, oy: -19 };
  assert.equal(validateC2S({ t: 'room.cardArt', key: 'custom', frame }), null);
  assert.equal(isCardArtKey(cardArtKey('char_113_cqbw', 'char_113_cqbw@epoque#7')), true);
  for (const bad of [{ ...frame, zoom: 3.01 }, { ...frame, zoom: 0.49 }, { ...frame, ox: 101 },
    { ...frame, oy: -101 }, { ...frame, ox: NaN }, { ...frame, zoom: Infinity }, [], null]) {
    assert.equal(isCardArtFrame(bad), false);
    assert.notEqual(validateC2S({ t: 'room.cardArt', key: 'custom', frame: bad }), null);
  }
  for (const key of ['https://example.com/a.png', 'custom:other-player', 'x'.repeat(257), '__proto__']) assert.equal(isCardArtKey(key), false);
  assert.deepEqual(normalizeCardArt({ zoom: Infinity, ox: NaN, oy: 200 }), { zoom: 1, ox: 0, oy: 100 });
  assert.deepEqual(sharedCardArt({ key: 'custom', frame }, 'custom'), frame);
  assert.deepEqual(sharedCardArt({ key: 'custom', frame }, 'char_113_cqbw'), { zoom: 1, ox: 0, oy: 0 });
  assert.deepEqual(sharedCardArt(null, 'custom'), { zoom: 1, ox: 0, oy: 0 });
});

test('room artwork is shared by owner with peers and spectators, survives reconnect and follows room changes', async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  t.after(() => server.close());
  const clients = [];
  t.after(async () => { await Promise.all(clients.map(client => client.terminate())); });
  const player = async (name, token) => {
    const client = await TestClient.connect('ws://127.0.0.1:' + server.port + '/ws'); clients.push(client);
    const welcome = await client.hello(name, token);
    assert.equal(welcome.uiMigration.cardArt, true);
    return Object.assign(client, { id: welcome.playerId, token: welcome.token });
  };
  const ok = async (client, message) => assert.equal((await client.request(message)).t, 'ok', JSON.stringify(message));
  const host = await player('Art host'), guest = await player('Art guest'), watcher = await player('Art watcher');
  await ok(host, { t: 'room.create', mode: 'coop' });
  const first = await host.waitFor('room.state', state => state.hostId === host.id);
  await ok(guest, { t: 'room.join', code: first.code });
  await ok(watcher, { t: 'room.spectate', code: first.code });
  const own = { key: 'char_113_cqbw:char_113_cqbw@epoque#7', frame: { zoom: 1.7, ox: 23, oy: -19 } };
  const theirs = { key: 'custom', frame: { zoom: 0.5, ox: -100, oy: 100 } };
  await ok(host, { t: 'room.cardArt', code: first.code, ...own });
  await ok(guest, { t: 'room.cardArt', code: first.code, ...theirs });
  for (const client of [host, guest, watcher]) {
    const state = await client.waitFor('room.state', state => state.seats.find(seat => seat?.playerId === guest.id)?.cardArt?.frame?.zoom === 0.5);
    assert.deepEqual(state.seats.find(seat => seat?.playerId === host.id).cardArt, own);
    assert.deepEqual(state.seats.find(seat => seat?.playerId === guest.id).cardArt, theirs);
  }
  const bad = await host.request({ t: 'room.cardArt', key: 'custom', frame: { zoom: 99, ox: 0, oy: 0 } });
  assert.equal(bad.t, 'error');
  assert.equal((await watcher.request({ t: 'room.cardArt', ...theirs })).t, 'error', 'a spectator cannot edit a seated owner');
  await host.terminate();
  const resumed = await player('Art host', host.token);
  let state = await resumed.waitFor('room.state', state => state.seats.some(seat => seat?.playerId === host.id));
  assert.deepEqual(state.seats.find(seat => seat?.playerId === host.id).cardArt, own);
  await ok(resumed, { t: 'room.leave' });
  await ok(resumed, { t: 'room.create', mode: 'coop' });
  state = await resumed.waitFor('room.state', state => state.code !== first.code && state.hostId === host.id);
  assert.deepEqual(state.seats[0].cardArt, own);
  assert.equal((await resumed.request({ t: 'room.cardArt', code: first.code, ...theirs })).t, 'error', 'a stale room request is refused');
  await ok(resumed, { t: 'room.cardArt', code: state.code, ...theirs });
  state = await resumed.waitFor('room.state', state => state.seats[0]?.cardArt?.key === 'custom');
  assert.deepEqual(state.seats[0].cardArt, theirs);
});
