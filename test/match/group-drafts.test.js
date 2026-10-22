import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE } from '../../shared/constants.js';
import { BAND_TURN_SECONDS } from '../../server/match/Match.js';
import { tacticCard } from '../../server/match/choices.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';

const BAND_MS = BAND_TURN_SECONDS * 1000;

function bandMatch(options = {}) {
  const h = makeMatch({ humans: 6, seed: 63, fake: true, ...options }).start();
  for (const ps of h.m.order) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.infoReady' });
  h.sched.advance(1);
  assert.equal(h.m.phase, PHASE.BAND_DRAFT);
  return h;
}

function finishBandGroup(m, group) {
  while (!group.done) {
    const pid = group.order[group.idx];
    const bandId = m.gd.bandIds().find((id) => !m.bandTaken(id, pid));
    assert.ok(bandId, `group ${group.id} has a free strategy`);
    assert.deepEqual(m.handle(pid, { t: 'g.band', bandId, draftId: m.draft.id, groupId: group.id }), { ok: true });
  }
}

for (const count of [5, 6, 9, 10, 17, 20]) {
  test(`strategy groups: ${count} players draft in parallel and finish at an all-group barrier`, () => {
    const h = bandMatch({ humans: count });
    const m = h.m;
    try {
      const stage = m.draft;
      assert.deepEqual(stage.groups.map((g) => g.playerIds), m.poolGroups.map((g) => g.playerIds));
      assert.equal(new Set(stage.groups.map((g) => m.draftTurn(g.playerIds[0]))).size, stage.groups.length);
      assert.equal(m.deadline > 0, stage.groups.length === 1);
      for (const [index, group] of stage.groups.entries()) {
        finishBandGroup(m, group);
        if (index < stage.groups.length - 1) {
          h.sched.advance(1);
          assert.equal(m.phase, PHASE.BAND_DRAFT, 'a finished group waits for the remaining groups');
        }
      }
      assert.equal(Object.keys(stage.picks).length, count);
      for (const g of stage.groups) assert.equal(new Set(Object.values(g.picks)).size, g.order.length, 'no group-local duplicate');
      h.sched.advance(1);
      assert.equal(m.phase, PHASE.BATTLE_CHECK);
      assert.equal(m.errorCount, 0);
      checkInvariants(m);
    } finally { m.dispose(); }
  });
}

test('strategy uniqueness is group-local; repeated, other-page and stale-stage requests are rejected', () => {
  const h = bandMatch();
  const m = h.m;
  try {
    const [a, b] = m.draft.groups;
    const pa = m.draftTurn(a.playerIds[0]);
    const pb = m.draftTurn(b.playerIds[0]);
    const bandId = m.gd.bandIds()[0];
    assert.equal(m.handle(pa, { t: 'g.band', bandId, groupId: b.id }).error, ERR.BAD_TARGET);
    assert.equal(m.handle(pa, { t: 'g.band', bandId, draftId: 'previous-band' }).error, ERR.WRONG_PHASE);
    assert.equal(m.handle(pa, { t: 'g.bandFocus', bandId, groupId: b.id }).error, ERR.BAD_TARGET);
    assert.equal(m.handle(pa, { t: 'g.bandSkip', draftId: 'previous-band' }).error, ERR.WRONG_PHASE);
    assert.deepEqual(m.handle(pa, { t: 'g.band', bandId }), { ok: true });
    assert.deepEqual(m.handle(pb, { t: 'g.band', bandId }), { ok: true }, 'another group may take the same strategy');
    assert.equal(m.handle(pa, { t: 'g.band', bandId }).error, ERR.ALREADY);
    assert.equal(m.handle(m.draftTurn(pa), { t: 'g.band', bandId }).error, ERR.BAD_TARGET);
    assert.equal(Object.keys(m.draft.picks).length, 2);
  } finally { m.dispose(); }
});

test('public draft views expose every independent current picker and no scheduler handles', () => {
  const band = bandMatch();
  try {
    const m = band.m;
    const pub = m.publicView();
    assert.equal(pub.draft.id, m.draft.id);
    assert.equal(pub.draft.groups.length, 2);
    for (const g of pub.draft.groups) {
      assert.equal(g.turn, m.draftTurn(g.playerIds[0]));
      assert.equal(pub.players.find((p) => p.playerId === g.turn).status, 'deciding');
      assert.equal('timer' in g, false);
    }
    assert.doesNotThrow(() => JSON.stringify(pub));
  } finally { band.m.dispose(); }
  const special = spMatch();
  try {
    const m = special.m;
    const pub = m.publicView();
    assert.equal(pub.sp.id, m.sp.id);
    assert.equal(pub.sp.groups.length, 2);
    for (const g of pub.sp.groups) {
      assert.equal(g.turn, m.spTurn(g.playerIds[0]));
      assert.equal(g.cards.length, 6);
      assert.equal(pub.players.find((p) => p.playerId === g.turn).status, 'deciding');
      assert.equal('timer' in g, false);
    }
    assert.doesNotThrow(() => JSON.stringify(pub));
  } finally { special.m.dispose(); }
});

test('strategy group clocks progress independently and no group resets another group deadline', () => {
  const h = bandMatch();
  const m = h.m;
  try {
    const [a, b] = m.draft.groups;
    const pb = m.draftTurn(b.playerIds[0]);
    const bDeadline = b.turnDeadline;
    const bTimer = b.timer;
    h.sched.advance(10_000);
    const pa = m.draftTurn(a.playerIds[0]);
    assert.deepEqual(m.handle(pa, { t: 'g.band', bandId: m.gd.bandIds()[0] }), { ok: true });
    const nextA = m.draftTurn(pa);
    assert.equal(b.turnDeadline, bDeadline);
    assert.equal(b.timer, bTimer);
    assert.equal(a.turnDeadline, h.sched.now() + BAND_MS);
    h.sched.advance(bDeadline - h.sched.now() + 1);
    assert.ok(m.draft.picks[pb], 'only the other group first picker timed out');
    assert.equal(m.draft.picks[nextA], undefined);
    assert.equal(m.draftTurn(pa), nextA);
    assert.equal(m.deadline, 0, 'parallel groups do not publish a misleading global countdown');
  } finally { m.dispose(); }
});

test('strategy manual priority, skip, disconnect, reconnect and autoplay only reorder the affected group', () => {
  const seats = ['p_0', 'p_1', 'ai_0', 'p_2', 'p_3', 'ai_1'].map((playerId, seat) => ({
    seat, playerId, name: playerId, isBot: playerId.startsWith('ai_'), connected: true,
  }));
  const h = bandMatch({ seats, seed: 38 });
  const m = h.m;
  try {
    const [a, b] = m.draft.groups;
    const first = m.draftTurn(a.playerIds[0]);
    const second = a.order[1];
    assert.deepEqual(a.order.slice(0, 2).slice().sort(), ['p_0', 'p_1']);
    assert.equal(a.order[2], 'ai_0');
    const otherOrder = b.order.slice();
    const otherDeadline = b.turnDeadline;
    const otherTimer = b.timer;
    assert.deepEqual(m.handle(first, { t: 'g.bandSkip' }), { ok: true });
    assert.deepEqual(a.order, [second, first, 'ai_0']);
    m.onDisconnect(second);
    assert.equal(m.draftTurn(first), first);
    m.onReconnect(second);
    assert.deepEqual(a.order.slice(0, 2), [first, second]);
    assert.deepEqual(m.handle(first, { t: 'g.autoplay', on: true }), { ok: true });
    assert.equal(m.draftTurn(first), second);
    assert.deepEqual(m.handle(first, { t: 'g.autoplay', on: false }), { ok: true });
    assert.deepEqual(a.order.slice(0, 2), [second, first]);
    assert.deepEqual(b.order, otherOrder);
    assert.equal(b.turnDeadline, otherDeadline);
    assert.equal(b.timer, otherTimer);
  } finally { m.dispose(); }
});

test('an AI-only strategy group completes while another group waits indefinitely for its sole human', () => {
  const h = bandMatch({ humans: 1, bots: 19 });
  const m = h.m;
  try {
    h.sched.advance(60_000);
    assert.equal(m.phase, PHASE.BAND_DRAFT);
    const own = m.draftGroup('p_0');
    assert.equal(m.draftTurn('p_0'), 'p_0');
    assert.ok(!own.done);
    assert.ok(m.draft.groups.filter((g) => g !== own).every((g) => g.done && g.turnDeadline === 0));
    assert.ok(m.draft.groups.every((g) => g.untimed));
    assert.deepEqual(m.handle('p_0', { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
    h.sched.advance(1);
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    assert.equal(Object.keys(m.draft.picks).length, 20);
    assert.equal(m.errorCount, 0);
  } finally { m.dispose(); }
});

test('departed and eliminated strategy groups never block remaining live groups', () => {
  const h = bandMatch();
  const m = h.m;
  try {
    const [a, b] = m.draft.groups;
    for (const pid of a.playerIds) m.onLeave(pid);
    assert.ok(a.done);
    assert.equal(m.phase, PHASE.BAND_DRAFT);
    finishBandGroup(m, b);
    h.sched.advance(1);
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    assert.ok(a.playerIds.every((pid) => m.players.get(pid).left));
    assert.equal(m.errorCount, 0);
  } finally { m.dispose(); }
  const before = makeMatch({ humans: 6, seed: 77, fake: true }).start();
  try {
    const [empty, live] = before.m.poolGroups;
    for (const pid of empty.playerIds) before.m.onLeave(pid);
    for (const pid of live.playerIds) before.m.handle(pid, { t: 'g.infoReady' });
    before.sched.advance(1);
    assert.deepEqual(before.m.draft.groups[0].order, []);
    assert.ok(before.m.draft.groups[0].done);
    finishBandGroup(before.m, before.m.draft.groups[1]);
    before.sched.advance(1);
    assert.equal(before.m.phase, PHASE.BATTLE_CHECK);
    assert.equal(before.m.errorCount, 0);
  } finally { before.m.dispose(); }
});

test('parallel strategy timeouts take only the longest group duration', () => {
  const h = bandMatch({ humans: 20 });
  const m = h.m;
  try {
    const start = h.sched.now();
    assert.ok(h.run(() => m.phase !== PHASE.BAND_DRAFT, { maxTime: 5 * BAND_MS }));
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    assert.ok(h.sched.now() - start >= 4 * BAND_MS - 5 && h.sched.now() - start <= 4 * BAND_MS + 5);
    assert.equal(Object.keys(m.draft.picks).length, 20);
    assert.equal(m.errorCount, 0);
  } finally { m.dispose(); }
});

function spMatch(options = {}) {
  const modeId = 'mode_multi_normal';
  const schedule = DATA.choices.schedule[modeId];
  const data = { ...DATA, choices: { ...DATA.choices, schedule: { ...DATA.choices.schedule,
    [modeId]: { ...schedule, rounds: { ...schedule.rounds,
      3: { ...schedule.rounds[3], families: [{ family: options.family || 'supply', weight: 1 }] },
    } },
  } } };
  const h = makeMatch({ humans: 6, seed: 84, fake: true, data, ...options });
  h.m.round = 3;
  h.m.enterSpDraft();
  assert.equal(h.m.phase, PHASE.SP_DRAFT);
  return h;
}

function finishSpGroup(m, group) {
  while (!group.done) {
    const pid = group.order[group.idx];
    const idx = group.cards.find((c) => group.taken[c.idx] == null)?.idx;
    assert.notEqual(idx, undefined, 'each remaining member has a card');
    assert.deepEqual(m.handle(pid, { t: 'g.choice', idx, draftId: m.sp.id, groupId: group.id }), { ok: true });
  }
}

for (const count of [5, 6, 9, 10, 17, 20]) {
  test(`机变 groups: ${count} players each receive one of their group six slots at an all-group barrier`, () => {
    const h = spMatch({ humans: count });
    const m = h.m;
    try {
      const stage = m.sp;
      assert.deepEqual(stage.groups.map((g) => g.playerIds), m.poolGroups.map((g) => g.playerIds));
      assert.ok(stage.groups.every((g) => g.cards.length === 6));
      assert.equal(new Set(stage.groups.map((g) => m.spTurn(g.playerIds[0]))).size, stage.groups.length);
      for (const [index, group] of stage.groups.entries()) {
        finishSpGroup(m, group);
        if (index < stage.groups.length - 1) {
          h.sched.advance(1);
          assert.equal(m.phase, PHASE.SP_DRAFT, 'a finished page must wait for all remaining pages');
        }
      }
      assert.equal(Object.keys(stage.picks).length, count);
      for (const g of stage.groups) {
        assert.equal(Object.keys(g.taken).length, g.order.length);
        assert.equal(new Set(Object.values(g.picks)).size, g.order.length, 'one use of each position within a group');
        assert.ok(g.playerIds.every((pid) => m.players.get(pid).hand.filter(Boolean).length === 1));
      }
      h.sched.advance(1);
      assert.equal(m.phase, PHASE.PREP);
      assert.equal(m.errorCount, 0);
      checkInvariants(m);
    } finally { m.dispose(); }
  });
}

test('机变 card positions and rewards are group-local, with repeat, foreign-page and stale requests rejected', () => {
  const h = spMatch();
  const m = h.m;
  try {
    const [a, b] = m.sp.groups;
    const pa = m.spTurn(a.playerIds[0]);
    const pb = m.spTurn(b.playerIds[0]);
    assert.equal(m.handle(pa, { t: 'g.choice', idx: 0, groupId: b.id }).error, ERR.BAD_TARGET);
    assert.equal(m.handle(pa, { t: 'g.choice', idx: 0, draftId: 'previous-sp' }).error, ERR.WRONG_PHASE);
    assert.deepEqual(m.handle(pa, { t: 'g.choice', idx: 0 }), { ok: true });
    assert.deepEqual(m.handle(pb, { t: 'g.choice', idx: 0 }), { ok: true });
    assert.equal(a.taken[0], pa);
    assert.equal(b.taken[0], pb);
    assert.equal(m.handle(pa, { t: 'g.choice', idx: 1 }).error, ERR.ALREADY);
    assert.equal(m.handle(m.spTurn(pa), { t: 'g.choice', idx: 0 }).error, ERR.SOLD_OUT);
    assert.equal(m.handle(m.spTurn(pa), { t: 'g.choice', idx: 6 }).error, ERR.BAD_TARGET);
    assert.equal(m.players.get(pa).hand.filter(Boolean).length, 1, 'a duplicate request cannot grant another item');
    assert.equal(Object.keys(m.sp.picks).length, 2);
  } finally { m.dispose(); }
});

test('a team tactic still reaches alive players across all fixed groups exactly once for each accepted pick', () => {
  const h = spMatch({ family: 'tactic' });
  const m = h.m;
  try {
    const [a, b] = m.sp.groups;
    const wealth = { ...tacticCard(DATA.choices.cards.tactic.find((c) => c.effectId === 'allybuff_select_3')), idx: 0, family: 'tactic' };
    a.cards[0] = { ...wealth };
    b.cards[0] = { ...wealth };
    const pa = m.spTurn(a.playerIds[0]);
    const pb = m.spTurn(b.playerIds[0]);
    const funds = new Map(m.order.map((ps) => [ps.playerId, ps.funds]));
    assert.deepEqual(m.handle(pa, { t: 'g.choice', idx: 0 }), { ok: true });
    for (const ps of m.order) assert.equal(ps.funds, funds.get(ps.playerId) + 1, 'the other group also receives the team card');
    assert.equal(m.handle(pa, { t: 'g.choice', idx: 0 }).error, ERR.ALREADY);
    for (const ps of m.order) assert.equal(ps.funds, funds.get(ps.playerId) + 1, 'repeated requests do not repeat global rewards');
    assert.deepEqual(m.handle(pb, { t: 'g.choice', idx: 0 }), { ok: true });
    for (const ps of m.order) assert.equal(ps.funds, funds.get(ps.playerId) + 2, 'another group may independently pick the same global support');
  } finally { m.dispose(); }
});

test('机变 group clocks keep 30/16 seconds and another page timeout cannot reset or advance this page', () => {
  const h = spMatch();
  const m = h.m;
  try {
    const [a, b] = m.sp.groups;
    const pb = m.spTurn(b.playerIds[0]);
    assert.equal(a.turnSeconds, 30);
    assert.equal(b.turnSeconds, 30);
    const bDeadline = b.turnDeadline;
    const bTimer = b.timer;
    h.sched.advance(10_000);
    const pa = m.spTurn(a.playerIds[0]);
    assert.deepEqual(m.handle(pa, { t: 'g.choice', idx: 0 }), { ok: true });
    assert.equal(a.turnSeconds, 16);
    assert.equal(a.turnDeadline, h.sched.now() + 16_000);
    assert.equal(b.turnDeadline, bDeadline);
    assert.equal(b.timer, bTimer);
    h.sched.advance(16_001);
    assert.equal(Object.keys(a.picks).length, 2);
    assert.equal(m.sp.picks[pb], undefined);
    const nextA = m.spTurn(pa);
    const nextDeadline = a.turnDeadline;
    h.sched.advance(bDeadline - h.sched.now() + 1);
    assert.notEqual(m.sp.picks[pb], undefined);
    assert.equal(m.spTurn(pa), nextA);
    assert.equal(a.turnDeadline, nextDeadline);
    assert.equal(m.deadline, 0);
  } finally { m.dispose(); }
});

test('机变 manual priority and connectivity changes are local; pending and current exits do not block the group', () => {
  const seats = ['p_0', 'p_1', 'ai_0', 'p_2', 'p_3', 'ai_1'].map((playerId, seat) => ({
    seat, playerId, name: playerId, isBot: playerId.startsWith('ai_'), connected: true,
  }));
  const h = spMatch({ seats });
  const m = h.m;
  try {
    const [a, b] = m.sp.groups;
    const first = m.spTurn(a.playerIds[0]);
    const second = a.order[1];
    const bOrder = b.order.slice();
    const bDeadline = b.turnDeadline;
    const bTimer = b.timer;
    assert.deepEqual(a.order.slice(0, 2).slice().sort(), ['p_0', 'p_1']);
    m.onDisconnect(first);
    assert.equal(m.spTurn(first), second);
    m.onReconnect(first);
    assert.deepEqual(a.order.slice(0, 2), [second, first]);
    assert.deepEqual(m.handle(second, { t: 'g.autoplay', on: true }), { ok: true });
    assert.equal(m.spTurn(second), first);
    assert.deepEqual(m.handle(second, { t: 'g.autoplay', on: false }), { ok: true });
    assert.deepEqual(a.order.slice(0, 2), [first, second]);
    assert.deepEqual(b.order, bOrder);
    assert.equal(b.turnDeadline, bDeadline);
    assert.equal(b.timer, bTimer);
    m.onLeave(second);
    m.onLeave(first);
    h.sched.advance(901);
    assert.ok(a.done, 'only its surviving AI takes a card and completes');
    assert.equal(m.sp.picks[first], undefined);
    assert.equal(m.sp.picks[second], undefined);
    assert.equal(Object.keys(a.picks).length, 1);
    assert.equal(m.phase, PHASE.SP_DRAFT, 'another group still waits');
  } finally { m.dispose(); }
});

test('机变 empty eliminated groups are done without reassigning their fixed membership', () => {
  const h = makeMatch({ humans: 6, seed: 92, fake: true });
  const m = h.m;
  try {
    for (const pid of m.poolGroups[0].playerIds) m.players.get(pid).eliminate(1);
    m.round = 3;
    m.enterSpDraft();
    const stage = m.sp;
    const [empty, live] = stage.groups;
    assert.equal(empty.id, m.poolGroups[0].id);
    assert.deepEqual(empty.playerIds, m.poolGroups[0].playerIds);
    assert.deepEqual(empty.order, []);
    assert.ok(empty.done);
    assert.equal(empty.turnDeadline, 0);
    finishSpGroup(m, live);
    h.sched.advance(1);
    assert.equal(m.phase, PHASE.PREP);
    assert.equal(Object.keys(stage.picks).length, 3);
    assert.equal(m.errorCount, 0);
  } finally { m.dispose(); }
});

test('机变 pure AI groups finish independently and solo remains an untimed three-card draft', () => {
  const h = spMatch({ humans: 1, bots: 19 });
  const m = h.m;
  try {
    const stage = m.sp;
    h.sched.advance(10_000);
    const own = m.spGroup('p_0');
    assert.equal(m.spTurn('p_0'), 'p_0');
    assert.ok(m.sp.groups.filter((g) => g !== own).every((g) => g.done && g.turnDeadline === 0));
    assert.ok(m.sp.groups.every((g) => g.untimed));
    h.sched.advance(60_000);
    assert.equal(m.phase, PHASE.SP_DRAFT);
    assert.deepEqual(m.handle('p_0', { t: 'g.choice', idx: 0 }), { ok: true });
    h.sched.advance(3_000);
    assert.equal(m.phase, PHASE.PREP);
    assert.equal(Object.keys(stage.picks).length, 20);
    assert.equal(m.errorCount, 0);
  } finally { m.dispose(); }
  const solo = makeMatch({ mode: 'solo', seed: 91, fake: true });
  try {
    solo.m.round = 6;
    solo.m.enterSpDraft();
    assert.equal(solo.m.sp.groups.length, 1);
    assert.equal(solo.m.sp.cards.length, 3);
    assert.equal(solo.m.sp.turnDeadline, 0);
    solo.sched.advance(60_000);
    assert.equal(solo.m.phase, PHASE.SP_DRAFT);
    assert.deepEqual(solo.m.handle('p_0', { t: 'g.choice', idx: 0 }), { ok: true });
    solo.sched.advance(1);
    assert.equal(solo.m.phase, PHASE.PREP);
    assert.equal(solo.m.errorCount, 0);
  } finally { solo.m.dispose(); }
});

test('parallel 20-human 机变 timeouts last 30 + 3 × 16 seconds and each player receives one card', () => {
  const h = spMatch({ humans: 20 });
  const m = h.m;
  try {
    const stage = m.sp;
    const start = h.sched.now();
    assert.ok(h.run(() => m.phase !== PHASE.SP_DRAFT, { maxTime: 90_000 }));
    assert.equal(m.phase, PHASE.PREP);
    assert.equal(h.sched.now() - start, 78_000);
    assert.equal(Object.keys(stage.picks).length, 20);
    assert.equal(m.errorCount, 0);
  } finally { m.dispose(); }
});

test('stage identities are fresh without consuming the chess/equipment uid counter; single-group facades are writable', () => {
  const h = bandMatch({ humans: 4 });
  const m = h.m;
  try {
    const bandId = m.draft.id;
    assert.equal(m.uidSeq, 0);
    assert.equal(m.draft.order, m.draft.groups[0].order);
    finishBandGroup(m, m.draft.groups[0]);
    h.sched.advance(1);
    m.round = 3;
    m.enterSpDraft();
    const firstId = m.sp.id;
    const cards = m.sp.cards.slice();
    m.sp.cards = cards;
    assert.equal(m.sp.groups[0].cards, cards, 'old fixtures can still replace the offered cards');
    m.sp.taken = {};
    assert.equal(m.sp.groups[0].taken, m.sp.taken);
    finishSpGroup(m, m.sp.groups[0]);
    h.sched.advance(1);
    m.setDeadline(0);
    m.enterSpDraft();
    assert.notEqual(m.sp.id, firstId);
    assert.notEqual(m.sp.id, bandId);
    const current = m.spTurn();
    assert.equal(m.handle(current, { t: 'g.choice', idx: 0, draftId: firstId }).error, ERR.WRONG_PHASE);
  } finally { m.dispose(); }
});
