// server/match/rewind.js — 回到上个休整期开始. The check that catches forgotten state: a match rewound from later in a
// round and played on must end exactly like the same seed played straight through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { capturePrep, rewindToPrep } from '../../server/match/rewind.js';
import { makeMatch, checkInvariants } from './harness.js';

/** Everything that decides a match, without piece uids (rewind keeps uidSeq monotonic). */
function fingerprint(m) {
  const ids = (arr) => arr.map((p) => (p ? `${p.id}${p.items && p.items.length ? '+' + p.items.map((i) => i.id).join('+') : ''}` : '-'));
  const history = m.history.map((round) => ({ ...round, players: round.players.map((player) => ({
    ...player, units: (player.units || []).map(({ uid: _uid, ...unit }) => unit),
  })) }));
  return JSON.stringify({
    phase: m.phase, round: m.round, outcome: m.outcome, history, pool: [...m.pool.entries].map(([k, e]) => `${k}:${e.left}`),
    players: m.order.map((ps) => ({
      lp: ps.lp, alive: ps.alive, funds: ps.funds, level: ps.shop.level, shop: ps.shop.slots.map((s) => s && s.id),
      board: ids([...ps.board.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, p]) => ({ ...p, id: `${k}=${p.id}` }))),
      hand: ids(ps.hand), temp: ids(ps.temp), bonds: ps.bonds, layers: ps.layers, stats: ps.stats, effects: ps.effects.map((e) => e.key || e.name),
    })),
  });
}

for (const humans of [8, 20]) test(`${humans} players: rewind restores every fixed group's pool and equipment debt`, t => {
  const h = makeMatch({ humans, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const m = h.m;
  for (const g of m.poolGroups) g.itemPool.debt.set('fixture', g.id);
  const snap = capturePrep(m);
  assert.ok(snap, JSON.stringify(h.logs));
  m.prepSnapshots.set(m.round, snap);
  const before = m.poolGroups.map(g => ({ entries: structuredClone(g.pool.entries), debt: new Map(g.itemPool.debt) }));
  for (const g of m.poolGroups) {
    const id = [...g.pool.entries.keys()][0];
    assert.ok(g.pool.take(id, 1));
    g.itemPool.debt.set('fixture', 99);
    g.itemPool.debt.set('abandoned', 2);
  }
  assert.deepEqual(rewindToPrep(m, m.round), { ok: true, round: m.round });
  for (const [i, g] of m.poolGroups.entries()) {
    assert.deepEqual(g.pool.entries, before[i].entries);
    assert.deepEqual(g.itemPool.debt, before[i].debt);
    for (const id of g.playerIds) assert.equal(m.players.get(id).pool, g.pool);
  }
});

test('upstream merge: rewind restores equipment debt and cancels abandoned delegated rehearsals', t => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 0, fake: true }).start().toPrep();
  const m = h.m;
  t.after(() => m.dispose());
  m.itemPool.debt.set('item-fixture', 2);
  m.prepSnapshots.set(m.round, capturePrep(m));
  m.itemPool.debt.set('item-fixture', 5);
  m.itemPool.debt.set('abandoned', 1);
  m._rehearsalTasks.set('abandoned', { id: 'abandoned', executor: 'p0', timer: null });
  assert.deepEqual(rewindToPrep(m, m.round), { ok: true, round: m.round });
  assert.deepEqual([...m.itemPool.debt], [['item-fixture', 2]]);
  assert.equal(m._rehearsalTasks.size, 0);
});

const play = (seed) => makeMatch({ mode: 'coop', humans: 1, bots: 3, seed }).start().autoHumans();

test('0.2.5: rewind restores boss partners and sides, or clears pairing before the boss round', t => {
  const h = makeMatch({ mode: 'coop', humans: 4, seed: 77, fake: true, clientCombat: true }).start().toPrep();
  const m = h.m;
  t.after(() => m.dispose());
  const firstRound = m.round;
  assert.equal(m.bossPairs, null);
  m.round = m.gd.bossRound;
  m._planBossWaves();
  m.enterPrep();
  const pairs = structuredClone(m.bossPairs);
  const waves = structuredClone(m.bossWaves);
  assert.equal(pairs.length, 2);
  // A later timeline can redraw different partners after elimination or seat changes.
  m.bossPairs = pairs.map(g => g.slice().reverse()).reverse();
  assert.notDeepEqual(m.bossPairs, pairs);
  assert.deepEqual(rewindToPrep(m, m.gd.bossRound), { ok: true, round: m.gd.bossRound });
  assert.deepEqual(m.bossPairs, pairs, 'partners and left/right sides match the restored board preview');
  assert.deepEqual(m.bossWaves, waves);
  m.startFinalAssault();
  assert.deepEqual(m.fields.map(f => f.players), pairs, 'combat follows the restored preview');
  assert.deepEqual(rewindToPrep(m, firstRound), { ok: true, round: firstRound });
  assert.equal(m.bossPairs, null, 'an earlier prep does not retain partners from the abandoned timeline');
  assert.equal(m.bossWaves, null);
  checkInvariants(m);
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
});

test('0.2.3: rewind restores AI reaction counters from the abandoned timeline', () => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 11, fake: true }).start().autoHumans();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === 2, { ready: false });
  m._botEmotesSettledRound = 1;
  m._botEmotesMerges = new Map([['ai_0', 1]]);
  m.prepSnapshots.set(2, capturePrep(m));
  m._botEmotesSettledRound = 4;
  m._botEmotesMerges.set('ai_0', 3);
  assert.deepEqual(rewindToPrep(m, 2), { ok: true, round: 2 });
  assert.equal(m._botEmotesSettledRound, 1);
  assert.deepEqual([...m._botEmotesMerges], [['ai_0', 1]]);
  checkInvariants(m);
  m.dispose();
});

test('rewound mid-round and replayed: the match ends exactly like the straight run', () => {
  const a = play(4242);
  assert.ok(a.drive(() => a.ended != null), "straight run ended");
  const straight = fingerprint(a.m);
  a.m.dispose();

  const b = play(4242);
  b.drive(() => b.m.phase === PHASE.PREP && b.m.round === 4);
  const atPrep = fingerprint(b.m);
  b.drive(() => b.m.phase === PHASE.SETTLE && b.m.round === 4);
  assert.notEqual(fingerprint(b.m), atPrep, 'the round moved on');
  assert.deepEqual(rewindToPrep(b.m), { ok: true, round: 4 });
  assert.equal(b.m.phase, PHASE.PREP);
  assert.equal(fingerprint(b.m), atPrep, 'state is back at the start of PREP R4');
  checkInvariants(b.m);
  assert.ok(b.drive(() => b.ended != null), "rewound run ended");
  assert.equal(fingerprint(b.m), straight);
  assert.equal(b.m.errorCount, 0, JSON.stringify(b.m.errors));
  b.m.dispose();
});

test('back from R6 to R3: later snapshots are dropped and the replay ends like the straight run', () => {
  const a = play(4242);
  assert.ok(a.drive(() => a.ended != null));
  const straight = fingerprint(a.m);
  a.m.dispose();

  const b = play(4242);
  b.drive(() => b.m.phase === PHASE.PREP && b.m.round === 3);
  const atPrep3 = fingerprint(b.m);
  b.drive(() => b.m.phase === PHASE.PREP && b.m.round === 6);
  assert.deepEqual(b.m.history.map((h) => h.round), [1, 2, 3, 4, 5]);
  assert.ok([3, 4, 5, 6].every((r) => b.m.prepSnapshots.has(r)), 'one snapshot per round');
  assert.match(rewindToPrep(b.m, 9).error, /第 9 回合/);
  assert.deepEqual(rewindToPrep(b.m, 3), { ok: true, round: 3 });
  assert.equal(fingerprint(b.m), atPrep3);
  assert.ok(b.m.prepSnapshots.has(3) && ![4, 5, 6].some((r) => b.m.prepSnapshots.has(r)), 'R4–R6 snapshots dropped');
  assert.deepEqual(b.m.history.map((h) => h.round), [1, 2], 'the console record is back at R3 too (history.js)');
  checkInvariants(b.m);
  assert.ok(b.drive(() => b.ended != null));
  assert.equal(fingerprint(b.m), straight);
  assert.equal(b.m.errorCount, 0, JSON.stringify(b.m.errors));
  b.m.dispose();
});

test('rewind twice in a row, mid-battle with client-side combat, and the human is told', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 1, seed: 77, clientCombat: true }).start().autoHumans();
  const m = h.m;
  assert.match(rewindToPrep(m).error, /快照/);
  h.drive(() => m.phase === PHASE.PREP && m.round === 3);
  const atPrep = fingerprint(m);
  h.drive(() => m.phase === PHASE.COMBAT && m.round === 3);
  assert.ok(m.fields.some((f) => f.live), 'a battle is running');
  const before = h.sent.length;
  assert.deepEqual(rewindToPrep(m), { ok: true, round: 3 });
  assert.equal(fingerprint(m), atPrep);
  assert.ok(!m.fields.length && !m.runner, 'battles dropped');
  const resent = h.sent.slice(before).filter(([id, msg]) => id === 'p_0' && msg.t === 'm.private');
  assert.ok(resent.length >= 1, 'full m.private resent');
  assert.equal(h.lastBc('m.public').phase, PHASE.PREP);
  // a second rewind right away lands on the same state
  assert.deepEqual(rewindToPrep(m), { ok: true, round: 3 });
  assert.equal(fingerprint(m), atPrep);
  checkInvariants(m);
  h.runToEnd();
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  assert.match(rewindToPrep(m).error, /结束/);
  m.dispose();
});

test('自选编队 (0.2.0): the DIY stock is rewound in place, the picks stay', () => {
  const PICKS = { chess_char_5_diy1_a: { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' } };
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: PICKS },
    ...[1, 2, 3].map((i) => ({ seat: i, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true }))];
  const h = makeMatch({ mode: 'coop', seats, seed: 4242 }).start().autoHumans();
  const ps = h.m.players.get('p_0');
  const stock = ps.diyStock;
  const { diy, gd } = ps;
  assert.deepEqual(stock.snapshot(), { chess_char_5_diy1_a: 16 });
  h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 3);
  const atPrep = fingerprint(h.m);
  assert.equal(stock.take('chess_char_5_diy1_a', 3), 3);
  h.drive(() => h.m.phase === PHASE.SETTLE && h.m.round === 3);
  assert.deepEqual(rewindToPrep(h.m), { ok: true, round: 3 });
  assert.equal(ps.diyStock, stock, 'the same DiyStock instance');
  assert.deepEqual(stock.snapshot(), { chess_char_5_diy1_a: 16 });
  assert.ok(ps.diy === diy && ps.gd === gd, 'picks and the player data view kept');
  assert.equal(fingerprint(h.m), atPrep);
  checkInvariants(h.m);
  assert.ok(h.drive(() => h.ended != null));
  assert.equal(h.m.errorCount, 0, JSON.stringify(h.m.errors));
  h.m.dispose();
});

test('潜能 / 练度 (0.2.2): the locked per-operator settings stay the same frozen object', () => {
  const OPS = { char_003_kalts: { potential: 2, cultivate: 1 } };
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, ops: OPS },
    ...[1, 2, 3].map((i) => ({ seat: i, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true }))];
  const h = makeMatch({ mode: 'coop', seats, seed: 4343 }).start().autoHumans();
  const ps = h.m.players.get('p_0');
  const ops = ps.ops;
  assert.deepEqual(ops, OPS);
  h.drive(() => h.m.phase === PHASE.SETTLE && h.m.round === 3);
  assert.deepEqual(rewindToPrep(h.m), { ok: true, round: 3 });
  assert.equal(ps.ops, ops, 'the same object');
  assert.ok(Object.isFrozen(ps.ops));
  checkInvariants(h.m);
  assert.ok(h.drive(() => h.ended != null));
  assert.equal(h.m.errorCount, 0, JSON.stringify(h.m.errors));
  h.m.dispose();
});
