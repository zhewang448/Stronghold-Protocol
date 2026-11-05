import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { RANDOM_BAND_ID } from '../../shared/constants.js';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { getData } from '../../server/data.js';
import { validateC2S } from '../../shared/protocol.js';
import { wireOptions } from '../../server/match/host/proxy.js';
import { resetHostSettings, getRoomCreation, setRoomCreation } from '../../server/match/hostSettings.js';
import { buildRecord, normalizeRecord, recordToResult, isModdedRecord } from '../../public/js/ui/stats.js';

const log = { info() {}, warn() {}, error() {}, debug() {} };
test('duplicate strategies default off, validate booleans, synchronize, reset readiness and lock after start', t => {
  resetHostSettings(); t.after(resetHostSettings);
  assert.equal(getRoomCreation().defaults.allowDuplicateBands, false);
  assert.equal(validateC2S({ t: 'room.setAllowDuplicateBands', on: true }), null);
  assert.notEqual(validateC2S({ t: 'room.setAllowDuplicateBands', on: 'true' }), null);
  const registry = new SessionRegistry(), lobby = new Lobby({ registry, getData, log });
  t.after(() => lobby.shutdown());
  const player = name => { const p = registry.create(name); p.connected = true; p.ws = { readyState: 1, bufferedAmount: 0, send() {} }; return p; };
  const host = player('Host'), guest = player('Guest');
  assert.deepEqual(lobby.create(host, { mode: 'coop' }), { ok: true });
  const room = lobby.roomOf(host);
  assert.equal(room.allowDuplicateBands, false);
  assert.equal(room.toState().allowDuplicateBands, undefined);
  lobby.join(guest, { code: room.code });
  room.seatOf(guest.playerId).ready = true;
  assert.equal(lobby.setAllowDuplicateBands(guest, { on: true }).error, 'NOT_HOST');
  assert.equal(lobby.setAllowDuplicateBands(host, { on: 1 }).error, 'BAD_MSG');
  assert.deepEqual(lobby.setAllowDuplicateBands(host, { on: true }), { ok: true });
  assert.equal(room.toState().allowDuplicateBands, true);
  assert.equal(room.seatOf(guest.playerId).ready, false);
  assert.equal(lobby.matchmaking.eligible(room), false);
  assert.equal(wireOptions({ allowDuplicateBands: true }).allowDuplicateBands, true);
  assert.deepEqual(lobby.resetSettings(host), { ok: true });
  assert.equal(room.allowDuplicateBands, false);
  lobby.setAllowDuplicateBands(host, { on: true });
  room.seatOf(guest.playerId).ready = true;
  assert.deepEqual(lobby.start(host), { ok: true });
  assert.equal(room.match.allowDuplicateBands, true);
  assert.equal(room.match.publicView().allowDuplicateBands, true);
  assert.equal(lobby.setAllowDuplicateBands(host, { on: false }).error, 'ROOM_STARTED');
});

test('host configuration may lock the option; solo always keeps it off', t => {
  resetHostSettings(); t.after(resetHostSettings);
  assert.deepEqual(setRoomCreation({ defaults: { allowDuplicateBands: true }, hostControls: { allowDuplicateBands: false } }), { ok: true });
  const h = makeMatch({ mode: 'solo', allowDuplicateBands: true }); t.after(() => h.m.dispose());
  assert.equal(h.m.allowDuplicateBands, false);
});

for (const humans of [2, 4, 20]) for (const enabled of [false, true]) test(`${humans} seats: duplicate strategies ${enabled ? 'on' : 'off'} applies within every fixed group`, t => {
  const h = makeMatch({ humans, allowDuplicateBands: enabled, fake: true }).start(); t.after(() => h.m.dispose());
  h.m.enterBandDraft();
  for (const g of h.m.draft.groups) {
    const first = h.m.players.get(g.order[0]);
    assert.deepEqual(h.m.pickBand(first, 'band_bldsk'), { ok: true });
    for (const pid of g.order.slice(1)) {
      const ps = h.m.players.get(pid);
      assert.equal(h.m.bandTaken('band_bldsk', pid), !enabled);
      assert.equal(h.m.timeoutBand(pid) === 'band_bldsk', enabled);
      const result = h.m.pickBand(ps, 'band_bldsk');
      if (enabled) assert.deepEqual(result, { ok: true });
      else {
        assert.equal(result.error, 'BAD_TARGET');
        assert.deepEqual(h.m.pickBand(ps, h.m.defaultBand(pid)), { ok: true });
      }
    }
    assert.equal(new Set(Object.values(g.picks)).size, enabled ? 1 : g.order.length);
  }
});

test('random and timeout picks obey the same policy, retaining their existing bonuses', t => {
  for (const enabled of [false, true]) {
    const h = makeMatch({ humans: 2, allowDuplicateBands: enabled, fake: true }).start(); t.after(() => h.m.dispose());
    h.m.enterBandDraft();
    const g = h.m.draft.groups[0], first = h.m.players.get(g.order[0]), next = h.m.players.get(g.order[1]);
    h.m.pickBand(first, 'band_bldsk');
    h.m.bandFocus(next, 'band_bldsk');
    assert.equal(h.m.timeoutBand(next.playerId) === 'band_bldsk', enabled);
    h.m.rngDraft.pick = values => { assert.equal(values.includes('band_bldsk'), enabled); return values[0]; };
    const funds = next.funds;
    assert.deepEqual(h.m.pickBand(next, RANDOM_BAND_ID), { ok: true });
    assert.equal(next.funds, funds + 1);
    assert.equal(next.lp, h.m.gd.startLp(next.bandId) + 1);
  }
});

test('two AI presets can repeat a human strategy when enabled', t => {
  const h = makeMatch({ humans: 1, bots: 2, allowDuplicateBands: true, aiPicksLast: true, fake: true }).start();
  t.after(() => h.m.dispose());
  for (const ps of h.m.order) if (ps.isBot) ps.botBand = 'band_bldsk';
  h.toPrep();
  assert.ok(h.m.order.every(ps => ps.bandId === 'band_bldsk'));
});

test('custom draft policy survives result and local record roundtrips and remains unofficial', () => {
  const source = { victory: true, allowDuplicateBands: true, players: [{ playerId: 'self', bandId: 'band_bldsk', alive: true, victory: true }] };
  const rec = buildRecord(source, { myId: 'self' });
  assert.equal(rec.allowDuplicateBands, true);
  assert.equal(normalizeRecord(rec).allowDuplicateBands, true);
  assert.equal(recordToResult(rec).allowDuplicateBands, true);
  assert.equal(isModdedRecord(rec), true);
});
