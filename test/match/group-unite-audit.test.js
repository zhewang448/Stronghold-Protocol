// Fixed-group Unite audit: follow only the first round's real phase transitions with FakeBattle,
// then corrupt a third-wave plan at startUnite to prove later waves receive the same guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { attachAudit } from '../../server/match/audit.js';
import { makeMatch } from './harness.js';

function uniteMatch({ humans = 14, clientCombat = false, corrupt = null } = {}) {
  const h = makeMatch({ humans, clientCombat, fake: true, seed: 8790 + humans,
    script: (battle) => battle.kind === 'normal' ? { leaks: { p_0: 3 } }
      : battle.kind === 'unite' ? { survivors: { p_0: 2 } } : {},
  });
  const m = h.m;
  const started = [];
  const start = m.startUnite.bind(m);
  // Installed before attachAudit: the auditor reads the final plan that the real start receives.
  m.startUnite = (plan) => {
    started.push(plan);
    return start(plan);
  };
  const audit = attachAudit(m);
  if (corrupt) {
    const auditedStart = m.startUnite.bind(m);
    m.startUnite = (plan) => {
      if (plan.round === 3) corrupt(plan, m);
      return auditedStart(plan);
    };
  }
  h.start();
  h.toPrep(1);
  h.ps('p_0').lp = 30;
  return { h, m, audit, started };
}

for (const clientCombat of [false, true]) {
  for (const [humans, waves] of [[10, 3], [14, 4], [20, 5]]) {
    test(`audit accepts ${waves} ${clientCombat ? 'client' : 'server'} Unite waves within the opening fixed-group budget`, () => {
      const { h, m, audit, started } = uniteMatch({ humans, clientCombat });
      try {
        assert.equal(m.poolGroups.length, waves);
        assert.ok(h.drive(() => m.phase === PHASE.SETTLE));
        assert.equal(m.round, 1, 'stop at first-round settlement, without playing the entire match');
        assert.deepEqual(started.map((plan) => plan.round), Array.from({ length: waves }, (_, i) => i + 1));
        assert.ok(started.every((plan) => plan.roundsMax === waves && plan.helpers.length === 2));
        const helpers = started.flatMap((plan) => plan.helpers.map((ps) => ps.playerId));
        assert.equal(helpers.length, waves * 2);
        assert.equal(new Set(helpers).size, helpers.length);
        assert.equal(h.ps('p_0').lp, 28, 'only the final two survivors are billed');
        assert.equal(m.errorCount, 0, JSON.stringify(h.logs.error));
        assert.deepEqual(h.sched.errors, []);
        if (clientCombat) assert.equal(m.verifyStats.rejected, 0, JSON.stringify(h.logs.warn));
        assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
      } finally { m.dispose(); }
    });
  }
}

test('audit keeps five opening-group waves valid after unused perfect teammates depart', () => {
  const { h, m, audit, started } = uniteMatch({ humans: 20 });
  try {
    assert.ok(h.drive(() => m.phase === PHASE.UNITE && m.unitePlan.round === 1));
    for (let i = 11; i < 20; i++) m.onLeave(`p_${i}`);
    assert.equal(m.alivePlayers().length, 11);
    assert.equal(m.poolGroups.length, 5);
    assert.ok(h.drive(() => m.phase === PHASE.SETTLE));
    assert.equal(m.round, 1);
    assert.deepEqual(started.map((plan) => plan.round), [1, 2, 3, 4, 5]);
    assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  } finally { m.dispose(); }
});

for (const clientCombat of [false, true]) {
  test(`audit accepts a departed leak source through later ${clientCombat ? 'client' : 'server'} Unite waves`, () => {
    const { h, m, audit, started } = uniteMatch({ clientCombat });
    try {
      assert.ok(h.drive(() => m.phase === PHASE.UNITE && m.unitePlan.round === 1));
      const source = h.ps('p_0');
      m.onLeave(source.playerId);
      assert.equal(source.left, true);
      assert.ok(h.drive(() => m.phase === PHASE.SETTLE));
      assert.equal(m.round, 1);
      assert.deepEqual(started.map((plan) => plan.round), [1, 2, 3, 4]);
      assert.ok(started.every((plan) => plan.leakers.includes(source)), 'the original enemy source remains attributable');
      assert.ok(started.slice(1).every((plan) => plan.leaked.length === 2
        && plan.leaked.every((enemy) => enemy.sourcePlayerId === source.playerId)));
      if (clientCombat) assert.equal(m.verifyStats.rejected, 0, JSON.stringify(h.logs.warn));
      assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
    } finally { m.dispose(); }
  });
}

const corruptions = [
  {
    label: 'a perfect helper reused from the first wave',
    corrupt: (plan) => { plan.helpers[0] = plan.usedHelpers[0]; },
    expected: /reused a helper across waves/,
  },
  {
    label: 'a wave number beyond the opening fixed-group cap',
    corrupt: (plan, m) => { plan.round = m.poolGroups.length + 1; },
    expected: /exceeds the fixed-group limit/,
  },
  {
    label: 'a planned maximum beyond the opening fixed-group cap',
    corrupt: (plan, m) => { plan.roundsMax = m.poolGroups.length + 1; },
    expected: /exceeds the fixed-group limit/,
  },
  {
    label: 'three helpers in one later wave',
    corrupt: (plan, m) => { plan.helpers.push(m.players.get('p_7')); },
    expected: /3 联防 helpers in one wave \(max 2\)/,
  },
  {
    label: 'too many distinct helpers accumulated across waves',
    humans: 10,
    corrupt: (plan, m) => { plan.usedHelpers.push(m.players.get('p_7')); },
    expected: /more helpers than the fixed-group budget/,
  },
  {
    label: 'a leaker selected in a later wave',
    corrupt: (plan, m) => { plan.helpers[0] = m.players.get('p_0'); },
    expected: /leaker or a non-perfect helper/,
  },
  {
    label: 'a helper whose result explicitly says non-perfect despite having no counted leaks',
    corrupt: (plan, m) => { m.lastResults.get(plan.helpers[0].playerId).perfect = false; },
    expected: /leaker or a non-perfect helper/,
  },
];

for (const { label, humans, corrupt, expected } of corruptions) {
  test(`audit detects third-wave corruption: ${label}`, () => {
    const { h, m, audit, started } = uniteMatch({ humans, corrupt });
    try {
      assert.ok(h.drive(() => started.length === 3));
      assert.equal(m.round, 1, 'the corrupted case also stops in the first round');
      assert.ok(audit.violations.some((violation) => expected.test(violation)), audit.violations.join('\n'));
      assert.ok(!audit.violations.some((violation) => violation.includes('audit unite plan threw')),
        'the auditor reports the violated rule instead of throwing');
    } finally { m.dispose(); }
  });
}
