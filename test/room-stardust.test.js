import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { getData } from '../server/data.js';
import { lobbyOptionsFrom } from '../server/http/config.js';
import { validateC2S } from '../shared/protocol.js';
import { wireOptions } from '../server/match/host/proxy.js';

const log = { info() {}, warn() {}, error() {}, debug() {} };
function fixture(context, options = {}) {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, log, getData, options });
  context.after(() => lobby.shutdown());
  const player = (name) => {
    const session = registry.create(name);
    session.connected = true;
    session.ws = { readyState: 1, bufferedAmount: 0, send() {} };
    return session;
  };
  return { lobby, player };
}

test('AI strategy and rescue options are host-controlled and locked during play', (context) => {
  const { lobby, player } = fixture(context);
  const host = player('Host'), guest = player('Guest');
  assert.deepEqual(lobby.create(host, { mode: 'coop' }), { ok: true });
  const room = lobby.roomOf(host);
  assert.deepEqual(lobby.join(guest, { code: room.code }), { ok: true });
  assert.deepEqual(lobby.addBot(host), { ok: true });
  assert.equal(validateC2S({ t: 'room.setBotBand', seat: 2, bandId: 'band_amiya' }), null);
  assert.notEqual(validateC2S({ t: 'room.setBotBand', seat: 2, bandId: 42 }), null);
  assert.equal(lobby.setBotBand(guest, { seat: 2, bandId: 'band_amiya' }).error, 'NOT_HOST');
  assert.equal(lobby.setBotBand(host, { seat: 1, bandId: 'band_amiya' }).error, 'BAD_TARGET');
  assert.equal(lobby.setBotBand(host, { seat: 2, bandId: 'band_missing' }).error, 'BAD_TARGET');
  assert.equal(lobby.setRescue(guest, { on: true }).error, 'NOT_HOST');
  room.seatOf(guest.playerId).ready = true;
  assert.deepEqual(lobby.setBotBand(host, { seat: 2, bandId: 'band_amiya' }), { ok: true });
  assert.equal(room.toState().seats[2].botBand, 'band_amiya');
  assert.equal(room.seatOf(guest.playerId).ready, false);
  assert.deepEqual(lobby.setRescue(host, { on: true }), { ok: true });
  assert.equal(room.toState().rescueEnabled, true);
  assert.equal(lobby.matchmaking.eligible(room), false);
  assert.equal(wireOptions({ rescueEnabled: true }).rescueEnabled, true);
  room.seatOf(guest.playerId).ready = true;
  assert.deepEqual(lobby.start(host), { ok: true });
  assert.equal(room.match.rescueEnabled, true);
  assert.equal(room.match.players.get(room.seats[2].playerId).botBand, 'band_amiya');
  assert.equal(lobby.setBotBand(host, { seat: 2, bandId: null }).error, 'ROOM_STARTED');
  assert.equal(lobby.setRescue(host, { on: false }).error, 'ROOM_STARTED');
});

test('spectators default to two and a bounded server option permits more', (context) => {
  const previous = process.env.SP_MAX_SPECTATORS;
  try {
    process.env.SP_MAX_SPECTATORS = '8';
    assert.equal(lobbyOptionsFrom({}, log).maxSpectators, 8);
    process.env.SP_MAX_SPECTATORS = '21';
    assert.equal(lobbyOptionsFrom({}, log).maxSpectators, undefined);
  } finally {
    if (previous == null) delete process.env.SP_MAX_SPECTATORS;
    else process.env.SP_MAX_SPECTATORS = previous;
  }
  const { lobby, player } = fixture(context, { maxSpectators: 5 });
  const host = player('Host');
  assert.deepEqual(lobby.create(host, { mode: 'coop' }), { ok: true });
  const room = lobby.roomOf(host);
  const viewers = Array.from({ length: 6 }, (_unused, index) => player(`Viewer ${index}`));
  for (const viewer of viewers.slice(0, 5)) assert.deepEqual(lobby.spectate(viewer, { code: room.code }), { ok: true });
  assert.equal(room.toState().spectatorLimit, 5);
  assert.equal(lobby.listRooms().rooms[0].watchable, false);
  assert.equal(lobby.spectate(viewers[5], { code: room.code }).error, 'ROOM_FULL');
  assert.equal(lobby.ready(viewers[0], { ready: true }).error, 'SPECTATOR');
  assert.deepEqual(lobby.start(host), { ok: true });
  assert.equal(room.match.spectators.size, 5);
  assert.equal(room.match.players.size, 1);
  assert.deepEqual(lobby.removeSpectator(host, { playerId: viewers[0].playerId }), { ok: true });
  assert.deepEqual(lobby.spectate(viewers[5], { code: room.code }), { ok: true });
});
