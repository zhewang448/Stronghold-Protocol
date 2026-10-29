import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { roomsView, matchView, startAdmin, handleAction } from '../server/admin.js';
import { stockView, matchWaiting } from '../server/admin-observability.js';
import { createResultSummary } from '../server/result-summary.js';
import { makeMatch } from './match/harness.js';
import { CONVENIENCE_DEFAULTS } from '../shared/roomConvenience.js';

test('waiting room reports its host, actual rules and blockers', async () => {
  const room = {
    code: 'WAIT', mode: 'coop', difficulty: 'NORMAL', hostId: 'host', enemyHpMultiplier: 2,
    independentPools: true, uniteLayerGains: true, test: false, needsContent: true,
    content: { cs: 'content', vanilla: false, plugins: [{ id: 'example', version: '1', class: 'content' }], trusted: {} },
    seats: [
      { playerId: 'host', name: 'Host', connected: true, ready: false, content: 'ready', consentCs: 'content' },
      { playerId: 'guest', name: 'Guest', connected: true, ready: false, content: 'failed', consentCs: 'content' },
    ], spectators: [], match: null,
  };
  const view = (await roomsView({ rooms: new Map([['WAIT', room]]) }))[0];
  assert.equal(view.hostId, 'host');
  assert.equal(view.rules.enemyHpMultiplier, 2);
  assert.equal(view.rules.independentPools, true);
  assert.equal(view.rules.uniteLayerGains, true);
  assert.deepEqual(view.rules.plugins, [{ id: 'example', version: '1', kind: 'content' }]);
  assert.equal(view.seats[1].ready, false);
  assert.equal(view.seats[1].content, 'failed');
  assert.deepEqual(view.blockers, ['Guest 未准备', 'Guest 的插件加载失败']);
  room.seats[1].ready = true;
  room.seats[1].content = 'ready';
  assert.deepEqual((await roomsView({ rooms: new Map([['WAIT', room]]) }))[0].blockers, []);
});

test('stock is grouped and changes only for the player who receives a piece', (t) => {
  const harness = makeMatch({ humans: 2, independentPools: true, fake: true }).start().toPrep();
  t.after(() => harness.m.dispose());
  const room = { code: 'TEST', match: harness.m };
  const lobby = { rooms: new Map([['TEST', room]]) };
  const first = stockView(harness.m, 1), second = stockView(harness.m, 2);
  const entry = first.chess.find((item) => item.left > 0);
  assert.ok(entry);
  assert.equal(first.groups.length, 2);
  assert.ok(first.items.length > 0);
  assert.deepEqual(handleAction(lobby, { room: 'TEST', action: 'chess', playerId: 'p_0', value: entry.id }), { ok: true });
  const firstAfter = stockView(harness.m, 1).chess.find((item) => item.id === entry.id);
  const secondAfter = stockView(harness.m, 2).chess.find((item) => item.id === entry.id);
  assert.equal(firstAfter.left, entry.left - 1);
  assert.equal(firstAfter.held, entry.held + 1);
  assert.equal(secondAfter.left, second.chess.find((item) => item.id === entry.id).left);
});

test('battle status distinguishes an unreported field and a server takeover', (t) => {
  const harness = makeMatch({ humans: 1, clientCombat: true, clients: false, fake: true, instant: false }).start().toPrep();
  t.after(() => harness.m.dispose());
  assert.ok(harness.drive(() => harness.m.phase === 'COMBAT'));
  const field = harness.m.fields.find((entry) => entry.cc);
  assert.ok(field);
  let view = matchView(harness.m).battles.find((entry) => entry.id === field.fieldId);
  assert.equal(view.mode, 'client');
  assert.equal(view.authority.id, 'p_0');
  assert.equal(view.progressAgeSeconds, null);
  harness.m._onProgress(harness.ps('p_0'), { battleId: field.battleId, gt: 1, total: 10, killed: 2 });
  view = matchView(harness.m).battles.find((entry) => entry.id === field.fieldId);
  assert.equal(view.progress.killed, 2);
  assert.equal(view.progressAgeSeconds, 0);
  harness.m._authorityLost(harness.ps('p_0'), 'disconnect');
  view = matchView(harness.m).battles.find((entry) => entry.id === field.fieldId);
  assert.equal(view.mode, 'server');
  assert.ok(harness.m.adminDiagnostics.some((entry) => entry.type === 'takeover' && entry.reason === 'disconnect'));
});

test('match waiting identifies pending information, draft turns and preparation', () => {
  const player = { playerId: 'player', name: 'Doctor', isBot: false, left: false, alive: true, ready: false, infoReady: false };
  const match = { phase: 'INFO_CHECK', order: [player], players: new Map([['player', player]]) };
  assert.deepEqual(matchWaiting(match), ['等待确认开局信息：Doctor']);
  match.phase = 'BAND_DRAFT';
  match.draft = { groups: [{ done: false, order: ['player'], idx: 0 }] };
  assert.deepEqual(matchWaiting(match), ['等待选择分队：Doctor']);
  match.phase = 'SP_DRAFT';
  match.sp = { groups: [{ done: false, order: ['player'], idx: 0 }] };
  assert.deepEqual(matchWaiting(match), ['等待选择机变：Doctor']);
  match.phase = 'PREP';
  assert.deepEqual(matchWaiting(match), ['等待准备：Doctor']);
  match.paused = true;
  assert.deepEqual(matchWaiting(match), ['对局已暂停']);
});

test('summary separates custom and unknown records without guessing old defaults', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-rules-summary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = { savedAt: 10, mode: 'coop', difficulty: 'NORMAL', result: { victory: true, roundsPassed: 2, players: [] } };
  const standard = { enemyHpMultiplier: 1, independentPools: false, uniteLayerGains: false, aiPicksLast: true, gameplayPlugins: false, adminModified: false, convenience: { ...CONVENIENCE_DEFAULTS } };
  for (const [name, record] of Object.entries({
    standard: { ...base, rules: standard },
    custom: { ...base, rules: { ...standard, enemyHpMultiplier: 2 } },
    old: base,
    oldCustom: { ...base, result: { ...base.result, enemyHpMultiplier: 3 } },
    convenience: { ...base, rules: { ...standard, convenience: { ...CONVENIENCE_DEFAULTS, unequip: true } } },
  })) fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(record));
  const summary = createResultSummary(dir);
  assert.deepEqual(summary().ruleCounts, { standard: 1, custom: 3, unknown: 1 });
  assert.equal(summary({ rules: 'standard' }).games, 1);
  assert.equal(summary({ rules: 'custom' }).games, 3);
  assert.equal(summary({ rules: 'unknown' }).games, 1);
});

test('event journal survives room closure and server restart with action changes', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-admin-events-'));
  const harness = makeMatch({ humans: 1, fake: true }).start().toPrep();
  const player = harness.ps('p_0');
  const room = { code: 'TEST', mode: 'coop', difficulty: 'NORMAL', hostId: 'p_0', enemyHpMultiplier: 1,
    independentPools: false, uniteLayerGains: false, test: false, content: { vanilla: true, plugins: [] },
    seats: [{ playerId: player.playerId, seat: player.seat, name: player.name, connected: true, ready: true }],
    spectators: [], match: harness.m };
  const lobby = {
    rooms: new Map([['TEST', room]]), safeData: () => harness.m.data, onMatchEnd() {},
    broadcastState() {}, disposeRoom(target) { target.disposed = true; this.rooms.delete(target.code); },
  };
  const options = { lobby, port: 0, resultsDir: dir, replaysDir: path.join(dir, 'replays'), settingsFile: path.join(dir, 'settings.json'),
    updateOptions: { fetchImpl: async () => new Response('[]') }, log: { info() {}, error() {} } };
  let admin = await startAdmin(options);
  t.after(async () => { await admin?.close(); harness.m.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  const request = async (route, body) => {
    const response = await fetch(admin.url + route, { method: body ? 'POST' : 'GET',
      headers: { 'X-Admin-Token': admin.token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return response.json();
  };
  const before = player.funds;
  assert.equal((await request('/api/action', { room: 'TEST', action: 'funds', playerId: 'p_0', value: 7 })).ok, true);
  assert.ok((await request('/api/action', { room: 'TEST', action: 'lp', playerId: 'p_0', value: -1 })).error);
  room.seats[0].connected = false; lobby.broadcastState(room);
  room.seats[0].connected = true; lobby.broadcastState(room);
  assert.equal((await request('/api/action', { room: 'TEST', action: 'closeRoom' })).ok, true);
  let events = (await request('/api/events?room=TEST')).events;
  const action = events.find((entry) => entry.action === 'funds');
  assert.equal(action.before.funds, before);
  assert.equal(action.after.funds, before + 7);
  assert.equal(events.find((entry) => entry.action === 'lp').ok, false);
  assert.ok(events.some((entry) => entry.message === '连接断开'));
  assert.ok(events.some((entry) => entry.message === '重新连接'));
  assert.ok(events.some((entry) => entry.message?.startsWith('房间关闭')));
  await admin.close();
  admin = await startAdmin(options);
  events = (await request('/api/events?room=TEST')).events;
  assert.ok(events.some((entry) => entry.action === 'funds' && entry.after.funds === before + 7));
  assert.equal((await fetch(admin.url + '/api/events')).status, 403);
  assert.equal((await fetch(admin.url + '/api/stock?room=TEST')).status, 403);
  assert.equal((await request('/api/storage', { confirm: true, categories: ['adminLogs'] })).ok, true);
  assert.deepEqual((await request('/api/events?room=TEST')).events, []);
});
