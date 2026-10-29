// server/admin.js — the host's local console: localhost + token only, and its actions reach the running match.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { startAdmin, handleAction, roomsView, resultRecord, catalogView } from '../server/admin.js';
import { TestClient } from './helpers/wsClient.js';
import { makeMatch, checkInvariants } from './match/harness.js';
import { getPrep, setPrep, resetHostSettings, prepSeconds, prepSecondsFor, getUniteLayerGains } from '../server/match/hostSettings.js';
import { getAllowRoomUniteLayerGains } from '../server/match/hostSettings.js';
import { getSocialSettings } from '../server/match/hostSettings.js';
import { capturePrep, rewindToPrep } from '../server/match/rewind.js';
import { releaseFor, tag, until } from './helpers/release-fixture.js';

let srv = null;
let admin = null;
const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-results-'));

test('expanded host grants and forced equipment use the target player\'s fixed group', t => {
  const h = makeMatch({ humans: 8, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const m = h.m, a = h.ps('p_0'), b = h.ps('p_7');
  const lobby = { rooms: new Map([['TEST', { code: 'TEST', match: m }]]) };
  const id = 'chess_item_5_07_e_a';
  const act = (ps, value) => handleAction(lobby, { room: 'TEST', action: 'item', playerId: ps.playerId, value });
  for (let i = 0; i < m.itemPoolFor(a).cap(id); i++) assert.deepEqual(act(a, id), { ok: true });
  assert.equal(act(a, id).code, 'ITEM_STOCK_CONFIRM');
  assert.deepEqual(act(b, id), { ok: true }, 'a different group still has stock');
  for (let i = 1; i < m.itemPoolFor(b).cap(id); i++) assert.deepEqual(act(b, id), { ok: true });
  assert.equal(act(b, id).code, 'ITEM_STOCK_CONFIRM');
  assert.deepEqual(act(b, { id, force: true }), { ok: true });
  assert.equal(m.itemPoolFor(a).held(id), 2);
  assert.equal(m.itemPoolFor(b).held(id), 3);
  checkInvariants(m);
});
after(async () => { if (admin) await admin.close(); if (srv) await srv.close(); fs.rmSync(resultsDir, { recursive: true, force: true }); });

/** Raw request (fetch cannot forge a Host header). */
function req(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { s += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(s); } catch { /* html */ } resolve({ status: res.statusCode, json, text: s }); });
    });
    r.on('error', reject);
    if (body) r.end(JSON.stringify(body)); else r.end();
  });
}

test('console: localhost only, token required, actions change the running match', async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  admin = await startAdmin({ lobby: srv.lobby, port: 0, log: { info() {}, error() {} }, resultsDir, settingsFile: path.join(resultsDir, 'settings.json') });
  const P = admin.port;
  const auth = { 'x-admin-token': admin.token };

  // the page carries the token; the API refuses without it, and refuses a foreign Host (DNS rebinding)
  const page = await req(P, '/');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(admin.token) && !page.text.includes('__TOKEN__'));
  assert.equal((await req(P, '/api/rooms')).status, 403);
  assert.equal((await req(P, '/api/rooms', { headers: { ...auth, 'x-admin-token': 'f'.repeat(32) } })).status, 403);
  assert.equal((await req(P, '/api/rooms', { headers: { ...auth, host: 'evil.example' } })).status, 403);
  assert.equal((await req(P, '/', { headers: { host: `evil.example:${P}` } })).status, 403);
  assert.deepEqual((await req(P, '/api/rooms', { headers: auth })).json, { rooms: [], announcement: null });

  // a solo match through the real protocol
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  await c.hello('Host');
  assert.equal((await c.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' })).t, 'ok');
  const { code } = await c.waitFor('room.state');
  assert.equal((await c.request({ t: 'room.start' })).t, 'ok');
  await c.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
  const rooms = (await req(P, '/api/rooms', { headers: auth })).json.rooms;
  assert.equal(rooms.length, 1);
  const pid = rooms[0].match.players[0].id;
  assert.deepEqual(rooms[0].match.rewindRounds, [], 'no prep yet');

  const post = (body) => req(P, '/api/action', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body }).then((r) => r.json);
  assert.match((await post({ room: code, action: 'rewind' })).error, /快照/);
  assert.deepEqual(await post({ room: code, action: 'funds', playerId: pid, value: 25 }), { ok: true });
  assert.deepEqual(await post({ room: code, action: 'lp', playerId: pid, value: 7 }), { ok: true });
  assert.match((await post({ room: code, action: 'lp', playerId: pid, value: -1 })).error, /≥ 0/);
  assert.match((await post({ room: code, action: 'nope' })).error, /未知/);
  assert.match((await post({ room: 'ZZZZ', action: 'funds' })).error, /房间/);
  const m = srv.lobby.rooms.get(code).match;
  assert.equal(m.players.get(pid).funds, 25);
  assert.equal(m.players.get(pid).lp, 7);
  const priv = await c.waitFor('m.private', (msg) => msg.funds === 25);
  assert.equal(priv.funds, 25, 'the player sees the change at once');

  // grants come from the catalog of the match's mode
  const cat = (await req(P, `/api/catalog?room=${code}`, { headers: auth })).json;
  assert.ok(cat.chess.length > 50 && cat.items.length > 10);
  assert.deepEqual(await post({ room: code, action: 'chess', playerId: pid, value: cat.chess[0].id }), { ok: true });
  assert.ok(m.players.get(pid).allChess().some((p) => p.id === cat.chess[0].id));
  assert.match((await post({ room: code, action: 'chess', playerId: pid, value: 'chess_nope' })).error, /没有/);

  // the action log: every action on the room, failures included, with the player's name
  const log = (await req(P, '/api/rooms', { headers: auth })).json.rooms[0].log;
  assert.deepEqual(log.slice(0, 3).map((e) => [e.action, e.player, e.value, e.ok]), [['rewind', null, '', false], ['funds', 'Host', '25', true], ['lp', 'Host', '7', true]]);
  assert.ok(log.some((e) => e.action === 'nope' && !e.ok && /未知/.test(e.error)));

  assert.deepEqual(handleAction(srv.lobby, { room: code, action: 'endMatch' }), { ok: true });
  await c.waitFor('m.result');
  // the finished match is saved (startAdmin wraps lobby.onMatchEnd) and readable from the console only
  const { records } = (await req(P, '/api/results', { headers: auth })).json;
  assert.equal(records.length, 1);
  assert.equal(records[0].room, code);
  assert.equal(records[0].reason, 'admin');
  assert.deepEqual(records[0].players.map((p) => p.name), ['Host']);
  const rec = (await req(P, `/api/result?id=${encodeURIComponent(records[0].id)}`, { headers: auth })).json;
  assert.equal(rec.result.players[0].name, 'Host');
  assert.equal(rec.rules.adminModified, true);
  assert.equal(rec.ruleStatus, 'custom');
  assert.ok(Array.isArray(rec.history));
  assert.equal((await req(P, `/api/result?id=${encodeURIComponent('../package.json')}`, { headers: auth })).status, 404);
  assert.equal((await req(P, `/api/results`)).status, 403);
  assert.equal(srv.lobby.rooms.get(code).adminLog.at(-1).action, 'endMatch');
  // the room card keeps the ended match's statistics until the next match
  const back = (await req(P, '/api/rooms', { headers: auth })).json.rooms[0];
  assert.equal(back.match, null);
  assert.equal(back.lastMatch.id, records[0].id);
  assert.deepEqual(back.lastMatch.players.map((p) => p.name), ['Host']);
  assert.ok(Array.isArray(back.lastMatch.history) && typeof back.lastMatch.players[0].stats.buys === 'number');
  await c.close();
});

// ---- the second batch on harness matches (virtual clock), through the same handleAction / roomsView

test('console update API: token/Host required, validated actions, active-match confirmation and duplicate installs', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-admin-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.2.5"}');
  const lobby = { rooms: new Map([['TEST', { match: { ended: false, disposed: false } }]]), onMatchEnd() {} };
  let downloads = 0;
  const a = await startAdmin({ lobby, port: 0, root, resultsDir: root, settingsFile: path.join(root, 'settings.json'), onUpdateReady() {},
    updateOptions: { fetchImpl: async () => new Response(JSON.stringify([releaseFor()])),
      stageRelease: async () => { downloads++; throw new Error('测试下载失败'); } } });
  t.after(() => a.close());
  const auth = { 'x-admin-token': a.token };
  const post = (body, headers = auth) => req(a.port, '/api/update', { method: 'POST', headers, body });
  assert.equal((await req(a.port, '/api/update')).status, 403);
  assert.equal((await post({ action: 'check' }, {})).status, 403);
  assert.equal((await post({ action: 'open' }, {})).status, 403);
  assert.equal((await post({ action: 'network', network: { proxy: 'http://127.0.0.1:7890' } }, {})).status, 403);
  assert.equal((await post({ action: 'check' }, { ...auth, host: 'evil.example' })).status, 403);
  assert.equal((await req(a.port, '/api/update', { headers: auth })).json.state, 'idle');
  assert.equal((await post({ action: 'unknown' })).status, 400);
  assert.equal((await post([])).status, 400);
  assert.equal((await post({ action: 'network', network: { proxy: '', mirror: '' } })).json.saved, true);
  assert.equal((await post({ action: 'open' })).json.notify, true);
  assert.equal((await post({ action: 'open' })).json.notify, undefined);
  assert.equal((await post({ action: 'check' })).json.state, 'available');
  assert.equal((await post({ action: 'install', tag, force: 'true' })).json.state, 'active-matches');
  assert.equal(downloads, 0);
  await post({ action: 'install', tag, force: true });
  await until(() => downloads === 1);
  assert.equal(downloads, 1);
  const state = (await req(a.port, '/api/update', { headers: auth })).json;
  assert.equal(state.state, 'error'); assert.match(state.error, /下载失败/);
});

/** A lobby stand-in holding one harness match as room TEST. */
function harness(o) {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, ...o }).start().autoHumans();
  const lobby = { rooms: new Map([['TEST', { code: 'TEST', mode: 'coop', difficulty: 'NORMAL', seats: [], match: h.m }]]) };
  h.act = (action, value, playerId = 'p_0') => handleAction(lobby, { room: 'TEST', action, playerId, value });
  h.view = (pid = 'p_0') => roomsView(lobby)[0].match.players.find((p) => p.id === pid);
  h.matchView = () => roomsView(lobby)[0].match;
  return h;
}

test('console item stock: confirmation, forced merge, occupancy, removal and rewind', t => {
  const h = makeMatch({ humans: 1, seed: 11, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const m = h.m, ps = h.ps('p_0'), id = 'chess_item_5_07_e_a';
  ps.bandId = null;
  const lobby = { rooms: new Map([['TEST', { code: 'TEST', match: m }]]) };
  const act = value => handleAction(lobby, { room: 'TEST', action: 'item', playerId: ps.playerId, value });
  assert.equal(m.itemPool.cap(id), 2);
  assert.deepEqual(act(id), { ok: true });
  assert.deepEqual(act(id), { ok: true });
  const funds = ps.funds;
  const confirmation = act(id);
  assert.equal(confirmation.code, 'ITEM_STOCK_CONFIRM');
  assert.match(confirmation.error, /库存不足/);
  assert.equal(m.itemPool.held(id), 2, 'unconfirmed action changes nothing');
  assert.equal(act({ id, force: 'true' }).code, 'ITEM_STOCK_CONFIRM', 'only explicit boolean confirmation works');
  m.prepSnapshots.set(m.round, capturePrep(m));
  const round = m.round;
  assert.deepEqual(act({ id, force: true }), { ok: true });
  assert.equal(m.itemPool.held(id), 3);
  assert.equal(m.itemPool.left(id), 0);
  assert.equal(ps.acquireItem(id), null, 'ordinary grants keep their stock gate');
  assert.deepEqual(act({ id, force: true }), { ok: true });
  assert.equal(m.itemPool.held(id), 4);
  const forced = ps.hand.find(p => p?.adminStockCopies);
  assert.equal(forced.id, m.gd.item(id).goldenId);
  assert.equal(forced.adminStockCopies, 2, 'merge preserves the two authorized copies');
  assert.equal(ps.funds, funds);
  checkInvariants(m);
  m.round = round + 1;
  m.prepSnapshots.set(m.round, capturePrep(m));
  assert.deepEqual(handleAction(lobby, { room: 'TEST', action: 'pieceRemove', playerId: ps.playerId, value: forced.uid }), { ok: true });
  assert.equal(m.itemPool.held(id), 2);
  assert.deepEqual(rewindToPrep(m, round + 1), { ok: true, round: round + 1 });
  assert.equal(m.itemPool.held(id), 4, 'snapshot restores forced pieces and markers');
  checkInvariants(m);
  assert.deepEqual(rewindToPrep(m, round), { ok: true, round });
  assert.equal(m.itemPool.held(id), 2, 'earlier snapshot removes overrides');
  assert.ok(ps.hand.filter(Boolean).every(p => !p.adminStockCopies));
  assert.match(act({ id: 'missing', force: true }).error, /没有这个道具/);
  const owner = ps.acquireChess(m.gd.visibleChess.find(id => m.gd.tierOf(id) === 1));
  assert.ok(owner);
  const equip = value => handleAction(lobby, { room: 'TEST', action: 'pieceEquip', playerId: ps.playerId, value });
  const before = owner.items.length;
  assert.equal(equip({ target: owner.uid, item: id }).code, 'ITEM_STOCK_CONFIRM');
  assert.equal(owner.items.length, before);
  assert.deepEqual(equip({ target: owner.uid, item: id, force: true }), { ok: true });
  assert.equal(owner.items.at(-1).adminStockCopies, 1);
  assert.equal(m.itemPool.held(id), 3, 'direct equipment occupies shared stock');
  checkInvariants(m);
  assert.deepEqual(equip({ target: owner.uid, item: id, force: true }), { ok: true });
  assert.equal(m.itemPool.held(id), 4);
  assert.ok(ps.hand.some(p => p?.adminStockCopies === 2), 'an equipped forced twin merges with its incoming copy');
  checkInvariants(m);
  // Upstream 0.3.0 expands temporary storage rather than refusing a confirmed grant.
  while (ps.hand.some(p => !p)) ps.acquireItem('chess_item_6_09_e_a', { requirePool: false });
  const heldBefore = m.itemPool.held(id);
  assert.deepEqual(act({ id, force: true }), { ok: true });
  assert.equal(m.itemPool.held(id), heldBefore + 1);
  checkInvariants(m);
});

test('console: bond layers (add / set) and count bonus', () => {
  const h = harness({ seed: 11 });
  const m = h.m;
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: false });
  const ps = m.players.get('p_0');
  const bond = m.gd.bondIds.find((id) => !m.gd.modeInactiveBonds.has(id));
  let fired = 0;
  const dispatch = m.dispatch.bind(m);
  m.dispatch = (p, hook, ...rest) => { if (hook === 'onLayers') fired++; return dispatch(p, hook, ...rest); };

  const before = ps.layers[bond] || 0;
  assert.deepEqual(h.act('bondAdd', { bond, n: 3 }), { ok: true });
  assert.equal(ps.layers[bond], before + 3);
  assert.equal(fired, 1, 'add goes through addLayers (onLayers)');
  assert.deepEqual(h.act('bondSet', { bond, n: 999 }), { ok: true });
  assert.equal(fired, 1, 'set dispatches nothing');
  assert.match(h.act('bondAdd', { bond, n: 1 }).error, /上限/);
  assert.match(h.act('bondSet', { bond, n: 1000 }).error, /0–999/);
  assert.deepEqual(h.act('bondSet', { bond, n: 0 }), { ok: true });
  assert.equal(ps.layers[bond], 0);

  assert.ok(!ps.bonds[bond].active);
  assert.deepEqual(h.act('bondBonus', { bond, n: m.gd.bond(bond).thresholds[0] }), { ok: true });
  assert.ok(ps.bonds[bond].active, 'the bonus alone activates it');
  const row = h.view().bonds.find((b) => b.id === bond);
  assert.equal(row.bonus, m.gd.bond(bond).thresholds[0]);
  assert.equal(row.active, true);
  assert.deepEqual(h.act('bondBonus', { bond, n: 0 }), { ok: true });
  assert.ok(!(bond in ps.bondCountBonus));
  assert.match(h.act('bondAdd', { bond: 'nope', n: 1 }).error, /盟约/);
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  m.dispose();
});

test('console: 托管, 机变 cards, effects and bounties', () => {
  const h = harness({ seed: 12 });
  const m = h.m;
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: false });
  const ps = m.players.get('p_0');
  const bot = m.players.get('ai_0');

  ps.autoplay = false;
  assert.deepEqual(h.act('autoplay', 1), { ok: true });
  assert.equal(m.publicView().players.find((p) => p.playerId === 'p_0').autoplay, true, 'the player sees it');
  assert.deepEqual(h.act('autoplay', 0), { ok: true });
  assert.equal(ps.autoplay, false);
  assert.match(h.act('autoplay', 1, 'ai_0').error, /AI/);

  // a team tactic card (全队 +资金) reaches the teammate too
  const funds = [ps.funds, bot.funds];
  assert.deepEqual(h.act('card', 'allybuff_select_3'), { ok: true });
  assert.ok(ps.funds > funds[0] && bot.funds > funds[1], 'applied to both');
  // a battle tactic card leaves an effect, which can be removed
  const n0 = ps.effects.length;
  assert.deepEqual(h.act('card', 'enemydebuff_select_1'), { ok: true });
  assert.equal(ps.effects.length, n0 + 1);
  const eff = ps.effects[ps.effects.length - 1];
  assert.ok(h.view().effects.some((e) => e.id === eff.id));
  assert.deepEqual(h.act('effectRemove', eff.id), { ok: true });
  assert.ok(!ps.effects.some((e) => e.id === eff.id));
  assert.match(h.act('effectRemove', eff.id).error, /不存在/);
  // a bounty card adds its enemies to the preview; removing it takes them out
  const bounty = m.gd.choices.cards.bounty.find((c) => m.gd.enemy(c.enemyKey));
  assert.deepEqual(h.act('card', bounty.effectId), { ok: true });
  assert.ok(h.view().enemies.some((e) => e.bounty), 'bounty enemies previewed');
  assert.deepEqual(h.act('bountyRemove', ps.bounties[ps.bounties.length - 1].id), { ok: true });
  assert.ok(!h.view().enemies.some((e) => e.bounty));
  assert.match(h.act('card', 'nope').error, /机变卡/);
  checkInvariants(m);
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  m.dispose();
});

test("console: board edits whatever the phase, and the current round's enemies before combat only", () => {
  const h = harness({ seed: 13 });
  const m = h.m;
  const gd = m.gd;
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: false });
  const ps = m.players.get('p_0');

  const cid = gd.visibleChess.find((id) => !gd.isGolden(id) && gd.goldenIdOf(id) && m.pool.left(gd.baseIdOf(id)) >= gd.goldenCopies + 1);
  const piece = ps.acquireChess(cid);
  assert.ok(piece && h.view().pieces.some((p) => p.uid === piece.uid && p.canPromote));
  const base = gd.baseIdOf(cid);
  const left0 = m.pool.left(base);
  assert.deepEqual(h.act('piecePromote', piece.uid), { ok: true });
  assert.ok(gd.isGolden(piece.id));
  assert.match(h.act('piecePromote', piece.uid).error, /精锐/);

  const equipId = Object.values(gd.shopItemsByTier).flat().find((id) => gd.item(id).itemType === 'EQUIP'
    && !String(gd.item(id).kind || '').startsWith('consume_on_equip') && !ps._itemLocations(id).length);
  m.phase = 'COMBAT'; // equip() refuses outside the prep; the console does not
  assert.deepEqual(h.act('pieceEquip', { target: piece.uid, item: equipId }), { ok: true });
  m.phase = 'PREP';
  assert.ok(piece.items.some((it) => it.id === equipId));
  assert.match(h.act('pieceEquip', { target: piece.uid, item: 'nope' }).error, /装备/);

  const funds = ps.funds;
  assert.deepEqual(h.act('pieceRemove', piece.uid), { ok: true });
  assert.equal(ps.find(piece.uid), null);
  assert.equal(ps.funds, funds, 'no sell price');
  assert.ok(m.pool.left(base) > left0 - gd.goldenCopies, 'its copies are back in the pool');
  assert.ok([...ps.hand, ...ps.temp].some((p) => p && p.id === equipId), 'its item went to the hand');
  assert.match(h.act('pieceRemove', 999999).error, /不存在/);

  // the current round's enemies: any composition before combat, rebuilt at once; none once the combat started
  const plan = h.matchView().enemyPlan;
  const row = plan.rounds.find((r) => r.round === m.round);
  assert.equal(row.editable, true);
  const other = plan.lists[row.half].find((c) => c.id !== row.current && c.allowed);
  assert.deepEqual(h.act('enemyPick', { round: m.round, id: other.id }), { ok: true });
  assert.equal(m.wave.pick.key, other.key);
  assert.ok(m.wave.spawns.length > 0);
  checkInvariants(m);
  h.drive(() => m.phase === 'COMBAT');
  assert.equal(h.matchView().enemyPlan.rounds.find((r) => r.round === m.round).editable, false);
  assert.match(h.act('enemyPick', { round: m.round, id: other.id }).error, /战斗已经开始/);
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  m.dispose();
});

test('console: forcing a client-side battle — a win keeps the LP, a loss costs min(10, n)', () => {
  for (const [win, n, loss] of [[true, 0, 0], [false, 3, 3], [false, 25, 10]]) {
    const h = harness({ mode: 'solo', bots: 0, seed: 21, clientCombat: true, clients: false });
    const m = h.m;
    h.drive(() => m.phase === 'COMBAT' && m.round === 2);
    const ps = m.players.get('p_0');
    const lp = ps.lp;
    const f = h.matchView().fields[0];
    assert.ok(f && f.kind === 'normal', 'a running field is listed');
    const before = h.sent.length;
    assert.deepEqual(h.act(win ? 'battleWin' : 'battleLose', { field: f.id, n }), { ok: true });
    assert.ok(h.sent.slice(before).some(([pid, msg]) => pid === 'p_0' && msg.t === 'b.end' && msg.reason === 'forced'), 'the browser is told');
    assert.match(h.act('battleWin', { field: f.id }).error, /战场不存在|已经结束/);
    h.run(() => m.phase === 'SETTLE');
    assert.equal(m.phase, 'SETTLE');
    assert.equal(ps.lp, lp - loss);
    assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
    m.dispose();
  }
  const h = harness({ mode: 'solo', bots: 0, seed: 21, clientCombat: true, clients: false });
  h.drive(() => h.m.phase === 'COMBAT');
  assert.match(h.act('battleLose', { field: h.matchView().fields[0].id, n: 0 }).error, /漏怪数/);
  assert.deepEqual(h.act('timerScale', 0.5), { ok: true });
  assert.deepEqual(h.m.prepOverride, { mode: 'scale', scale: 0.5 });
  assert.equal(h.m.timerScale, 1, 'the console leaves all other phase timers unchanged');
  assert.match(h.act('timerScale', 0).error, /0.1–10/);
  h.m.dispose();
});


test('console (0.2.0): a 自选编队 piece is listed under its picked operator', () => {
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true,
    diy: { chess_char_5_diy1_a: { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' } } },
  { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true }];
  const h = harness({ seats, seed: 11 });
  const m = h.m;
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: false });
  const ps = m.players.get('p_0');
  const piece = ps.acquireChess('chess_char_5_diy1_a');
  assert.ok(piece);
  assert.equal(h.view().pieces.find((p) => p.uid === piece.uid).name, ps.gd.chess('chess_char_5_diy1_a').name);
  assert.notEqual(ps.gd.chess('chess_char_5_diy1_a').name, m.gd.chess('chess_char_5_diy1_a').name);
  assert.deepEqual(h.act('pieceRemove', piece.uid), { ok: true });
  assert.deepEqual(ps.diyStock.snapshot(), { chess_char_5_diy1_a: 16 }, 'its copy went back to the player\'s own stock');
  checkInvariants(m);
  m.dispose();
});

test('console (0.2.3): rerolled setup supports new and collab DIY grants, modules and rewind', () => {
  const h = harness({ seed: 11, fake: true });
  const m = h.m;
  const ps = m.players.get('p_0');
  assert.equal(m.phase, 'INFO_CHECK');
  assert.deepEqual(m.requestSetupReroll(ps.playerId, 0), { ok: true });
  assert.equal(m.setupRevision, 1);
  h.drive(() => m.phase === 'PREP' && m.round === 1, { ready: false });
  const cat = catalogView({ rooms: new Map([['TEST', { match: m }]]) }, 'TEST');
  const clemnt = cat.diy.find((p) => p.charId === 'char_4231_clemnt' && p.tier === 6);
  assert.deepEqual(clemnt.skills.map((s) => s.index), [0, 1, 2]);
  assert.ok(cat.diy.find((p) => p.charId === 'char_2025_shu' && p.tier === 6).modules.some((p) => p.id === 'uniequip_003_shu'));
  assert.ok(m.gd.raw.chess.chess_char_5_05_b.modules.some((p) => p.uniEquipId === 'uniequip_003_ulpia'));
  const grant = { charId: clemnt.charId, tier: 6, skillIndex: 1 };
  assert.deepEqual(h.act('diy', grant), { ok: true });
  assert.deepEqual(h.act('diy', { charId: 'char_456_ash', tier: 6, skillIndex: 2 }), { ok: true });
  const slot = Object.keys(ps.diy).find((id) => ps.diy[id].charId === clemnt.charId);
  assert.equal(ps.gd.chess(slot).skill.index, 1);
  assert.deepEqual(h.act('diySkill', { ...grant, skillIndex: 2 }), { ok: true });
  assert.equal(ps.gd.chess(slot).skill.index, 2);
  assert.deepEqual(h.act('rewind', 1), { ok: true, round: 1 });
  assert.equal(m.setupRevision, 1, 'the rerolled opening stays');
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  checkInvariants(m);
  m.dispose();
});

test('console (local-tools): any 自选 operator to anyone — a slot of the tier is filled, at most 2 per tier at a time', () => {
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
    { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true }];
  const h = harness({ seats, seed: 12 });
  const m = h.m;
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: false });
  const ps = m.players.get('p_0');
  const ZILAN = 'char_1048_orchd2', SIEGE = 'char_112_siege', W = 'char_113_cqbw';
  const owned = (id) => [...ps.hand, ...ps.temp, ...ps.board.values()].filter((p) => p && ps.gd.chess(p.id)?.charId === id);
  // the catalog lists every kitted operator at both tiers
  const cat = catalogView({ rooms: new Map([['R', { match: m }]]) }, 'R');
  assert.ok(cat.diy.some((x) => x.charId === ZILAN && x.tier === 5) && cat.diy.some((x) => x.charId === ZILAN && x.tier === 6));
  // no picks: 梓兰 takes a tier-6 slot, the elite form comes, from her own stock
  assert.deepEqual(h.act('diy', { charId: ZILAN, tier: 6, elite: true }), { ok: true });
  assert.equal(owned(ZILAN).length, 1);
  assert.ok(ps.gd.chess(owned(ZILAN)[0].id).isGolden && ps.gd.chess(owned(ZILAN)[0].id).diyFor);
  const slot = Object.keys(ps.diy).find((id) => ps.diy[id].charId === ZILAN);
  assert.equal(m.gd.tierOf(slot), 6);
  assert.equal(ps.diyStock.left(slot), ps.diyStock.cap(slot) - m.gd.goldenCopies);
  // again: the same slot; the second tier-6 slot takes 推进之王; a third operator finds both slots in use
  assert.deepEqual(h.act('diy', { charId: ZILAN, tier: 6 }), { ok: true });
  assert.equal(Object.values(ps.diy).filter((p) => p.charId === ZILAN).length, 1);
  assert.deepEqual(h.act('diy', { charId: SIEGE, tier: 6 }), { ok: true });
  assert.match(h.act('diy', { charId: W, tier: 6 }).error, /两个自选位/);
  // an owned operator fills one slot: 推进之王 cannot also go to tier 5 while on the board
  assert.match(h.act('diy', { charId: SIEGE, tier: 5 }).error, /已在 6 阶/);
  // once 推进之王's pieces are gone, her slot is free for W
  for (const p of owned(SIEGE)) assert.deepEqual(h.act('pieceRemove', p.uid), { ok: true });
  assert.deepEqual(h.act('diy', { charId: W, tier: 6 }), { ok: true });
  assert.ok(!Object.values(ps.diy).some((p) => p.charId === SIEGE) && owned(W).length === 1);
  // a bot too; unknown operators are refused
  const bot = m.players.get('ai_0');
  assert.deepEqual(h.act('diy', { charId: ZILAN, tier: 5 }, 'ai_0'), { ok: true });
  assert.equal(bot.gd.chess(Object.keys(bot.diy)[0]).charId, ZILAN);
  assert.match(h.act('diy', { charId: 'char_999_nobody', tier: 5 }).error, /没有这个自选干员/);
  assert.match(h.act('chess', 'chess_char_5_diy2_a').error, /发放自选/);
  // the skill and module: given at the grant (W, tier 5), then changed in place for the slot's pieces (diySkill)
  const wc = cat.diy.find((x) => x.charId === W && x.tier === 5);
  const zl = cat.diy.find((x) => x.charId === ZILAN && x.tier === 5);
  assert.deepEqual([zl.skills.map((x) => x.index), zl.modules.map((x) => x.type), zl.def, zl.locked], [[0, 1, 2], ['ARC-X'], { charId: ZILAN, skillIndex: 2, uniEquipId: 'uniequip_002_orchd2' }, null]);
  for (const p of owned(W)) assert.deepEqual(h.act('pieceRemove', p.uid), { ok: true });
  assert.deepEqual(h.act('diy', { charId: W, tier: 5, skillIndex: 0, uniEquipId: 'none' }), { ok: true });
  const w5 = Object.keys(ps.diy).find((id) => ps.diy[id].charId === W);
  assert.deepEqual([m.gd.tierOf(w5), ps.diy[w5].skillIndex, ps.diy[w5].uniEquipId], [5, 0, null]);
  assert.equal(ps.gd.chess(w5).skill.index, 0);
  const wPiece = owned(W)[0];
  assert.deepEqual(h.act('diySkill', { charId: W, tier: 5, skillIndex: 1, uniEquipId: wc.modules[0].id }), { ok: true });
  assert.deepEqual([ps.diy[w5].skillIndex, ps.diy[w5].uniEquipId, ps.gd.chess(wPiece.id).skill.index], [1, wc.modules[0].id, 1], 'the piece follows its slot');
  assert.equal(owned(W).length, 1, 'diySkill grants nothing');
  assert.match(h.act('diySkill', { charId: W, tier: 5, skillIndex: 7 }).error, /无效/);
  assert.match(h.act('diySkill', { charId: SIEGE, tier: 5, skillIndex: 0 }).error, /没有这名干员/);
  checkInvariants(m);
  assert.ok(h.drive(() => h.ended != null));
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  m.dispose();
});

test('console statistics: the per-round record, running totals and the saved result record', () => {
  const h = harness({ seed: 13 });
  const m = h.m;
  h.drive(() => m.phase === 'PREP' && m.round === 4, { ready: false });
  const view = h.matchView();
  assert.deepEqual(view.history.map((e) => e.round), [1, 2, 3], 'one entry per settled round');
  const ps = m.players.get('ai_0');
  const last = view.history[2].players.find((p) => p.playerId === 'ai_0');
  assert.equal(last.lp, ps.lp);
  assert.equal(last.spent, ps.stats.gold);
  assert.equal(last.dmg, Math.round(ps.stats.dmgDealt));
  assert.equal(view.history.reduce((n, e) => n + e.players.find((p) => p.playerId === 'ai_0').loss, 0), ps.stats.lpLost, 'the per-round losses add up');
  assert.ok(last.units.every((u, i, a) => typeof u.name === 'string' && u.dmg > 0 && (i === 0 || a[i - 1].dmg >= u.dmg)), 'units, most damage first');
  const stats = h.view('ai_0').stats;
  assert.equal(stats.kills, ps.stats.kills);
  assert.equal(stats.dmgDealt, Math.round(ps.stats.dmgDealt));

  // the record the console saves at the end: names resolved, history attached
  assert.ok(h.drive(() => h.ended != null));
  const room = { code: 'TEST', mode: 'coop', difficulty: 'NORMAL' };
  const rec = resultRecord(room, m, (({ t, ...s }) => s)(m.lastResultMsg));
  assert.equal(rec.history.at(-1).round, m.round, 'the last round is recorded even without a SETTLE');
  for (const p of rec.result.players) {
    assert.ok(p.lineup.every((u) => typeof u.name === 'string' && !u.name.startsWith('chess_')), 'lineup names');
    assert.ok(p.bonds.every((b) => typeof b.name === 'string'));
    assert.equal(typeof p.stats.buys, 'number', 'the console totals ride along');
  }
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  m.dispose();
});

test('console: the enemy schedule — every composition per round, the possible ones marked, later rounds overridable, rewind restores', () => {
  const h = harness({ seed: 14 });
  const m = h.m;
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: false });
  const { lists, rounds } = h.matchView().enemyPlan;
  const sched = m.factions.schedule;
  assert.equal(rounds.length, Math.max(m.gd.bossRound, m.gd.hiddenRound || 0));
  for (const r of rounds) {
    const list = lists[r.half];
    assert.equal(r.half, r.round <= 7 ? 'first' : 'second');
    assert.equal(r.original, `${sched.picks[r.round].key}|${sched.picks[r.round].normal || ''}|${sched.picks[r.round].elite || ''}`);
    assert.ok(list.some((c) => c.id === r.original), `R${r.round}: the drawn composition is in the list`);
    assert.ok(r.chance[r.original] > 0, `R${r.round}: and has a chance`);
    const sum = Object.values(r.chance).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `R${r.round}: chances add up to 1`);
    // only the round's own type, allowed by the mode, has a chance; impossible compositions are still listed
    for (const id of Object.keys(r.chance)) { const c = list.find((x) => x.id === id); assert.ok(c.allowed && c.inMatch); }
    assert.ok(list.length > Object.keys(r.chance).length);
    assert.equal(r.editable, r.round >= 2);
  }
  assert.ok(lists.first.some((c) => !c.inMatch) && lists.second.some((c) => !c.allowed), 'other types and disabled entries are listed too');
  // what each round really spawns: the template decides (R1–R3 have no special slot, a leader round only escorts)
  assert.ok(rounds.every((r) => r.roster.length > 0 && r.roster.every((e) => e.count > 0)));
  for (const r of rounds.filter((x) => x.round <= 3)) {
    const c = lists.first.find((x) => x.id === r.current);
    if (c.special !== c.normalName && c.special !== c.eliteName) assert.ok(!r.roster.some((e) => e.name === c.special), `R${r.round}: no special slot`);
  }
  assert.ok(rounds.find((r) => r.kind === 'boss').roster.some((e) => e.boss), 'the leader is listed');

  // a later round: an impossible composition is fine, it applies when the round starts and the history names it
  const target = lists.second.find((c) => c.allowed && !c.inMatch);
  assert.deepEqual(h.act('enemyPick', { round: 9, id: target.id }), { ok: true });
  assert.equal(h.matchView().enemyPlan.rounds.find((r) => r.round === 9).overridden, true);
  assert.match(h.act('enemyPick', { round: 1, id: target.id }).error, /过去/);
  assert.match(h.act('enemyPick', { round: 9, id: 'nope|x|y' }).error, /没有这个组合/);
  assert.match(h.act('enemyPick', { round: 3, id: target.id }).error, /前半/, "a second-half composition is not a first-half round's");
  h.drive(() => m.phase === 'PREP' && m.round === 4, { ready: false });
  h.drive(() => m.phase === 'PREP' && m.round === 9);
  assert.equal(m.wave.pick.key, target.key);
  assert.equal(`${m.wave.pick.key}|${m.wave.pick.normal || ''}|${m.wave.pick.elite || ''}`, target.id, 'the whole composition');
  h.drive(() => m.phase === 'PREP' && m.round === 10);
  assert.equal(m.history.find((e) => e.round === 9).enemy.special, target.special);
  assert.equal(m.history.find((e) => e.round === 9).enemy.overridden, true);

  // clearing goes back to the match's own pick; a rewind to before the override brings the round back too
  assert.deepEqual(h.act('enemyPick', { round: 12, id: target.id }), { ok: true });
  assert.deepEqual(h.act('rewind', 4), { ok: true, round: 4 });
  assert.deepEqual(Object.keys(m.adminPicks), ['9'], "the R12 override came after R4's prep, so it is gone");
  assert.deepEqual(h.act('enemyPick', { round: 9, id: '' }), { ok: true });
  assert.deepEqual(m.adminPicks, {});
  h.drive(() => m.phase === 'PREP' && m.round === 9);
  assert.equal(m.wave.pick.key, sched.picks[9].key);
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  m.dispose();
});

test('console room prep: inherit, replace, reset, validation, phase isolation and rewind', t => {
  resetHostSettings();
  t.after(resetHostSettings);
  const h = harness({ humans: 2, bots: 0, fake: true, seed: 15 });
  const other = harness({ humans: 2, bots: 0, fake: true, seed: 16 });
  t.after(() => { h.m.dispose(); other.m.dispose(); });
  const m = h.m;
  const next = round => {
    assert.ok(h.drive(() => m.phase === 'PREP' && m.round === round, { ready: false }));
    return m.deadline ? m.deadline - m.sched.now() : null;
  };
  setPrep({ mode: 'scale', scale: 2 });
  assert.equal(h.matchView().prepInherited, true);
  assert.deepEqual(h.matchView().prep, getPrep());
  assert.equal(next(1), m.gd.prepTime(1) * 2000);
  const originalDeadline = m.deadline;
  assert.deepEqual(h.act('prepTimer', { mode: 'scale', scale: 1.5 }), { ok: true });
  assert.equal(m.deadline, originalDeadline, 'current prep deadline is preserved');
  assert.equal(m.timerScale, 1, 'all other phases keep their original timing');
  assert.equal(m.scaled(25), 25);
  assert.equal(h.matchView().prepInherited, false);
  assert.equal(other.matchView().prepInherited, true, 'override is confined to one room');
  assert.equal(next(2), Math.round(m.gd.prepTime(2) * 1.5) * 1000, 'global scale is replaced, not multiplied');
  const snapRound = m.round;
  assert.deepEqual(h.act('prepTimer', { mode: 'fixed', seconds: 35 }), { ok: true });
  setPrep({ mode: 'fixed', seconds: 70 });
  assert.equal(prepSeconds(other.m, 95), 70, 'inheriting room sees future settings');
  assert.equal(next(3), 35000);
  assert.deepEqual(h.act('prepTimer', { mode: 'perRound', rounds: { 4: 45 } }), { ok: true });
  assert.equal(next(4), 45000);
  assert.equal(next(5), m.gd.prepTime(5) * 1000, 'unlisted round uses game data');
  const before = structuredClone(m.prepOverride);
  for (const value of [{ mode: 'fixed', seconds: 1 }, { mode: 'scale', scale: 20 }, { mode: 'perRound', rounds: { 31: 50 } }, { mode: 'invalid' }]) {
    assert.ok(h.act('prepTimer', value).error);
    assert.deepEqual(m.prepOverride, before);
  }
  assert.deepEqual(h.act('prepTimer', { mode: 'untimed' }), { ok: true });
  assert.equal(next(6), null);
  assert.deepEqual(h.act('prepTimer', null), { ok: true });
  assert.equal(h.matchView().prepInherited, true);
  assert.equal(next(7), 70000);
  assert.deepEqual(h.act('timerScale', 0.5), { ok: true }, 'legacy action now only configures prep');
  assert.equal(m.timerScale, 1);
  assert.equal(next(8), Math.round(m.gd.prepTime(8) * 0.5) * 1000);
  assert.deepEqual(h.act('rewind', snapRound), { ok: true, round: snapRound });
  assert.deepEqual(m.prepOverride, { mode: 'scale', scale: 1.5 });
  assert.equal(m.deadline - m.sched.now(), Math.round(m.gd.prepTime(snapRound) * 1.5) * 1000);
  assert.deepEqual(h.act('rewind', 1), { ok: true, round: 1 });
  assert.equal(m.prepOverride, null, 'earlier snapshot restores inheritance');
  assert.equal(m.deadline - m.sched.now(), 70000, 'inheritance uses current standing setting');
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
});

test('console settings: the 休整期 timer of every timed match, kept in a file across restarts', async () => {
  try {
    // the rules
    assert.equal(prepSecondsFor(4, 95, { mode: 'default' }), 95);
    assert.equal(prepSecondsFor(4, 95, { mode: 'scale', scale: 1.5 }), 143);
    assert.equal(prepSecondsFor(4, 95, { mode: 'fixed', seconds: 30 }), 30);
    assert.equal(prepSecondsFor(4, 95, { mode: 'perRound', rounds: { 4: 200 } }), 200);
    assert.equal(prepSecondsFor(5, 95, { mode: 'perRound', rounds: { 4: 200 } }), 95);
    assert.equal(prepSecondsFor(4, 95, { mode: 'untimed' }), null);
    assert.equal(prepSecondsFor(4, null, { mode: 'fixed', seconds: 30 }), null, 'an untimed prep stays untimed');
    assert.match(setPrep({ mode: 'fixed', seconds: 2 }).error, /5–3600/);
    assert.match(setPrep({ mode: 'scale', scale: 20 }).error, /0.1–10/);
    assert.match(setPrep({ mode: 'perRound', rounds: { 3: 1 } }).error, /第 3 回合/);
    assert.match(setPrep({ mode: 'nope' }).error, /未知/);
    assert.deepEqual(getPrep(), { mode: 'default' });

    // A timed match: standing settings apply next prep; the internal developer speed remains available to tests.
    const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 15 }).start().autoHumans();
    const m = h.m;
    const left = () => m.deadline - m.sched.now();
    h.drive(() => m.phase === 'PREP' && m.round === 1, { ready: false });
    assert.equal(left(), m.gd.prepTime(1) * 1000);
    assert.deepEqual(setPrep({ mode: 'fixed', seconds: 30 }), { ok: true });
    assert.equal(left(), m.gd.prepTime(1) * 1000, 'the running prep keeps its deadline');
    h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: false });
    assert.equal(left(), 30000);
    setPrep({ mode: 'scale', scale: 2 });
    m.timerScale = 0.5;
    h.drive(() => m.phase === 'PREP' && m.round === 3, { ready: false });
    assert.equal(left(), m.gd.prepTime(3) * 2 * 1000 * 0.5);
    m.timerScale = 1;
    setPrep({ mode: 'untimed' });
    h.drive(() => m.phase === 'PREP' && m.round === 4, { ready: false });
    assert.equal(m.deadline, 0, 'no countdown');
    assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
    m.dispose();

    // the console: GET / POST /api/settings, the file, and a restart reading it back
    const file = path.join(resultsDir, 'settings2.json');
    const lobby = { rooms: new Map(), onMatchEnd() {}, safeData: () => srv.lobby.safeData() };
    let a = await startAdmin({ lobby, port: 0, log: { info() {}, error() {} }, resultsDir, settingsFile: file });
    const auth = { 'x-admin-token': a.token, 'content-type': 'application/json' };
    resetHostSettings();
    const got = (await req(a.port, '/api/settings', { headers: auth })).json;
    assert.deepEqual(got.prep, { mode: 'default' });
    assert.ok(got.defaults.length >= 1 && got.defaults.every((d) => d.rounds.length >= 13 && d.rounds[0] > 0), 'the timed modes and their timers');
    const post = (prep) => req(a.port, '/api/settings', { method: 'POST', headers: auth, body: { prep } }).then((r) => r.json);
    assert.match((await post({ mode: 'fixed', seconds: 1 })).error, /5–3600/);
    assert.equal(fs.existsSync(file), false, 'nothing written for a bad setting');
    assert.deepEqual(await post({ mode: 'perRound', rounds: { 2: 40, 9: '' } }), { ok: true, prep: { mode: 'perRound', rounds: { 2: 40 } }, uniteLayerGains: false, roundCharts: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).prep, { mode: 'perRound', rounds: { 2: 40 } });
    assert.equal((await req(a.port, '/api/settings', { method: 'POST', body: { prep: { mode: 'default' } } })).status, 403, 'token required');
    assert.equal(got.uniteLayerGains, false, 'custom rule defaults off');
    assert.equal(got.allowRoomUniteLayerGains, false, 'room-host control defaults off');
    const postUnite = (uniteLayerGains) => req(a.port, '/api/settings', { method: 'POST', headers: auth, body: { uniteLayerGains } }).then((r) => r.json);
    const before = fs.readFileSync(file, 'utf8');
    assert.match((await postUnite('true')).error, /开或关/);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'invalid rule leaves the saved settings intact');
    assert.equal(getUniteLayerGains(), false);
    assert.deepEqual(await postUnite(true), { ok: true, prep: { mode: 'perRound', rounds: { 2: 40 } }, uniteLayerGains: true, roundCharts: true });
    assert.equal(getUniteLayerGains(), true);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).uniteLayerGains, true);
    assert.equal((await post({ mode: 'perRound', rounds: { 2: 40 } })).uniteLayerGains, true, 'timer-only saves preserve the rule');
    assert.equal(got.roundCharts, true, 'charts default on');
    const postCharts = (roundCharts) => req(a.port, '/api/settings', { method: 'POST', headers: auth, body: { roundCharts } }).then((r) => r.json);
    const savedBefore = fs.readFileSync(file, 'utf8');
    assert.match((await postCharts('false')).error, /开或关/);
    assert.equal(fs.readFileSync(file, 'utf8'), savedBefore, 'invalid chart setting is not persisted');
    assert.equal((await postCharts(false)).roundCharts, false);
    const postSocial = social => req(a.port, '/api/settings', { method: 'POST', headers: auth, body: { social } }).then(r => r.json);
    const beforeSocial = fs.readFileSync(file, 'utf8');
    assert.match((await postSocial({ directory: 'no' })).error, /开或关/);
    assert.equal(fs.readFileSync(file, 'utf8'), beforeSocial);
    assert.equal((await postSocial({ directory: false, hostOnly: true })).social.directory, false);
    assert.equal(getSocialSettings().hostOnly, true);
    assert.equal(getSocialSettings().invitations, true, 'omitted social options remain unchanged');
    const permission = value => req(a.port, '/api/settings', { method: 'POST', headers: auth, body: { allowRoomUniteLayerGains: value } }).then(r => r.json);
    const beforePermission = fs.readFileSync(file, 'utf8');
    assert.match((await permission('true')).error, /开或关/);
    assert.equal(fs.readFileSync(file, 'utf8'), beforePermission);
    assert.equal(getAllowRoomUniteLayerGains(), false);
    assert.equal((await permission(true)).allowRoomUniteLayerGains, true);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).allowRoomUniteLayerGains, true);
    assert.equal((await post({ mode: 'perRound', rounds: { 2: 40 } })).roundCharts, false, 'timer-only saves preserve charts');
    await a.close();
    resetHostSettings();
    a = await startAdmin({ lobby, port: 0, log: { info() {}, error() {} }, resultsDir, settingsFile: file });
    assert.deepEqual(getPrep(), { mode: 'perRound', rounds: { 2: 40 } }, 'read back at start');
    assert.equal(getUniteLayerGains(), true, 'custom rule survives restart');
    assert.equal(getAllowRoomUniteLayerGains(), true, 'room-host permission survives restart and omitted-field saves');
    assert.equal(getSocialSettings().directory, false, 'social policy survives restart and unrelated saves');
    assert.equal(getSocialSettings().hostOnly, true);
    assert.equal((await req(a.port, '/api/settings', { headers: { 'x-admin-token': a.token } })).json.roundCharts, false, 'chart setting survives restart');
    await a.close();
    fs.writeFileSync(file, JSON.stringify({ prep: { mode: 'default' } }));
    a = await startAdmin({ lobby, port: 0, log: { info() {}, error() {} }, resultsDir, settingsFile: file });
    assert.equal(getUniteLayerGains(), false, 'old settings files keep the official rule');
    assert.equal(getAllowRoomUniteLayerGains(), false, 'old files do not grant room-host control');
    assert.equal(getSocialSettings().directory, true, 'old files use documented social defaults');
    assert.equal((await req(a.port, '/api/settings', { headers: { 'x-admin-token': a.token } })).json.roundCharts, true, 'old settings files default to showing charts');
    await a.close();
  } finally {
    resetHostSettings();
  }
});
