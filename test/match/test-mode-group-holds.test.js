import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';

test('test timers off hold every parallel group draft turn (multi-slot _testDraftHolds)', () => {
  const h = makeMatch({ humans: 8, bots: 0, fake: true, test: true, seed: 3 });
  h.start();
  assert.ok(h.run(() => h.m.phase === PHASE.SP_DRAFT || h.m.phase === PHASE.BAND_DRAFT || h.m.phase === PHASE.PREP),
    'reaches a draft or prep');
  // Prefer a multi-group SP draft when the schedule has one; otherwise band draft groups.
  if (h.m.phase !== PHASE.SP_DRAFT && h.m.phase !== PHASE.BAND_DRAFT) {
    // Force a later SP draft if R1 had none.
    assert.ok(h.run(() => h.m.phase === PHASE.SP_DRAFT), 'reaches SP_DRAFT');
  }
  const stage = h.m.phase === PHASE.SP_DRAFT ? h.m.sp : h.m.draft;
  assert.ok(stage && stage.groups.length >= 2, `multi-group stage (got ${stage?.groups?.length})`);
  assert.equal(h.m.testTimers, true);
  h.m.handle('p_0', { t: 'g.test', cmd: 'timers', args: { on: false } });
  assert.equal(h.m.testTimers, false);
  assert.ok(h.m._testDraftHolds.size >= 1, 'each live group turn is held');
  for (const g of stage.groups) assert.equal(g.timer, null, 'no live group timer while held');
  const before = stage.groups.map((g) => g.idx);
  const adv = h.m.handle('p_0', { t: 'g.test', cmd: 'phase', args: { name: 'advance' } });
  assert.ok(adv.ok, `advance fires one held turn (${JSON.stringify(adv)})`);
  const after = stage.groups.map((g) => g.idx);
  assert.ok(after.some((v, i) => v !== before[i] || stage.groups[i].done), 'one group progressed');
  h.m.handle('p_0', { t: 'g.test', cmd: 'timers', args: { on: true } });
  assert.equal(h.m.testTimers, true);
  h.m.dispose();
});

for (const humans of [4, 8]) for (const phase of [PHASE.BAND_DRAFT, PHASE.SP_DRAFT]) {
  test(`${humans} players: ${phase} timer toggle restores every countdown with one scale`, () => {
    const h = makeMatch({ humans, fake: true, test: true, timerScale: 0.5, seed: 3 });
    const m = h.m;
    try {
      h.start();
      if (phase === PHASE.BAND_DRAFT) assert.ok(h.run(() => m.phase === phase));
      else { h.toPrep(); m.round = m.gd.spRounds()[0]; m.enterSpDraft(); }
      const stage = phase === PHASE.BAND_DRAFT ? m.draft : m.sp;
      assert.ok(stage.groups.every((g) => !g.done && g.turnSeconds > 0));
      assert.ok(m._testTimers(false).ok);
      for (const g of stage.groups) assert.equal(g.turnDeadline, 0, 'held turns have no countdown');
      assert.ok(m._testTimers(true).ok);
      for (const g of stage.groups) {
        assert.equal(g.turnDeadline - m.sched.gameNow(), g.turnSeconds * 1000, 'deadline matches the armed delay');
      }
      assert.equal(m.deadline, humans === 4 ? stage.groups[0].turnDeadline : 0);
    } finally { m.dispose(); }
  });
}
