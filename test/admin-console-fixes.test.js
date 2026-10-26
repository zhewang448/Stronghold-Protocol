import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { makeMatch } from './match/harness.js';
import { roomsView, matchView, catalogView, resultRecord, listRecords, handleAction } from '../server/admin.js';
import { liveState, liveIntent } from '../server/admin-live.js';
import { extensionAdmin } from '../server/match/host/extensions.js';
import { DEFAULT_VERSION, VERSIONS } from '../shared/versions.js';
import { getVersionData } from '../server/data.js';
import { readOfferFile, readOfferCards } from '../shared/plugins/offers.js';
import { startServer } from '../server/index.js';
import { createResources } from '../server/resources.js';
import { TestClient } from './helpers/wsClient.js';
import { PHASE } from '../shared/constants.js';
import { createMatchHosts } from '../server/match/host/index.js';
import { createVersionSets } from '../server/versions.js';
import { computeVanillaContent } from '../server/plugins/identity.js';
import { DATA_SHIM_JS } from '../server/http/static.js';
import { wallView } from '../server/admin-wall.js';
import { effectiveRoomRules, convenienceRules } from '../shared/roomConvenience.js';
import { recordRound } from '../server/match/history.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const command = (s, intent) => ({ room: 'TEST', playerId: s.playerId, matchId: s.matchId,
  revision: s.revision, round: s.public.round, phase: s.public.phase, intent });

for (const v of VERSIONS) test(`console version identity, catalog and records: ${v.id}`, t => {
  const h = makeMatch({ humans: 1, fake: true, data: getVersionData(v.id, { log: quiet }) }).start().toPrep();
  t.after(() => h.m.dispose());
  h.m.version = v.id === DEFAULT_VERSION ? null : v.id;
  const room = { code: 'TEST', version: v.id, mode: 'coop', seats: [], spectators: [], match: h.m };
  const lobby = { rooms: new Map([['TEST', room]]) };
  assert.equal(roomsView(lobby)[0].version, v.id);
  const view = matchView(h.m), catalog = catalogView(lobby, 'TEST');
  assert.equal(view.version, v.id);
  assert.equal(catalog.version, v.id);
  assert.equal(catalog.matchId, view.matchId);
  assert.equal(liveState(lobby, { room: 'TEST', playerId: 'p_0' }).version, v.id);
  const rec = resultRecord(room, h.m, { players: [] });
  assert.equal(rec.version, v.id);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-console-records-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'new.json'), JSON.stringify(rec));
  fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ ...rec, version: undefined }));
  assert.equal(listRecords(dir).find(r => r.id === 'new.json').version, v.id);
  assert.equal(listRecords(dir).find(r => r.id === 'old.json').version, DEFAULT_VERSION);
  const identity = JSON.stringify([catalog.matchId, catalog.version, catalog.cs]);
  assert.equal(handleAction(lobby, { room: 'TEST', action: 'item', playerId: 'p_0', value: 'not-in-catalog', catalogIdentity: identity }).code, 'BAD_TARGET');
  assert.equal(handleAction(lobby, { room: 'TEST', action: 'item', playerId: 'p_0', value: catalog.items[0].id, catalogIdentity: 'old-match' }).code, 'BAD_TARGET');
  assert.equal(handleAction(lobby, { room: 'TEST', action: 'item', playerId: 'p_0', value: catalog.items[0].id, catalogIdentity: identity }).ok, true);
});

test('new console intents run real equipment, offers, refreshes and Unite ballots with existing guards', t => {
  const h = makeMatch({ humans: 2, fake: true, rules: { unequip: 'allow' } }).start().toPrep();
  t.after(() => h.m.dispose());
  const m = h.m, ps = h.ps('p_0'), lobby = { rooms: new Map([['TEST', { code: 'TEST', match: m }]]) };
  const run = intent => liveIntent(lobby, command(liveState(lobby, { room: 'TEST', playerId: 'p_0' }), intent));
  ps.funds = 100;
  assert.equal(run({ t: 'g.buy', slot: ps.shop.slots.findIndex(s => s?.kind === 'chess' && !s.sold) }).ok, true);
  const piece = ps.hand.find(p => p?.kind === 'chess');
  assert.ok(ps.acquireItem('chess_item_5_07_e_a'));
  const item = ps.hand.find(p => p?.kind === 'item');
  assert.equal(run({ t: 'g.equip', itemUid: item.uid, targetUid: piece.uid }).ok, true);
  assert.equal(run({ t: 'g.unequip', itemUid: item.uid }).ok, true);
  assert.equal(piece.items.length, 0);
  const parsed = readOfferFile({ offer: 1, id: 'console-pick', when: { at: ['prep'], rounds: [3] }, windowSec: 30,
    quorum: 'all', onTimeout: 'auto', defer: [], slots: 3, refresh: { perSlot: 1 },
    options: { source: 'lib/cards.json' }, apply: { funds: 3 } }, { pluginId: 'demo', rel: 'offers/console-pick.json' });
  assert.deepEqual(parsed.problems, []);
  const cards = readOfferCards(['a', 'b', 'c', 'd'].map(id => ({ id, name: id, desc: 'Grant', icon: 'funds' })), parsed.offer);
  m.offers = [{ pluginId: 'demo', ...parsed.offer, cards: cards.cards }];
  m.round = 3;
  assert.equal(m.openOfferWindow('prep', 3), 'open');
  const win = m.offerWin[0];
  const offer = type => ({ t: type, offerId: win.id, pluginId: win.pluginId, seq: win.seq, idx: 0, cardId: win.options.get(ps.playerId)[0].id });
  assert.equal(run(offer('g.offerRefresh')).ok, true);
  const funds = ps.funds;
  assert.equal(run(offer('g.offer')).ok, true);
  assert.equal(ps.funds, funds + 3);
  m.phase = PHASE.UNITE;
  m.unitePlan = { round: 1, roundsMax: 2, helpers: [ps], leakers: [], leaked: [], usedHelpers: [], reserveHelpers: [h.ps('p_1')], skipVotes: new Set(), skipRemaining: false };
  m.fields = [{ live: true, players: ['p_0'] }];
  assert.equal(run({ t: 'g.uniteSkipVote', voteId: m.uniteSkipVoteView().id }).ok, true);
  assert.ok(m.unitePlan.skipVotes.has('p_0'));
  for (const flag of ['left', 'isBot']) {
    ps[flag] = true;
    assert.equal(run({ t: 'g.uniteSkipVote' }).code, 'BAD_TARGET');
    ps[flag] = false;
  }
  ps.alive = false;
  assert.equal(run({ t: 'g.uniteSkipVote' }).code, 'BAD_TARGET');
});

test('isolated wall rebuilds membership and connection state on every request', t => {
  const h = makeMatch({ humans: 2, fake: true });
  t.after(() => h.m.dispose());
  const wall = () => extensionAdmin(h.m, 'wall').result;
  assert.equal(wall().seats[0].connected, true);
  h.m.order[0].connected = false;
  assert.equal(wall().seats[0].connected, false);
  h.m.order[0].connected = true;
  assert.equal(wall().seats[0].connected, true);
  h.m.order[0].left = true;
  assert.equal(wall().seats[0].connected, false);
  assert.equal(wall().seats[0].left, true);
});

test('ordinary and live room rules agree with convenience off/on and plugin overrides', () => {
  for (const on of [false, true]) for (const rules of [null, { unequip: 'official', prepLoadout: 'locked', morphPairing: 'official' }]) {
    const convenience = { prepLoadout: on, unequip: on, morphPairing: on };
    const room = { convenience, content: { rules } };
    assert.deepEqual(effectiveRoomRules(room), convenienceRules(convenience, rules));
  }
});

test('console operator history keeps ordinary and multiple Unite waves and tolerates old missing rows', t => {
  const h = makeMatch({ humans: 1, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const unit = dmg => ({ kind: 'chess', defId: 'operator', name: 'Operator', dmg, kills: 1 });
  h.m.lastResults.set('p_0', { perfect: true, unitStats: [unit(10)] });
  recordRound(h.m, { uniteResults: [
    { perPlayer: { p_0: { unitStats: [unit(123)] } } },
    { perPlayer: { p_0: { unitStats: [unit(7)] } } },
    { perPlayer: { p_0: {} } },
  ] });
  assert.equal(h.m.history[0].players[0].units[0].dmg, 140);
  assert.equal(h.m.history[0].players[0].units[0].kills, 3);
});

test('real WebSocket heartbeat samples RTT, reconnect starts empty, close detaches', async t => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
  t.after(() => srv.close());
  const r = createResources({ lobby: srv.lobby, network: srv.network, traffic: srv.traffic });
  t.after(() => r.close());
  let client = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws');
  t.after(() => client.close());
  const welcome = await client.hello('RTT');
  assert.equal(r.snapshot().players[0].rtt, undefined);
  const serverWs = srv.lobby.registry.byId(welcome.playerId).ws;
  const pong = new Promise(resolve => serverWs.once('pong', resolve));
  srv.network.heartbeat();
  await pong;
  assert.ok(r.snapshot().players[0].rtt >= 0);
  await client.close();
  client = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws');
  await client.hello('RTT', welcome.token);
  assert.equal(r.snapshot().players[0].rtt, undefined);
  r.close();
  assert.equal(srv.network.monitor, undefined);
});

test('catalog UI invalidates on match/content/version, rejects late responses and clears drafts', async () => {
  const html = fs.readFileSync('server/admin.html', 'utf8');
  const pending = [], nodes = new Map();
  const context = vm.createContext({ Map, Set, JSON, Promise, encodeURIComponent, Error,
    api: () => new Promise(resolve => pending.push(resolve)), esc: String,
    $: s => { if (!nodes.has(s)) nodes.set(s, { innerHTML: '', replaceChildren() { this.innerHTML = ''; } }); return nodes.get(s); },
    document: { querySelectorAll: () => [] }, DEFAULT_VERSION,
  });
  vm.runInContext(html.slice(html.indexOf('let catalogKey'), html.indexOf('function playerAccessLabel'))
    + html.slice(html.indexOf('function loadCatalog('), html.indexOf('// data attributes of a button')), context);
  const setRoom = (id, version = DEFAULT_VERSION) => vm.runInContext(`latestRooms = [{code:'TEST',match:{matchId:'${id}',version:'${version}',cs:null}}]`, context);
  const catalog = (matchId, version = DEFAULT_VERSION) => ({ matchId, version, cs: null, chess: [{ id: matchId, name: matchId, tier: 1 }], items: [], cards: [], diy: [] });
  setRoom('one');
  const first = vm.runInContext("loadCatalog('TEST')", context);
  setRoom('two', 'act1autochess');
  const second = vm.runInContext("loadCatalog('TEST')", context);
  pending[1](catalog('two', 'act1autochess')); await second;
  pending[0](catalog('one')); await assert.rejects(first, /已过期/);
  assert.equal(vm.runInContext("names.chess.get('two（1费）')", context), 'two');
  assert.equal(vm.runInContext("names.chess.has('one（1费）')", context), false);
  await vm.runInContext("loadCatalog('TEST')", context);
  assert.equal(pending.length, 2);
  vm.runInContext("diyDraft.set('p_0',{label:'old'}); latestRooms[0].match.cs='new-plugin'", context);
  const third = vm.runInContext("loadCatalog('TEST')", context);
  assert.equal(vm.runInContext('diyDraft.size', context), 0);
  pending[2]({ ...catalog('two', 'act1autochess'), cs: 'new-plugin' }); await third;
});

for (const transport of ['process', 'worker']) test('historical console host identities and current membership: ' + transport, { timeout: 30000 }, async t => {
  const vanilla = computeVanillaContent({ simDir: path.resolve('server/sim'), sharedDir: path.resolve('shared'), dataDir: path.resolve('data'), shim: DATA_SHIM_JS });
  const versions = createVersionSets({ enabled: VERSIONS.map(v => v.id), vanilla, log: quiet });
  const hosts = createMatchHosts({ contents: versions, log: quiet, options: { kind: 'version', transport, matchOptions: { botRehearsal: 0 } } });
  t.after(() => hosts.close());
  for (const version of VERSIONS.filter(v => v.id !== DEFAULT_VERSION)) {
    const cs = versions.csOf(version.id);
    const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', connected: true, isBot: false },
      { seat: 1, playerId: 'p_1', name: 'P1', connected: true, isBot: false }];
    const m = hosts.create(cs, { roomCode: 'TEST', mode: 'coop', difficulty: 'NORMAL', version: version.id,
      seats, spectators: [], seed: 42, matchNo: 1, cs, requireCs: true,
      convenience: { prepLoadout: false, unequip: true, morphPairing: true },
      send() { return true; }, broadcast() {}, onEnd() {} });
    m.start();
    const room = { code: 'TEST', version: version.id, content: versions.content(version.id), seats, spectators: [], match: m };
    const lobby = { rooms: new Map([['TEST', room]]), vanilla };
    const view = (await roomsView(lobby))[0].match;
    const catalog = await catalogView(lobby, 'TEST');
    assert.equal(view.version, version.id); assert.equal(catalog.version, version.id);
    assert.equal(catalog.matchId, view.matchId); assert.equal(catalog.cs, cs);
    const live = await liveState(lobby, { room: 'TEST', playerId: 'p_0' });
    assert.equal(live.version, version.id); assert.equal(live.content.version, version.id);
    assert.equal(live.public.convenience.prepLoadout, false);
    assert.equal(live.public.convenience.unequip, true);
    assert.equal((await wallView(lobby, 'TEST')).seats[0].connected, true);
    seats[0].connected = false; m.onDisconnect('p_0');
    assert.equal((await wallView(lobby, 'TEST')).seats[0].connected, false);
    assert.equal((await m.admin('wall')).seats[0].connected, false);
    seats[0].connected = true; m.onReconnect('p_0');
    assert.equal((await wallView(lobby, 'TEST')).seats[0].connected, true);
    seats[0].left = true; m.onLeave('p_0');
    assert.equal((await wallView(lobby, 'TEST')).seats[0].connected, false);
    assert.equal((await m.admin('wall')).seats[0].left, true);
    m.dispose();
  }
});
