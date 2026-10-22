// Parallel-draft audit guards: clocks must remain independent, repeated cross-group picks are valid, and each
// living seat must finish its own six-card page. FakeBattle keeps the checks focused on the match state machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { attachAudit } from '../../server/match/audit.js';
import { makeMatch } from './harness.js';

function enterBand(h) {
  h.start();
  for (const ps of h.m.order) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.infoReady' });
  h.sched.advance(1);
  assert.equal(h.m.phase, PHASE.BAND_DRAFT);
}

test('audit preserves the requested strategy group and accepts equal strategies in different groups', () => {
  const h = makeMatch({ humans: 6, seed: 1781, fake: true });
  const m = h.m;
  const audit = attachAudit(m);
  try {
    enterBand(h);
    const [a, b] = m.draft.groups;
    const aTimer = a.timer;
    const aDeadline = a.turnDeadline;
    const pa = a.order[a.idx];
    const pb = b.order[b.idx];
    h.sched.advance(3000);
    assert.deepEqual(m.handle(pb, { t: 'g.band', bandId: 'band_amiya' }), { ok: true });
    assert.equal(b.idx, 1, 'the audit wrapper advances B, rather than A');
    assert.equal(a.idx, 0);
    assert.equal(a.timer, aTimer);
    assert.equal(a.turnDeadline, aDeadline);
    assert.deepEqual(m.handle(pa, { t: 'g.band', bandId: 'band_amiya' }), { ok: true });
    assert.equal(m.deadline, 0);
    assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  } finally { m.dispose(); }
});

test('audit detects resetting another strategy group clock', () => {
  const h = makeMatch({ humans: 6, seed: 1782, fake: true });
  const m = h.m;
  const start = m.startDraftTurn.bind(m);
  m.startDraftTurn = (group) => {
    const res = start(group);
    if (group?.id === 2) m.draft.groups[0].turnDeadline++;
    return res;
  };
  const audit = attachAudit(m);
  try {
    enterBand(h);
    assert.ok(audit.violations.some((v) => /BAND_DRAFT group 2: changed group 1's clock/.test(v)), audit.violations.join('\n'));
  } finally { m.dispose(); }
});

test('audit preserves the requested machine-change group and its other group clock', () => {
  const h = makeMatch({ humans: 6, seed: 1783, fake: true });
  const m = h.m;
  const audit = attachAudit(m);
  try {
    h.start();
    h.drive(() => m.phase === PHASE.ROUND_START && m.round === 3);
    h.runToPhase(PHASE.SP_DRAFT, 3);
    const [a, b] = m.sp.groups;
    const aTimer = a.timer;
    const aDeadline = a.turnDeadline;
    const pb = b.order[b.idx];
    h.sched.advance(3000);
    assert.deepEqual(m.handle(pb, { t: 'g.choice', idx: b.cards[0].idx }), { ok: true });
    assert.equal(b.idx, 1, 'the audit wrapper advances B, rather than A');
    assert.equal(a.idx, 0);
    assert.equal(a.timer, aTimer);
    assert.equal(a.turnDeadline, aDeadline);
    assert.equal(m.deadline, 0);
    assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  } finally { m.dispose(); }
});

test('audit flags a group-local card map corrupted into another group picker', () => {
  const h = makeMatch({ humans: 6, seed: 1784, fake: true });
  const m = h.m;
  try {
    h.start();
    h.drive(() => m.phase === PHASE.ROUND_START && m.round === 3);
    h.runToPhase(PHASE.SP_DRAFT, 3);
    const stage = m.sp;
    for (const g of stage.groups) while (!g.done) {
      const pid = g.order[g.idx];
      const idx = g.cards.find((c) => g.taken[c.idx] == null).idx;
      assert.deepEqual(m.handle(pid, { t: 'g.choice', idx }), { ok: true });
    }
    const [a, b] = stage.groups;
    const pb = b.order[0];
    b.taken[b.picks[pb]] = a.order[0];
    const audit = attachAudit(m, { invariants: false });
    h.sched.advance(1);
    assert.equal(m.phase, PHASE.PREP);
    assert.ok(audit.violations.some((v) => v.includes(`${pb} picked card`) && v.includes('in group 2')), audit.violations.join('\n'));
  } finally { m.dispose(); }
});

test('audit accepts an empty fixed group without a machine-change page after its members leave', () => {
  const h = makeMatch({ humans: 6, seed: 1785, fake: true });
  const m = h.m;
  const audit = attachAudit(m);
  try {
    h.start();
    h.toPrep(1);
    for (const pid of m.poolGroups[0].playerIds) m.onLeave(pid);
    assert.ok(h.drive(() => m.phase === PHASE.SP_DRAFT && m.round === 3));
    const stage = m.sp;
    assert.equal(stage.groups[0].cards.length, 0);
    assert.equal(stage.groups[0].order.length, 0);
    assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === 3));
    assert.equal(Object.keys(stage.picks).length, 3);
    assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  } finally { m.dispose(); }
});

for (const count of [6, 9, 20]) {
  test(`audit accepts ${count} seats through all parallel choice rounds with FakeBattle`, () => {
    const h = makeMatch({ humans: 2, bots: count - 2, difficulty: 'ABYSS', seed: 1790 + count, fake: true,
      script: (b) => b.kind === 'boss' ? { bossDps: 5000 } : {} });
    const m = h.m;
    const audit = attachAudit(m);
    const drafts = [];
    const finish = m.finishSpDraft.bind(m);
    m.finishSpDraft = () => {
      if (m.phase === PHASE.SP_DRAFT) drafts.push({ round: m.round, groups: m.sp.groups.length,
        picks: Object.keys(m.sp.picks).length, cards: m.sp.groups.map((g) => g.cards.length) });
      return finish();
    };
    try {
      h.autoHumans().start();
      h.runToEnd({ maxSteps: 3e6 });
      assert.deepEqual(drafts.map((d) => d.round), m.gd.spRounds());
      assert.ok(drafts.every((d) => d.groups === m.poolGroups.length && d.picks === count && d.cards.every((n) => n === 6)));
      assert.equal(m.errorCount, 0);
      assert.deepEqual(h.sched.errors, []);
      assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
    } finally { m.dispose(); }
  });
}

test('audit accepts the original solo training six-card machine-change exception', () => {
  const h = makeMatch({ mode: 'solo', modeId: 'mode_training_1', seed: 1820, fake: true,
    script: (b) => b.kind === 'boss' ? { bossDps: 5000 } : {} });
  const m = h.m;
  const audit = attachAudit(m);
  const counts = [];
  const finish = m.finishSpDraft.bind(m);
  m.finishSpDraft = () => {
    if (m.phase === PHASE.SP_DRAFT) counts.push(m.sp.groups[0].cards.length);
    return finish();
  };
  try {
    h.autoHumans().start();
    h.runToPhase(PHASE.PREP, 3);
    assert.ok(counts.includes(6), 'the training supply round has six cards');
    assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  } finally { m.dispose(); }
});
