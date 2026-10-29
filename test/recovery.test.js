import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { createRecovery, restoreMatch, recoveryIdentity } from '../server/recovery.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { Lobby, Room } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { Match } from '../server/match/Match.js';
import { makeMatch, DATA } from './match/harness.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { FakeBattle } from './match/fakeBattle.js';
import { getReplayConfig, setReplayConfig } from '../server/match/replay.js';
import { capturePrep } from '../server/match/rewind.js';
import { resetHostSettings, setPrep, setUniteLayerGains } from '../server/match/hostSettings.js';

const log = { info() {}, warn() {}, error() {} };
function fixture(t, mode = 'coop', options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-recover-'));
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, getData: () => DATA, log });
  const host = registry.create('Host'); host.connected = true;
  const h = makeMatch({ mode, humans: 1, bots: mode === 'coop' ? 1 : 0, seed: 77, fake: true, clientCombat: true, clients: false, ...options }).start();
  if (options.reroll) assert.deepEqual(h.m.completeSetupReroll(), { ok: true });
  h.toPrep();
  host.playerId = h.m.order[0].playerId;
  registry.byPlayerId.clear(); registry.byPlayerId.set(host.playerId, host);
  const room = new Room(options.code || 'TEST', mode, 'NORMAL', Date.now());
  room.capacity = Math.max(4, h.m.order.length);
  room.seats = Array(room.capacity).fill(null);
  for (const p of h.m.order) room.seats[p.seat] = { seat: p.seat, playerId: p.playerId, name: p.name, isBot: p.isBot, connected: true };
  room.hostId = host.playerId; room.match = h.m; room.matchCount = 1;
  host.roomCode = room.code; lobby.rooms.set(room.code, room);
  const recovery = createRecovery({ lobby, root: process.cwd(), dir: path.join(dir, 'recovery'), identity: 'test', log });
  t.after(() => { recovery.prepareShutdown(); lobby.shutdown(); h.m.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  recovery.save(room, h.m, h.m.prepSnapshots.get(1));
  return { dir, h, recovery, lobby, room, host, file: path.join(dir, 'recovery', `room-${room.code}.bin`) };
}

test('disk recovery restores independent player pools and their stock', context => {
  const source = fixture(context, 'coop', { independentPools: true });
  source.room.independentPools = true;
  const player = source.h.m.order[0], other = source.h.m.order[1];
  const id = [...player.pool.entries.keys()][0];
  assert.ok(player.acquireChess(id));
  const before = [player.pool.left(id), other.pool.left(id)];
  source.recovery.save(source.room, source.h.m, capturePrep(source.h.m));
  class RestoredMatch extends Match {
    constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler(), BattleClass: FakeBattle, botRehearsal: 0, clientCombat: false }); }
  }
  const lobby = new Lobby({ registry: new SessionRegistry(), MatchClass: RestoredMatch, getData: () => DATA, log });
  const recovery = createRecovery({ lobby, root: process.cwd(), dir: path.dirname(source.file), identity: 'test', log });
  context.after(() => { recovery.prepareShutdown(); lobby.shutdown(); });
  recovery.restore();
  const restored = lobby.rooms.get(source.room.code);
  assert.equal(restored.independentPools, true);
  assert.equal(restored.match.independentPools, true);
  assert.notEqual(restored.match.order[0].pool, restored.match.order[1].pool);
  assert.deepEqual(restored.match.order.map((seat) => seat.pool.left(id)), before);
  assert.deepEqual(recovery.status().issues, []);
});

test('disk recovery keeps the rescue rule and each target rescue allowance', context => {
  const source = fixture(context, 'coop', { rescueEnabled: true });
  source.room.rescueEnabled = true;
  source.h.ps('p_0').rescued = true;
  source.recovery.save(source.room, source.h.m, capturePrep(source.h.m));
  class RestoredMatch extends Match {
    constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler(), BattleClass: FakeBattle, botRehearsal: 0, clientCombat: false }); }
  }
  const lobby = new Lobby({ registry: new SessionRegistry(), MatchClass: RestoredMatch, getData: () => DATA, log });
  const recovery = createRecovery({ lobby, root: process.cwd(), dir: path.dirname(source.file), identity: 'test', log });
  context.after(() => { recovery.prepareShutdown(); lobby.shutdown(); });
  recovery.restore();
  const restored = lobby.rooms.get(source.room.code);
  assert.equal(restored.rescueEnabled, true);
  assert.equal(restored.match.rescueEnabled, true);
  assert.equal(restored.match.players.get('p_0').rescued, true);
  assert.deepEqual(recovery.status().issues, []);
});

test('disk recovery preserves all room convenience choices and effective match rules', t => {
  const f = fixture(t);
  const choices = { benchEquip: false, soloUnlimited: false, prepLoadout: false, unequip: true, morphPairing: true };
  f.room.convenience = choices;
  f.room.enemyHpMultiplier = 2.5;
  f.room.private = true;
  f.recovery.save(f.room, f.h.m, f.h.m.prepSnapshots.get(1));
  assert.deepEqual(deserialize(fs.readFileSync(f.file)).room.convenience, choices);
  assert.equal(deserialize(fs.readFileSync(f.file)).room.private, true);
  assert.equal(deserialize(fs.readFileSync(f.file)).room.enemyHpMultiplier, 2.5);
  class RestoredMatch extends Match {
    constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler(), BattleClass: FakeBattle, botRehearsal: 0, clientCombat: false }); }
  }
  const registry = new SessionRegistry(), lobby = new Lobby({ registry, MatchClass: RestoredMatch, getData: () => DATA, log });
  const recovery = createRecovery({ lobby, root: process.cwd(), dir: path.dirname(f.file), identity: 'test', log });
  t.after(() => { recovery.prepareShutdown(); lobby.shutdown(); });
  recovery.restore();
  const restored = lobby.rooms.get(f.room.code);
  assert.equal(restored.private, true);
  assert.equal(lobby.listRooms().rooms.some(room => room.code === restored.code), false);
  assert.deepEqual(restored.convenience, choices);
  assert.deepEqual(restored.match.convenience, choices);
  assert.equal(restored.enemyHpMultiplier, 2.5);
  assert.equal(restored.match.gd.enemyHpMultiplier, 2.5);
  assert.equal(restored.match.rules.prepLoadout, 'locked');
  assert.equal(restored.match.rules.unequip, 'allow');
  assert.equal(restored.match.rules.morphPairing, 'plus');
});

test('disk recovery preserves the room AI-last choice; old snapshots keep the historical default off', t => {
  const f = fixture(t);
  class RestoredMatch extends Match {
    constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler(), BattleClass: FakeBattle, botRehearsal: 0, clientCombat: false }); }
  }
  const room = deserialize(fs.readFileSync(f.file));
  for (const [value, expected] of [[true, true], [false, false], [undefined, false]]) {
    room.room.aiPicksLast = value;
    if (value === undefined) delete room.room.aiPicksLast;
    fs.writeFileSync(f.file, serialize(room));
    const registry = new SessionRegistry(), lobby = new Lobby({ registry, MatchClass: RestoredMatch, getData: () => DATA, log });
    const recovery = createRecovery({ lobby, root: process.cwd(), dir: path.dirname(f.file), identity: 'test', log });
    recovery.restore();
    assert.equal(lobby.rooms.get('TEST')?.aiPicksLast, expected);
    assert.equal(lobby.rooms.get('TEST')?.match.aiPicksLast, expected);
    recovery.prepareShutdown(); lobby.shutdown();
  }
});

for (const code of ['A1B2', '1234', 'COM1', 'LPT9']) test(`twenty-player custom code ${code} survives startup recovery and cleanup`, t => {
  const f = fixture(t, 'coop', { humans: 20, bots: 0, code });
  class RestoredMatch extends Match {
    constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler(), BattleClass: FakeBattle, botRehearsal: 0, clientCombat: false }); }
  }
  const registry = new SessionRegistry(), lobby = new Lobby({ registry, MatchClass: RestoredMatch, getData: () => DATA, log });
  const recovery = createRecovery({ lobby, root: process.cwd(), dir: path.dirname(f.file), identity: 'test', log });
  t.after(() => { recovery.prepareShutdown(); lobby.shutdown(); });
  recovery.restore();
  assert.equal(lobby.rooms.get(code)?.match.phase, 'PREP');
  assert.equal(lobby.rooms.get(code).capacity, 20);
  assert.equal(lobby.rooms.get(code).match.poolGroups.length, 5);
  assert.equal(registry.byToken(f.host.token)?.roomCode, code);
  assert.deepEqual(recovery.status().issues, []);
  assert.ok(recovery.delete(path.basename(f.file)).ok);
  assert.equal(fs.existsSync(f.file), false);
  f.recovery.save(f.room, f.h.m, f.h.m.prepSnapshots.get(1));
  assert.ok(fs.existsSync(f.file));
  f.recovery.configure(false);
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), []);
});

for (const code of ['A1B2', '1234', 'COM1', 'LPT9']) {
  test(`legacy snapshot ${code} restores and migrates without leaving a stale copy`, t => {
    const f = fixture(t, 'coop', { humans: 8, bots: 0, code });
    const legacy = path.join(path.dirname(f.file), code + '.bin');
    fs.renameSync(f.file, legacy);
    class RestoredMatch extends Match {
      constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler(), BattleClass: FakeBattle, botRehearsal: 0, clientCombat: false }); }
    }
    const registry = new SessionRegistry(), lobby = new Lobby({ registry, MatchClass: RestoredMatch, getData: () => DATA, log });
    const recovery = createRecovery({ lobby, root: process.cwd(), dir: path.dirname(f.file), identity: 'test', log });
    t.after(() => { recovery.prepareShutdown(); lobby.shutdown(); });
    recovery.restore();
    assert.equal(lobby.rooms.get(code)?.match.phase, 'PREP');
    assert.equal(registry.byToken(f.host.token)?.roomCode, code);
    assert.deepEqual(recovery.status().issues, []);
    f.recovery.save(f.room, f.h.m, f.h.m.prepSnapshots.get(1));
    assert.ok(fs.existsSync(f.file));
    assert.equal(fs.existsSync(legacy), false);
  });

  for (const action of ['delete', 'disable']) test(`${action} removes both snapshot names for ${code}`, t => {
    const f = fixture(t, 'coop', { code });
    const legacy = path.join(path.dirname(f.file), code + '.bin');
    fs.copyFileSync(f.file, legacy);
    const result = action === 'delete' ? f.recovery.delete(code + '.bin') : f.recovery.configure(false);
    assert.ok(result.ok);
    assert.deepEqual(fs.readdirSync(path.dirname(f.file)), []);
  });
}

test('prefixed snapshot takes precedence over a corrupt legacy copy of the same room', t => {
  const f = fixture(t, 'coop', { code: 'A1B2' });
  fs.writeFileSync(path.join(path.dirname(f.file), 'A1B2.bin'), 'obsolete corrupt copy');
  class RestoredMatch extends Match {
    constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler(), BattleClass: FakeBattle, botRehearsal: 0, clientCombat: false }); }
  }
  const lobby = new Lobby({ registry: new SessionRegistry(), MatchClass: RestoredMatch, getData: () => DATA, log });
  const recovery = createRecovery({ lobby, root: process.cwd(), dir: path.dirname(f.file), identity: 'test', log });
  t.after(() => { recovery.prepareShutdown(); lobby.shutdown(); });
  recovery.restore();
  assert.equal(lobby.rooms.size, 1);
  assert.equal(lobby.rooms.get('A1B2')?.match.phase, 'PREP');
  assert.deepEqual(recovery.status().issues, []);
});

for (const humans of [8, 20]) test(`${humans} players: disk recovery preserves room capacity and every group's inventory`, t => {
  const f = fixture(t, 'coop', { humans, bots: 0 });
  for (const g of f.h.m.poolGroups) g.itemPool.debt.set('fixture', g.id);
  const snap = capturePrep(f.h.m);
  f.recovery.save(f.room, f.h.m, snap);
  const record = deserialize(fs.readFileSync(f.file));
  assert.equal(record.room.capacity, humans);
  const restored = makeMatch({ humans, bots: 0, seed: 77, fake: true, clientCombat: true, clients: false });
  t.after(() => restored.m.dispose());
  restoreMatch(restored.m, record);
  for (const [i, g] of restored.m.poolGroups.entries()) {
    assert.deepEqual(g.pool.entries, f.h.m.poolGroups[i].pool.entries);
    assert.deepEqual(g.itemPool.debt, f.h.m.poolGroups[i].itemPool.debt);
    assert.ok(g.playerIds.every(id => restored.m.players.get(id).pool === g.pool));
  }
});

test('disk snapshot restores PREP identically and continues to the same final result and history', (t) => {
  const old = getReplayConfig(); setReplayConfig({ enabled: true, identity: 'test' });
  t.after(() => setReplayConfig(old));
  const f = fixture(t), record = deserialize(fs.readFileSync(f.file));
  // Save abandoned battle entries to verify rewind truncates them when loading.
  record.replay = { rounds: [{ round: 1, fields: [], admin: [] }] };
  const other = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 77, fake: true, clientCombat: true, clients: false });
  t.after(() => other.m.dispose());
  restoreMatch(other.m, deserialize(serialize(record)));
  assert.equal(other.m.phase, 'PREP'); assert.equal(other.m.round, 1);
  assert.deepEqual(other.m.replay.rounds, []);
  assert.equal(other.ps('p_0').connected, false);
  other.ps('p_0').connected = true;
  assert.deepEqual(other.m.pool.entries, f.h.m.pool.entries);
  assert.deepEqual(other.ps('p_0').privateView(), f.h.ps('p_0').privateView());
  // Server-driven fake combat avoids browser timing in the deterministic continuation comparison.
  f.h.m.clientCombat = false; other.m.clientCombat = false;
  assert.ok(f.h.drive(() => !!f.h.ended)); assert.ok(other.drive(() => !!other.ended));
  const normalize = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(normalize(other.ended), normalize(f.h.ended));
  assert.deepEqual(normalize(other.m.history), normalize(f.h.m.history));
});

test('room unite layers survives recovery even after the host default changes', t => {
  resetHostSettings(); t.after(resetHostSettings);
  const f = fixture(t);
  const restored = makeMatch({ fake: true });
  t.after(() => restored.m.dispose());
  for (const on of [true, false]) {
    f.room.uniteLayerGains = on;
    f.recovery.save(f.room, f.h.m, f.h.m.prepSnapshots.get(1));
    const record = deserialize(fs.readFileSync(f.file));
    setUniteLayerGains(!on);
    assert.equal(record.room.uniteLayerGains, on);
    restoreMatch(restored.m, record);
    assert.equal(restored.m.uniteLayerGains, on);
  }
});

test('test rooms never write a resumable recovery snapshot', t => {
  const f = fixture(t);
  fs.unlinkSync(f.file);
  f.room.test = true;
  f.recovery.save(f.room, f.h.m, f.h.m.prepSnapshots.get(1));
  assert.equal(fs.existsSync(f.file), false);
  f.room.test = false;
  f.h.m.test = true;
  f.recovery.save(f.room, f.h.m, f.h.m.prepSnapshots.get(1));
  assert.equal(fs.existsSync(f.file), false);
});

test('room prep recovery restores the saved override or follows current host settings', t => {
  resetHostSettings(); t.after(resetHostSettings);
  const f = fixture(t, 'coop', { humans: 2, bots: 0 });
  const restored = makeMatch({ humans: 2, bots: 0, seed: 77, fake: true });
  t.after(() => restored.m.dispose());
  f.h.m.prepOverride = { mode: 'fixed', seconds: 45 };
  const snapshot = capturePrep(f.h.m);
  f.recovery.save(f.room, f.h.m, snapshot);
  const record = deserialize(fs.readFileSync(f.file));
  setPrep({ mode: 'fixed', seconds: 90 });
  f.h.m.prepOverride = { mode: 'untimed' };
  restoreMatch(restored.m, record);
  assert.deepEqual(restored.m.prepOverride, { mode: 'fixed', seconds: 45 });
  assert.equal(restored.m.deadline - restored.m.sched.now(), 45000);
  record.snapshot.match.prepOverride = null;
  restoreMatch(restored.m, record);
  assert.equal(restored.m.prepOverride, null);
  assert.equal(restored.m.deadline - restored.m.sched.now(), 90000);
  assert.equal(restored.m.timerScale, 1);
  assert.equal(restored.m.errorCount, 0, JSON.stringify(restored.m.errors));
});

test('rerolled opening and locked DIY settings survive disk recovery through the hidden core', (t) => {
  const diy = { chess_char_5_diy1_a: { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' } };
  const ops = { char_112_siege: { potential: 2, cultivate: 1 } };
  const f = fixture(t, 'coop', { seed: 52, reroll: true, clientCombat: false,
    seats: [{ seat: 0, playerId: 'p_0', name: 'Host', isBot: false, connected: true, diy, ops },
      { seat: 1, playerId: 'p_1', name: 'Peer', isBot: false, connected: true }],
    script: b => b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 1e9 } : {} });
  const m = f.h.m;
  assert.ok(f.h.drive(() => m.phase === 'PREP' && m.round === m.gd.bossRound));
  for (const p of m.order) { p.bondCountBonus.yanShip = 3; p.layers.yanShip = 601; p.recompute(); }
  assert.ok(f.h.drive(() => m.phase === 'PREP' && m.round === m.gd.hiddenRound));
  f.recovery.save(f.room, m, m.prepSnapshots.get(m.round));
  const record = deserialize(fs.readFileSync(f.file));
  // A restarted process reconstructs constructor-only player views from the stored seats.
  const restored = makeMatch({ mode: 'coop', seats: record.seats, seed: record.seed, fake: true,
    script: b => b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 1e9 } : {} });
  t.after(() => restored.m.dispose());
  restoreMatch(restored.m, record);
  for (const p of restored.m.order) p.connected = true;
  assert.equal(restored.m.setupRevision, 1);
  assert.equal(restored.m.stageId, m.stageId);
  assert.deepEqual(restored.m.factions.schedule, m.factions.schedule);
  assert.deepEqual(restored.m.disabledBonds, m.disabledBonds);
  assert.deepEqual(restored.ps('p_0').diy, diy);
  assert.deepEqual(restored.ps('p_0').ops, ops);
  assert.deepEqual(restored.ps('p_0').diyStock.snapshot(), f.h.ps('p_0').diyStock.snapshot());
  assert.deepEqual(restored.ps('p_0').privateView(), f.h.ps('p_0').privateView());
  assert.ok(f.h.drive(() => !!f.h.ended)); assert.ok(restored.drive(() => !!restored.ended));
  assert.equal(restored.ended.hiddenCleared, true);
  const normalize = x => JSON.parse(JSON.stringify(x));
  assert.deepEqual(normalize(restored.ended), normalize(f.h.ended));
  assert.deepEqual(normalize(restored.m.history), normalize(m.history));
  assert.equal(restored.m.errorCount, 0, JSON.stringify(restored.m.errors));
});

test('startup reconstructs sessions with original tokens and seats; incompatible and corrupt files are isolated', (t) => {
  const f = fixture(t, 'solo');
  class RestoredMatch extends Match {
    constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler(), BattleClass: FakeBattle, botRehearsal: 0, clientCombat: false }); }
  }
  const registry = new SessionRegistry(), lobby = new Lobby({ registry, MatchClass: RestoredMatch, getData: () => DATA, log });
  const recovery = createRecovery({ lobby, root: process.cwd(), dir: path.dirname(f.file), identity: 'test', log });
  t.after(() => { recovery.prepareShutdown(); lobby.shutdown(); });
  const bad = deserialize(fs.readFileSync(f.file)); bad.identity = 'old'; bad.room.code = 'OLDD';
  fs.writeFileSync(path.join(path.dirname(f.file), 'OLDD.bin'), serialize(bad));
  fs.writeFileSync(path.join(path.dirname(f.file), 'BADD.bin'), 'corrupt');
  recovery.restore();
  assert.equal(lobby.rooms.size, 1); assert.equal(lobby.rooms.get('TEST').match.phase, 'PREP');
  const session = registry.byToken(f.host.token);
  assert.equal(session.playerId, f.host.playerId); assert.equal(session.roomCode, 'TEST');
  assert.equal(session.connected, false); assert.equal(session.resumeWindowMs, lobby.soloResumeWindowMs());
  assert.equal(recovery.status().issues.length, 2);
  assert.ok(recovery.status().issues.some((x) => x.error.includes('版本')));
  assert.ok(recovery.delete('../TEST.bin').error);
});

test('disabled persistence writes no snapshots and survives restart', (t) => {
  const f = fixture(t);
  assert.equal(f.recovery.configure(false).ok, true);
  assert.equal(fs.existsSync(f.file), false);
  f.recovery.save(f.room, f.h.m, f.h.m.prepSnapshots.get(1));
  assert.equal(fs.existsSync(f.file), false);
  const next = createRecovery({ lobby: f.lobby, root: process.cwd(), dir: path.dirname(f.file), identity: 'test', log });
  assert.equal(next.status().enabled, false);
});

test('source checkout has a version fingerprint; original browser token reconnects after two real server restarts', async (t) => {
  assert.match(recoveryIdentity(process.cwd()), /^v[\w.-]+:[a-f0-9]{64}$/);
  const f = fixture(t, 'solo');
  f.room.uniteLayerGains = true;
  f.h.m.uniteLayerGains = true;
  f.recovery.save(f.room, f.h.m, f.h.m.prepSnapshots.get(1));
  class RestoredMatch extends Match {
    constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler(), BattleClass: FakeBattle, botRehearsal: 0 }); }
  }
  for (let restart = 0; restart < 2; restart++) {
    const srv = await startServer({ port: 0, host: '127.0.0.1', log, MatchClass: RestoredMatch,
      assetIndex: false, recovery: { dir: path.dirname(f.file), identity: 'test' } });
    let client;
    try {
      client = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      const welcome = await client.hello('Host', f.host.token);
      assert.equal(welcome.playerId, f.host.playerId); assert.equal(welcome.token, f.host.token);
      const state = await client.waitFor('room.state'); assert.equal(state.code, 'TEST');
      assert.equal(state.uniteLayerGains, true);
      assert.equal(srv.lobby.rooms.get('TEST').match.uniteLayerGains, true);
      const pub = await client.waitFor('m.public', p => p.phase === 'PREP'); assert.equal(pub.round, 1);
      assert.equal(srv.lobby.rooms.get('TEST').match.players.get(f.host.playerId).connected, true);
    } finally { await client?.terminate(); await srv.close(); }
    assert.equal(fs.existsSync(f.file), true, 'normal shutdown retains the snapshot');
  }
});
