import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { poolGroupSizes, uniteRoundLimit } from '../../shared/playerCapacity.js';
import { nextUnitePlan, planUnite } from '../../server/match/unite.js';
import { makeMatch } from './harness.js';
import { FakeBattle } from './fakeBattle.js';

const ids = (players) => players.map((p) => p.playerId);
const helper = (playerId, props = {}) => ({ playerId, alive: true, left: false, ...props });
const leak = (sourcePlayerId, rank, coins) => ({ enemyKey: 'enemy_a', sourcePlayerId, tag: null,
  mods: { rank, hpMul: rank + 1 }, lpr: rank, bounty: { coins, ownerPlayerId: sourcePlayerId } });

function normalLeakFixture(m, count, bountyCoins = 0) {
  const spawn = m.wave.spawns.find((s) => s.countInTotal !== false);
  assert.ok(spawn, 'the first round has a counted normal enemy');
  // FakeBattle cycles schedule entries, rather than expanding each entry's count.
  // A single counted entry keeps every scripted leak inside the client's exact multiset budget.
  m.wave = { ...m.wave, spawns: [{ ...spawn, time: 0, count, interval: 0,
    mods: { ...spawn.mods, bountyCoins } }] };
}

function directPlan(props = {}) {
  return { round: 1, roundsMax: 5, perRound: 2, helpers: [helper('h_0'), helper('h_1')],
    reserveHelpers: Array.from({ length: 8 }, (_, i) => helper(`h_${i + 2}`)),
    leakers: [helper('p_0'), helper('p_1')], notReentered: new Map([['p_0', 2]]),
    leaked: [leak('p_0', 1, 3), leak('p_0', 2, 5), leak('p_1', 1, 7)],
    history: [], usedHelpers: [], skipVotes: new Set(), skipRemaining: false, ...props };
}

function survivingResult(plan) {
  return { unspawned: [{ enemyKey: 'enemy_a', sourcePlayerId: 'p_0', tag: null }],
    perPlayer: { [plan.helpers[0].playerId]: { leaked: [
      { enemyKey: 'enemy_a', sourcePlayerId: 'p_0', tag: null, mods: { rank: 2, hpMul: 3 } },
      { enemyKey: 'enemy_a', sourcePlayerId: 'p_1', tag: null, mods: { rank: 1, hpMul: 2 } },
    ] } } };
}

test('one to twenty opening players give one to five fixed Unite waves', () => {
  const expected = [1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5];
  for (let n = 1; n <= 20; n++) {
    assert.equal(uniteRoundLimit(poolGroupSizes(n).length), expected[n - 1], `${n} opening players`);
  }
  for (const [groups, limit] of [[undefined, 1], [0, 1], [-2, 1], [6, 5], [20, 5]]) {
    assert.equal(uniteRoundLimit(groups), limit);
  }
});

test('large expanded Unite waves use the server and retain every leak beyond the client result cap', () => {
  const leaks = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`p_${i}`, 40]));
  const h = makeMatch({ humans: 20, fake: true, clientCombat: true, seed: 8690,
    script: (battle) => battle.kind === 'normal' ? { leaks } : { survivors: leaks },
  }).start();
  const m = h.m;
  try {
    h.toPrep(1);
    normalLeakFixture(m, 40);
    for (const ps of m.order) ps.lp = 100;
    assert.ok(h.drive(() => m.phase === PHASE.UNITE));
    const field = m.fields[0];
    assert.equal(m.unitePlan.leaked.length, 720);
    assert.equal(field.mode, 'server', 'a client result would silently truncate a helper after 400 leaks');
    assert.ok(h.drive(() => m.phase === PHASE.SETTLE));
    for (let i = 0; i < 18; i++) {
      assert.equal(h.ps(`p_${i}`).stats.lpLost, m.gd.lpCapPerRound);
      const history = h.ps(`p_${i}`).leakHistory.at(-1);
      assert.equal(history.enemies.reduce((n, row) => n + row.counted, 0), 40);
    }
    assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
  } finally { m.dispose(); }
});

test('the opening groups cap whole-room candidates while a shortage narrows the actual wave count', () => {
  const cases = [
    { groups: 1, perfects: 12, perRound: 2, selected: 2, waves: 1 },
    { groups: 3, perfects: 12, perRound: 2, selected: 6, waves: 3 },
    { groups: 4, perfects: 12, perRound: 2, selected: 8, waves: 4 },
    { groups: 5, perfects: 12, perRound: 2, selected: 10, waves: 5 },
    { groups: 5, perfects: 3, perRound: 2, selected: 3, waves: 2 },
    { groups: 5, perfects: 1, perRound: 2, selected: 1, waves: 1 },
    { groups: 5, perfects: 12, perRound: 1, selected: 5, waves: 5 },
    { groups: 20, perfects: 12, perRound: 2, selected: 10, waves: 5 },
  ];
  for (const c of cases) {
    const players = Array.from({ length: c.perfects + 1 }, (_, seat) => helper(`p_${seat}`, {
      seat, deployCount: 0, bonds: {}, board: new Map(), bounties: [],
    }));
    const m = { isSolo: false, poolGroups: Array.from({ length: c.groups }, () => ({})),
      alivePlayers: () => players, gd: { unite: { maxHelpers: c.perRound }, enemy: () => ({}) } };
    const results = new Map(players.map((p, i) => [p.playerId,
      { perfect: i !== 0, leaked: i === 0 ? [{ enemyKey: 'enemy_a' }] : [] }]));
    const plan = planUnite(m, results);
    assert.equal(plan.perRound, c.perRound);
    assert.equal(plan.roundsMax, c.waves, JSON.stringify(c));
    assert.deepEqual(ids([...plan.helpers, ...plan.reserveHelpers]),
      Array.from({ length: c.selected }, (_, i) => `p_${i + 1}`), 'original whole-room seat ordering is retained');
  }
});

for (const clientCombat of [false, true]) {
  for (const [humans, waves] of [[10, 3], [14, 4], [20, 5]]) {
    test(`${humans} players: ${waves} ${clientCombat ? 'client' : 'server'} Unite waves retain all rewards and bill only final survivors`, () => {
      const waveSeeds = new Map();
      const h = makeMatch({ humans, fake: true, clientCombat, seed: 8610 + humans,
        script: (battle) => {
          if (battle.kind === 'normal') return { leaks: { p_0: waves + 1 } };
          if (battle.kind !== 'unite') return {};
          // Client helpers and observers construct replicas of the same wave.
          if (!waveSeeds.has(battle.opts.seed)) waveSeeds.set(battle.opts.seed, waveSeeds.size + 1);
          const wave = waveSeeds.get(battle.opts.seed);
          return { survivors: { p_0: waves + 1 - wave },
            coins: Object.fromEntries(battle.players.map((pid, i) => [pid, wave + i])),
            damage: Object.fromEntries(battle.players.map((pid, i) => [pid, wave * 100 + i * 10])) };
        },
      }).start();
      const m = h.m;
      try {
        h.toPrep(1);
        h.ps('p_0').lp = 30;
        // Keep the scripted rewards within the client result validator's genuine spawn bounty budget.
        normalLeakFixture(m, waves + 1, 20);
        const fundsBefore = new Map(m.order.map((ps) => [ps.playerId, ps.stats.fundsGained]));
        const fields = [];
        const fought = [];
        for (let wave = 1; wave <= waves; wave++) {
          assert.ok(h.drive(() => m.phase === PHASE.UNITE && m.unitePlan.round === wave));
          const plan = m.unitePlan;
          const current = ids(plan.helpers);
          assert.deepEqual(current, [`p_${wave * 2 - 1}`, `p_${wave * 2}`]);
          assert.equal(plan.perRound, 2);
          assert.equal(plan.history.length, wave - 1);
          assert.equal(plan.leaked.length, waves + 2 - wave, 'only the preceding wave survivors re-enter');
          assert.deepEqual([m.publicView().unite.round, m.publicView().unite.roundsMax], [wave, waves]);
          fought.push(...current);
          fields.push(m.fields[0]);
        }
        assert.ok(h.drive(() => m.phase === PHASE.SETTLE));
        assert.equal(m.round, 1, 'the test stops at first-round settlement');
        assert.equal(new Set(fought).size, waves * 2, 'a perfect teammate fights at most once');
        assert.equal(new Set(FakeBattle.instances.filter((b) => b.kind === 'unite').map((b) => b.opts.seed)).size, waves);
        const groupOf = (pid) => m.poolGroups.find((g) => g.playerIds.includes(pid)).id;
        assert.notEqual(groupOf(fought[2]), groupOf(fought[3]), 'a helper pair can cross fixed pool groups');
        assert.equal(h.ps('p_0').lp, 29);
        assert.equal(h.ps('p_0').stats.lpLost, 1, 'intermediate survivors are not charged again');
        for (let wave = 1; wave <= waves; wave++) {
          for (let side = 0; side < 2; side++) {
            const ps = h.ps(`p_${wave * 2 - 1 + side}`);
            assert.equal(ps.pendingFunds, wave + side, `wave ${wave} bounty remains credited`);
            assert.equal(ps.stats.fundsGained - fundsBefore.get(ps.playerId), wave + side);
            assert.equal(ps.stats.dmgDealt, 1000 + wave * 100 + side * 10, `wave ${wave} damage remains counted`);
            assert.equal(ps.stats.kills, waves + 1 + (side === 0 ? 1 : 0), `wave ${wave} kills remain counted`);
          }
        }
        assert.deepEqual(m.publicView().uniteResult, { through: 1, helpers: fought, leakers: ['p_0'],
          losses: Object.fromEntries(m.order.map((p) => [p.playerId, p.playerId === 'p_0' ? 1 : 0])) });
        if (clientCombat) {
          assert.equal(new Set(fields.map((f) => f.battleId)).size, waves, 'each client wave has a fresh battle id');
          assert.ok(fields.every((f) => f.resultSource === 'client'), 'all waves use accepted client reports');
          assert.equal(m.verifyStats.rejected, 0, JSON.stringify(h.logs.warn));
        }
        assert.equal(m.errorCount, 0, JSON.stringify(h.logs.error));
        h.invariants();
      } finally {
        m.dispose();
      }
    });
  }
}

for (const clientCombat of [false, true]) {
  test(`${clientCombat ? 'client' : 'server'} Unite skips a departed reserve and retains four opening-group waves with eight players left`, () => {
    const waveSeeds = new Map();
    const h = makeMatch({ humans: 14, fake: true, clientCombat, seed: 8650,
      script: (battle) => {
        if (battle.kind === 'normal') return { leaks: { p_0: 5 } };
        if (battle.kind !== 'unite') return {};
        if (!waveSeeds.has(battle.opts.seed)) waveSeeds.set(battle.opts.seed, waveSeeds.size + 1);
        return { survivors: { p_0: 5 - waveSeeds.get(battle.opts.seed) } };
      },
    }).start();
    const m = h.m;
    try {
      h.toPrep(1);
      h.ps('p_0').lp = 30;
      normalLeakFixture(m, 5);
      assert.ok(h.drive(() => m.phase === PHASE.UNITE && m.unitePlan.round === 1));
      const groups = m.poolGroups.map((g) => g.playerIds.slice());
      for (const pid of ['p_3', 'p_9', 'p_10', 'p_11', 'p_12', 'p_13']) m.onLeave(pid);
      assert.equal(m.alivePlayers().length, 8);
      assert.deepEqual(m.poolGroups.map((g) => g.playerIds), groups);
      const fought = ['p_1', 'p_2'];
      for (const [wave, expected] of [[2, ['p_4', 'p_5']], [3, ['p_6', 'p_7']], [4, ['p_8']]]) {
        assert.ok(h.drive(() => m.phase === PHASE.UNITE && m.unitePlan.round === wave));
        assert.deepEqual(ids(m.unitePlan.helpers), expected);
        assert.equal(m.unitePlan.roundsMax, 4, 'departures do not recompute the opening groups');
        assert.equal(m.unitePlan.perRound, 2, 'a short final wave does not rewrite the configured capacity');
        fought.push(...expected);
      }
      assert.ok(h.drive(() => m.phase === PHASE.SETTLE));
      assert.deepEqual(m.publicView().uniteResult.helpers, fought);
      assert.equal(new Set(fought).size, 7);
      assert.equal(h.ps('p_0').lp, 29);
      assert.equal(waveSeeds.size, 4);
      if (clientCombat) assert.equal(m.verifyStats.rejected, 0, JSON.stringify(h.logs.warn));
      h.invariants();
    } finally {
      m.dispose();
    }
  });
}

test('five waves preserve duplicate enemy sources, mods, bounties and unspawned entries', () => {
  const first = directPlan();
  let plan = first;
  const results = [];
  const fought = ids(plan.helpers);
  for (let wave = 2; wave <= 5; wave++) {
    const result = survivingResult(plan);
    results.push(result);
    const next = nextUnitePlan(plan, result);
    assert.equal(next.round, wave);
    assert.deepEqual(ids(next.helpers), [`h_${wave * 2 - 2}`, `h_${wave * 2 - 1}`]);
    assert.deepEqual(next.leaked, first.leaked, 'the unspawned first duplicate cannot consume the second duplicate bounty');
    assert.deepEqual(next.notReentered, first.notReentered);
    assert.deepEqual(next.history, results, 'every completed wave remains available to settlement');
    assert.deepEqual(ids(next.usedHelpers), fought);
    fought.push(...ids(next.helpers));
    plan = next;
  }
  assert.equal(new Set(fought).size, 10);
  assert.deepEqual(plan.reserveHelpers, []);
  assert.equal(nextUnitePlan(plan, survivingResult(plan)), null, 'the fifth wave is the fixed cap');
  assert.equal(first.round, 1, 'continuation does not mutate previous wave metadata');
  assert.equal(first.history.length, 0);
  assert.equal(first.reserveHelpers.length, 8);
});

test('continuation filters departed, eliminated, already-used and duplicate reserves without lowering perRound', () => {
  const plan = directPlan({ helpers: [helper('h_1')], usedHelpers: [helper('h_0')], reserveHelpers: [
    helper('h_0'), helper('h_1'), helper('h_2', { left: true }), helper('h_3', { alive: false }),
    helper('h_4'), helper('h_4'), helper('h_5'), helper('h_6'),
  ] });
  const next = nextUnitePlan(plan, survivingResult(plan));
  assert.deepEqual(ids(next.helpers), ['h_4', 'h_5']);
  assert.equal(next.perRound, 2, 'the preceding wave had one helper but the independent capacity remains two');
  assert.deepEqual(ids(next.reserveHelpers), ['h_6']);
  assert.deepEqual(ids(next.usedHelpers), ['h_0', 'h_1']);
});

test('no remaining leaks, eligible reserve, or reliable result ends Unite immediately', () => {
  const plan = directPlan();
  assert.equal(nextUnitePlan(plan, { perPlayer: {}, unspawned: [] }), null);
  assert.equal(nextUnitePlan({ ...plan, reserveHelpers: [helper('gone', { left: true }), helper('dead', { alive: false })] },
    survivingResult(plan)), null);
  assert.equal(nextUnitePlan(plan, { ...survivingResult(plan), synthetic: true }), null);
});

test('runtime splits and summons never re-enter later Unite waves as newly billable leaks', () => {
  const plan = directPlan({ leaked: [leak('p_0', 1, 3)], notReentered: new Map() });
  const runtime = { enemyKey: 'enemy_child', sourcePlayerId: 'p_0', counted: true, uniteRuntime: true, lpr: 1 };
  assert.equal(nextUnitePlan(plan, { perPlayer: { h_0: { leaked: [runtime] } } }), null,
    'a surviving runtime child alone must not open another wave');
  const mixed = nextUnitePlan(plan, { perPlayer: { h_0: { leaked: [runtime, plan.leaked[0]] } } });
  assert.deepEqual(mixed.leaked, plan.leaked, 'only the original escaped enemy re-enters');
});
