import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeMatch } from './match/harness.js';
import { liveState, liveIntent } from '../server/admin-live.js';
import { startAdmin } from '../server/admin.js';
import { legalTiles } from '../server/match/board.js';

function fixture(t, opts = {}) {
  const h = makeMatch({ humans: 2, bots: 1, fake: true, clientCombat: true, clients: false, ...opts }).start().toPrep();
  t.after(() => h.m.dispose());
  const room = { code: 'TEST', match: h.m };
  return { h, room, lobby: { rooms: new Map([['TEST', room]]), safeData: () => ({}), onMatchEnd() {} } };
}
const command = (state, intent) => ({ room: 'TEST', playerId: state.playerId, matchId: state.matchId,
  revision: state.revision, round: state.public.round, phase: state.public.phase, intent });

test('host live view: private state, ordinary paid actions, stale-state rejection, player pushes and logs', (t) => {
  const { h, lobby, room } = fixture(t), ps = h.ps('p_0');
  ps.funds = 20;
  let state = liveState(lobby, { room: 'TEST', playerId: ps.playerId });
  assert.equal(state.private.funds, 20);
  assert.equal(state.battle, null);
  const funds = ps.funds, price = state.private.shop.refreshPrice;
  const body = command(state, { t: 'g.refresh' });
  assert.deepEqual(liveIntent(lobby, body), { ok: true });
  assert.equal(ps.funds, funds - price);
  assert.ok(h.sent.some(([pid, msg]) => pid === ps.playerId && msg.t === 'm.private' && msg.funds === ps.funds));
  assert.equal(room.adminLog.at(-1).action, '代操作 g.refresh');
  assert.equal(liveIntent(lobby, body).code, 'BAD_TARGET', 'repeat request cannot act on a changed shop');
  state = liveState(lobby, { room: 'TEST', playerId: ps.playerId });
  const slot = ps.shop.slots.findIndex((s) => s && !s.sold && s.kind === 'chess');
  assert.ok(slot >= 0);
  const buyPrice = state.private.shop.slots[slot].price;
  assert.deepEqual(liveIntent(lobby, command(state, { t: 'g.buy', slot })), { ok: true });
  assert.equal(ps.funds, funds - price - buyPrice);
  state = liveState(lobby, { room: 'TEST', playerId: ps.playerId });
  assert.equal(liveIntent(lobby, command(state, { t: 'g.buy', slot: -1 })).code, 'BAD_MSG');
  for (const type of ['b.result', 'b.progress', 'g.leave', 'room.start', 'g.watch']) {
    assert.equal(liveIntent(lobby, command(state, { t: type })).code, 'BAD_MSG');
  }
  assert.deepEqual(liveIntent(lobby, command(state, { t: 'g.ready', ready: true })), { ok: true });
  assert.equal(ps.ready, true);
  const bot = liveState(lobby, { room: 'TEST', playerId: 'ai_0' });
  assert.equal(bot.controllable, false);
  assert.equal(liveIntent(lobby, command(bot, { t: 'g.refresh' })).code, 'BAD_TARGET');
  h.m.ended = true;
  assert.equal(liveState(lobby, { room: 'TEST', playerId: ps.playerId }).code, 'WRONG_PHASE');
});

test('host live view: battle replica is non-authoritative, watch preferences and observers are untouched', (t) => {
  const { h, lobby } = fixture(t);
  h.m.startCombat();
  const watchers = [...h.m.watchers], authorities = h.m.fields.map((f) => f.authority);
  const state = liveState(lobby, { room: 'TEST', playerId: 'p_0' });
  assert.ok(state.battle?.spec);
  assert.equal(state.battle.authoritative, false);
  const unchanged = liveState(lobby, { room: 'TEST', playerId: 'p_0', matchId: state.matchId, battleId: state.battleId });
  assert.equal(unchanged.battle, null, 'spec is transmitted once per console battle');
  const other = liveState(lobby, { room: 'TEST', playerId: 'p_0', fieldId: 'n:p_1' });
  assert.equal(other.battle.fieldId, 'n:p_1');
  assert.equal(other.battle.authoritative, false);
  assert.deepEqual([...h.m.watchers], watchers);
  assert.deepEqual(h.m.fields.map((f) => f.authority), authorities);
  assert.equal(liveIntent(lobby, command(state, { t: 'g.refresh' })).code, 'WRONG_PHASE');
});

test('host ordinary controls: placement, equipment, ready/unready and drafting use the selected seat', (t) => {
  const { h, lobby } = fixture(t), ps = h.ps('p_0');
  ps.funds = 100;
  const run = (intent) => liveIntent(lobby, command(liveState(lobby, { room: 'TEST', playerId: ps.playerId }), intent));
  const slot = ps.shop.slots.findIndex((s) => s && s.kind === 'chess' && !s.sold);
  assert.equal(run({ t: 'g.buy', slot }).ok, true);
  const piece = ps.hand.find((p) => p?.kind === 'chess');
  const [row, col] = legalTiles(ps.deployMap(), ps._placementOf(piece))[0];
  assert.equal(run({ t: 'g.move', uid: piece.uid, to: { area: 'board', row, col }, dir: 'LEFT' }).ok, true);
  assert.equal(ps.find(piece.uid).area, 'board');
  assert.equal(ps.find(piece.uid).piece.dir, 'LEFT');
  assert.ok(ps.acquireItem('chess_item_5_07_e_a'));
  const item = ps.hand.find((p) => p?.kind === 'item');
  assert.equal(run({ t: 'g.equip', itemUid: item.uid, targetUid: piece.uid }).ok, true);
  assert.ok(piece.items.some((i) => i.uid === item.uid));
  assert.equal(run({ t: 'g.ready', ready: true }).ok, true);
  assert.equal(run({ t: 'g.ready', ready: false }).ok, true);
  assert.equal(ps.ready, false);
  h.m.round = 4;
  h.m.enterSpDraft();
  const picker = h.m.players.get(h.m.spTurn());
  const state = liveState(lobby, { room: 'TEST', playerId: picker.playerId });
  assert.equal(liveIntent(lobby, command(state, { t: 'g.choice', idx: h.m.sp.cards.find((c) => h.m.spCardAvailable(c)).idx })).ok, true);
  assert.ok(Object.hasOwn(h.m.sp.picks, picker.playerId));
});

test('host live API: token/cookie/Host protection, invalid players and guarded requests', async (t) => {
  const { lobby } = fixture(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-live-test-'));
  const admin = await startAdmin({ lobby, port: 0, resultsDir: path.join(dir, 'results'), replaysDir: path.join(dir, 'replays'),
    settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
  t.after(async () => { await admin.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const endpoint = '/api/live?room=TEST&playerId=p_0';
  assert.equal((await fetch(admin.url + endpoint)).status, 403);
  assert.equal((await fetch(admin.url + '/live', { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(admin.url + '/live?wall=1', { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(admin.url + '/live-viewer.js', { redirect: 'manual' })).status, 302);
  const home = await fetch(admin.url), cookie = home.headers.get('set-cookie').split(';')[0];
  const ordinary = await fetch(admin.url + '/live', { headers: { Cookie: cookie } });
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.headers.get('x-frame-options'), 'DENY');
  const embedded = await fetch(admin.url + '/live?wall=1', { headers: { Cookie: cookie } });
  assert.equal(embedded.status, 200);
  assert.equal(embedded.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(embedded.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal((await fetch(admin.url + '/live-viewer.js', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(admin.url + endpoint, { headers: { Cookie: cookie } })).status, 403);
  const auth = { 'X-Admin-Token': admin.token };
  const state = await (await fetch(admin.url + endpoint, { headers: auth })).json();
  assert.equal(state.ok, true);
  const result = await (await fetch(admin.url + '/api/live', { method: 'POST', headers: auth,
    body: JSON.stringify(command(state, { t: 'g.freeze' })) })).json();
  assert.equal(result.ok, true);
  const missing = await (await fetch(admin.url + '/api/live?room=TEST&playerId=missing', { headers: auth })).json();
  assert.equal(missing.code, 'BAD_TARGET');
  const stats = await (await fetch(admin.url + endpoint + '&statsSeq=5', { headers: auth })).json();
  assert.equal(stats.unitStats.seq, 5);
});
