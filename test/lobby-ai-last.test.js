// test/lobby-ai-last.test.js — the co-op room option 「AI 队友最后选择」 (room.setAiPicksLast {on}; GitHub #338): host-only,
// before the match only, co-op rooms only, on by default; room.state.aiPicksLast shows it to everybody; the match gets
// it as opts.aiPicksLast when it starts (server/match/Match.js orders the drafts with it — test/match/ai-picks-last.test.js).
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';
import { Room } from '../server/lobby.js';
import { setUniteLayerGains, setAllowRoomUniteLayerGains, resetHostSettings } from '../server/match/hostSettings.js';
import { wireOptions } from '../server/match/host/proxy.js';

function clientPool(getUrl) {
  const open = new Set();
  return {
    async connect() { const c = await TestClient.connect(getUrl()); open.add(c); return c; },
    async player(name, token) {
      const c = await this.connect();
      const w = await c.hello(name, token);
      c.id = w.playerId;
      c.token = w.token;
      return c;
    },
    async closeAll() {
      await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
      open.clear();
    },
  };
}
const quietLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
const seatOf = (state, id) => state.seats.find((s) => s && s.playerId === id) || null;
async function createRoom(c, mode = 'coop') {
  await ok(c, { t: 'room.create', mode, difficulty: 'NORMAL' });
  return c.waitFor('room.state', (s) => s.hostId === c.id && s.mode === mode);
}
async function joinRoom(c, code) {
  await ok(c, { t: 'room.join', code });
  return c.waitFor('room.state', (s) => s.code === code && !!seatOf(s, c.id));
}

/** StubMatch that records the options each match was started with. */
const started = [];
class RecordingMatch extends StubMatch {
  constructor(opts) {
    super(opts);
    started.push(opts);
  }
}

test('protocol: room.setAiPicksLast takes exactly a boolean `on`', () => {
  assert.equal(validateC2S({ t: 'room.setAiPicksLast', on: true }), null);
  assert.equal(validateC2S({ t: 'room.setAiPicksLast', on: false }), null);
  for (const on of [undefined, null, 1, 0, 'true', 'yes', {}, []]) {
    assert.notEqual(validateC2S({ t: 'room.setAiPicksLast', on }), null, JSON.stringify(on));
  }
});

describe('room.setAiPicksLast (lobby)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: RecordingMatch, lobbyGraceMs: 60_000 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => {
    await srv?.close();
    assert.deepEqual(cap.errors, [], 'no server errors logged');
  });

test('on by default; host-only; every seat sees it in room.state; a change un-readies the guests like the difficulty', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    assert.equal(st.aiPicksLast, true);
    const guest = await pool.player('Guest');
    const js = await joinRoom(guest, st.code);
    assert.equal(js.aiPicksLast, true);
    await err(guest, { t: 'room.setAiPicksLast', on: false }, ERR.NOT_HOST);
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => s.aiPicksLast === true && seatOf(s, guest.id)?.ready);
    await ok(host, { t: 'room.setAiPicksLast', on: false });
    const off = await guest.waitFor('room.state', (s) => s.aiPicksLast === false);
    assert.equal(seatOf(off, guest.id).ready, false, 'the rules changed: the guest confirms again');
    await ok(host, { t: 'room.setAiPicksLast', on: true });
    await guest.waitFor('room.state', (s) => s.aiPicksLast === true);
    // The same value again changes nothing (no broadcast needed, still ok).
    await ok(host, { t: 'room.setAiPicksLast', on: true });
    await ok(host, { t: 'room.setAiPicksLast', on: false });
    await guest.waitFor('room.state', (s) => s.aiPicksLast === false);
    // a malformed value never reaches the lobby
    await err(host, { t: 'room.setAiPicksLast', on: 'yes' }, ERR.BAD_MSG);
  });

  test('solo rooms have no AI teammates: refused, the state stays off', async () => {
    const host = await pool.player('Solo');
    const st = await createRoom(host, 'solo');
    assert.equal(st.aiPicksLast, false);
    await err(host, { t: 'room.setAiPicksLast', on: true }, ERR.BAD_TARGET);
  });

  test('the match gets it at the start; it cannot change during the match; the room keeps it for the next match and a new host', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    const guest = await pool.player('Guest');
    await joinRoom(guest, st.code);
    await ok(host, { t: 'room.addBot' });
    await ok(host, { t: 'room.setAiPicksLast', on: true });
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => s.aiPicksLast && seatOf(s, guest.id)?.ready);
    const n = started.length;
    await ok(host, { t: 'room.start' });
    await guest.waitFor('room.state', (s) => s.inMatch && s.aiPicksLast === true);
    assert.equal(started.length, n + 1);
    assert.equal(started[n].aiPicksLast, true, 'opts.aiPicksLast');
    await err(host, { t: 'room.setAiPicksLast', on: false }, ERR.ROOM_STARTED);
    await err(guest, { t: 'room.setAiPicksLast', on: false }, ERR.NOT_HOST);
    // the stub match ends once every human confirmed the briefing → back in the lobby with the option kept
    guest.clearInbox();
    await ok(host, { t: 'g.infoReady' });
    await ok(guest, { t: 'g.infoReady' });
    const back = await guest.waitFor('room.state', (s) => !s.inMatch);
    assert.equal(back.aiPicksLast, true);
    // host migration keeps the room's settings
    await ok(host, { t: 'room.leave' });
    const migrated = await guest.waitFor('room.state', (s) => s.hostId === guest.id);
    assert.equal(migrated.aiPicksLast, true);
    await ok(guest, { t: 'room.setAiPicksLast', on: false });
    await guest.waitFor('room.state', (s) => s.aiPicksLast === false);
  });

  test('an explicit host opt-out sends aiPicksLast false to the match', async () => {
    const host = await pool.player('Host');
    await createRoom(host);
    await ok(host, { t: 'room.setAiPicksLast', on: false });
    await ok(host, { t: 'room.addBot' });
    const n = started.length;
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => s.inMatch);
    assert.equal(started[n].aiPicksLast, false);
  });

  test('room-local unite layers: isolated, host-only, un-readies only on change, fixed while playing and kept after migration', async t => {
    t.after(resetHostSettings);
    setAllowRoomUniteLayerGains(true);
    const host = await pool.player('Host');
    await err(host, { t: 'room.setUniteLayerGains', on: true }, ERR.NOT_IN_ROOM);
    const st = await createRoom(host);
    assert.equal(st.uniteLayerGains, false);
    const guest = await pool.player('Guest');
    await joinRoom(guest, st.code);
    await err(guest, { t: 'room.setUniteLayerGains', on: true }, ERR.NOT_HOST);
    await err(host, { t: 'room.setUniteLayerGains', on: 'yes' }, ERR.BAD_MSG);
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', s => seatOf(s, guest.id)?.ready);
    await ok(host, { t: 'room.setUniteLayerGains', on: false });
    assert.equal(srv.lobby.roomOf(srv.registry.byId(host.id)).seats.find(s => s?.playerId === guest.id).ready, true);
    await ok(host, { t: 'room.setUniteLayerGains', on: true });
    const changed = await guest.waitFor('room.state', s => s.uniteLayerGains === true);
    assert.equal(seatOf(changed, guest.id).ready, false);
    const other = await pool.player('Other');
    const isolated = await createRoom(other);
    assert.equal(isolated.uniteLayerGains, false);
    await ok(guest, { t: 'room.ready', ready: true });
    const n = started.length;
    await ok(host, { t: 'room.start' });
    await guest.waitFor('room.state', s => s.inMatch && s.uniteLayerGains);
    assert.equal(started[n].uniteLayerGains, true);
    await err(host, { t: 'room.setUniteLayerGains', on: false }, ERR.ROOM_STARTED);
    guest.clearInbox();
    await ok(host, { t: 'g.infoReady' });
    await ok(guest, { t: 'g.infoReady' });
    assert.equal((await guest.waitFor('room.state', s => !s.inMatch)).uniteLayerGains, true);
    await ok(host, { t: 'room.leave' });
    assert.equal((await guest.waitFor('room.state', s => s.hostId === guest.id)).uniteLayerGains, true);
    await ok(guest, { t: 'room.setUniteLayerGains', on: false });
    await guest.waitFor('room.state', s => s.uniteLayerGains === false);
    await ok(guest, { t: 'room.start' });
    assert.equal(started.at(-1).uniteLayerGains, false, 'the following match receives the updated room rule');
  });

  test('console permission defaults off and revoking it locks existing rooms without changing their rule', async t => {
    resetHostSettings(); t.after(resetHostSettings);
    const host = await pool.player('Host');
    const state = await createRoom(host);
    assert.equal(state.canSetUniteLayerGains, false);
    await err(host, { t: 'room.setUniteLayerGains', on: true }, ERR.UNITE_LAYERS_LOCKED);
    const room = srv.lobby.rooms.get(state.code);
    assert.equal(room.uniteLayerGains, false);
    setAllowRoomUniteLayerGains(true);
    assert.equal(room.toState().canSetUniteLayerGains, true);
    await ok(host, { t: 'room.setUniteLayerGains', on: true });
    setAllowRoomUniteLayerGains(false);
    assert.equal(room.toState().canSetUniteLayerGains, false);
    await err(host, { t: 'room.setUniteLayerGains', on: false }, ERR.UNITE_LAYERS_LOCKED);
    assert.equal(room.uniteLayerGains, true, 'revocation never changes the selected rule');
  });
});

test('new co-op rooms default AI-last on; new solo rooms keep the irrelevant option off', () => {
  assert.equal(new Room('COOP', 'coop', 'NORMAL', Date.now()).aiPicksLast, true);
  assert.equal(new Room('SOLO', 'solo', 'NORMAL', Date.now()).aiPicksLast, false);
});

test('unite layers: boolean protocol, host defaults captured per room and explicit false survives worker transport', () => {
  try {
    for (const on of [true, false]) {
      assert.equal(validateC2S({ t: 'room.setUniteLayerGains', on }), null);
      assert.equal(wireOptions({ uniteLayerGains: on }).uniteLayerGains, on);
    }
    for (const on of [undefined, null, 0, 1, 'true', {}, []]) {
      assert.notEqual(validateC2S({ t: 'room.setUniteLayerGains', on }), null);
    }
    resetHostSettings();
    const off = new Room('AAAA', 'coop', 'NORMAL', 0);
    setUniteLayerGains(true);
    const on = new Room('BBBB', 'solo', 'NORMAL', 0);
    assert.equal(off.toState().uniteLayerGains, false);
    assert.equal(on.toState().uniteLayerGains, true);
    setUniteLayerGains(false);
    assert.equal(on.toState().uniteLayerGains, true, 'changing defaults never edits an existing room');
  } finally { resetHostSettings(); }
});
