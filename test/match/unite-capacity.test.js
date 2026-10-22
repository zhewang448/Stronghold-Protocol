import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { validateC2S } from '../../shared/protocol.js';
import { nextUnitePlan } from '../../server/match/unite.js';

test('a unite progress frame reports every leaker in a twenty-player match', () => {
  const left = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p_${i}`, i + 1]));
  const msg = { t: 'b.progress', battleId: 'unite', gt: 1, killed: 0, total: 20, left };
  assert.equal(validateC2S(msg), null);
  assert.notEqual(validateC2S({ ...msg, left: { ...left, p_20: 1 } }), null);
});

for (const clientCombat of [false, true]) {
  test(`eight players: two ${clientCombat ? 'client' : 'server'} unite waves use four unique helpers and final survivors`, () => {
    const waveSeeds = new Map();
    const h = makeMatch({ humans: 8, fake: true, clientCombat, seed: 707,
      script: (battle) => {
        if (battle.kind === 'normal') return { leaks: { p_0: 6 } };
        if (battle.kind === 'unite') {
          if (!waveSeeds.has(battle.opts.seed)) waveSeeds.set(battle.opts.seed, waveSeeds.size + 1);
          const first = waveSeeds.get(battle.opts.seed) === 1;
          const helper = battle.players[0];
          return { survivors: { p_0: first ? 3 : 1 }, coins: { [helper]: first ? 5 : 7 }, damage: { [helper]: first ? 123 : 456 } };
        }
        return {};
      },
    }).start();
    const m = h.m;
    h.toPrep(1);
    h.ps('p_0').lp = 30;
    h.drive(() => m.phase === PHASE.UNITE && m.unitePlan.round === 1);
    const first = m.unitePlan.helpers.map((p) => p.playerId);
    assert.deepEqual(first, ['p_1', 'p_2']);
    assert.deepEqual(m.unitePlan.reserveHelpers.map((p) => p.playerId), ['p_3', 'p_4']);
    assert.deepEqual([m.publicView().unite.round, m.publicView().unite.roundsMax], [1, 2]);
    h.drive(() => m.phase === PHASE.UNITE && m.unitePlan.round === 2);
    const second = m.unitePlan.helpers.map((p) => p.playerId);
    assert.deepEqual(second, ['p_3', 'p_4']);
    assert.equal(new Set([...first, ...second]).size, 4);
    assert.equal(m.unitePlan.leaked.length, 3, 'only first-wave survivors re-enter');
    assert.deepEqual([m.publicView().unite.round, m.publicView().unite.roundsMax], [2, 2]);
    h.drive(() => m.phase === PHASE.SETTLE);
    assert.equal(new Set(FakeBattle.instances.filter((b) => b.kind === 'unite').map((b) => b.opts.seed)).size, 2);
    assert.equal(h.ps('p_0').lp, 29, 'only the final survivor costs the original leaker LP');
    assert.equal(h.ps('p_1').pendingFunds, 5, 'first-wave bounty credits survive second-wave settlement');
    assert.equal(h.ps('p_3').pendingFunds, 7);
    assert.ok(h.ps('p_1').stats.dmgDealt >= 123 && h.ps('p_3').stats.dmgDealt >= 456);
    assert.deepEqual(m.publicView().uniteResult, {
      through: 1, helpers: [...first, ...second], leakers: ['p_0'],
      losses: Object.fromEntries(m.order.map((p) => [p.playerId, p.playerId === 'p_0' ? 1 : 0])),
    }, 'the upstream result dialog reports both waves and the actual final LP charge');
    h.invariants();
    m.dispose();
  });
}

for (const n of [7, 8, 20]) {
  test(`${n} players: unite stops when only one helper exists or the first wave clears`, () => {
    const h = makeMatch({ humans: n, fake: true, seed: 708,
      script: (battle) => battle.kind === 'normal' ? { leaks: { p_0: 3 } } : {},
    }).start();
    const m = h.m;
    h.toPrep(1);
    h.drive(() => m.phase === PHASE.SETTLE);
    assert.equal(FakeBattle.instances.filter((b) => b.kind === 'unite').length, 1);
    assert.equal(h.ps('p_0').stats.lpLost, 0);
    h.invariants();
    m.dispose();
  });
}

test('second unite wave preserves duplicate enemies by source and mods and respects a one-helper wave limit', () => {
  const leak = (sourcePlayerId, rank, coins) => ({ enemyKey: 'enemy_a', sourcePlayerId, tag: null,
    mods: { rank }, lpr: 1, bounty: { coins, ownerPlayerId: sourcePlayerId } });
  const plan = { round: 1, roundsMax: 2, perRound: 1, helpers: [{ playerId: 'h_0' }],
    reserveHelpers: [{ playerId: 'h_1', alive: true, left: false }, { playerId: 'h_2', alive: true, left: false }],
    leakers: [{ playerId: 'p_0' }, { playerId: 'p_1' }], notReentered: new Map(),
    leaked: [leak('p_0', 1, 3), leak('p_0', 2, 5), leak('p_1', 1, 7)], history: [], usedHelpers: [] };
  const result = { unspawned: [{ enemyKey: 'enemy_a', sourcePlayerId: 'p_0', tag: null }],
    perPlayer: { h_0: { leaked: [
      { enemyKey: 'enemy_a', sourcePlayerId: 'p_0', tag: null, mods: { rank: 2 } },
      { enemyKey: 'enemy_a', sourcePlayerId: 'p_1', tag: null, mods: { rank: 1 } },
    ] } } };
  const next = nextUnitePlan(plan, result);
  assert.deepEqual(nextUnitePlan(plan, result, 7), next,
    'the old living-player argument no longer lowers the opening groups\' fixed limit');
  assert.deepEqual(next.helpers.map((p) => p.playerId), ['h_1']);
  assert.deepEqual(next.reserveHelpers.map((p) => p.playerId), ['h_2']);
  assert.deepEqual(next.leaked.map((l) => [l.sourcePlayerId, l.mods.rank, l.bounty.coins]),
    [['p_0', 1, 3], ['p_0', 2, 5], ['p_1', 1, 7]]);
});
