import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { collectViolations } from '../../server/match/invariants.js';
import { rewindToPrep } from '../../server/match/rewind.js';
import { getReplayConfig, setReplayConfig } from '../../server/match/replay.js';
import { makeMatch, give } from './harness.js';

function scenario(context, { enabled = true, independentPools = false, donorLp = 20, otherLp = 20 } = {}) {
  const harness = makeMatch({ humans: 3, fake: true, rescueEnabled: enabled, independentPools,
    script: battle => battle.kind === 'normal' ? { leaks: { p_0: 1 } } : { survivors: { p_0: 1 } } });
  context.after(() => harness.m.dispose());
  const match = harness.m, target = harness.ps('p_0'), donor = harness.ps('p_1');
  target.lp = 1;
  donor.lp = donorLp;
  harness.ps('p_2').lp = otherLp;
  const id = [...target.pool.entries.keys()][0];
  const piece = give(match, target, id);
  match.startRound(1);
  assert.ok(harness.sched.runUntil(() => match.phase === PHASE.PREP));
  for (const player of match.order) assert.deepEqual(match.handle(player.playerId, { t: 'g.ready', ready: true }), { ok: true });
  assert.ok(harness.sched.runUntil(() => match.phase === PHASE.SETTLE));
  return { harness, match, target, donor, piece };
}

test('rescue deducts exactly 10 LP once and preserves the target stock', (context) => {
  const { harness, match, target, donor, piece } = scenario(context, { independentPools: true });
  assert.ok(target.pendingRescue);
  assert.equal(target.privateView().pendingRescue, true);
  assert.ok(match.rescueWindow.eligible.includes(donor.playerId));
  const before = target.pool.left(piece.id);
  const request = { t: 'g.rescue', playerId: target.playerId, matchId: match.publicView().matchId, round: match.round };
  assert.deepEqual(match.handle(donor.playerId, request), { ok: true });
  assert.equal(donor.lp, 10);
  assert.equal(target.lp, 1);
  assert.equal(target.alive, true);
  assert.equal(target.rescued, true);
  assert.equal(target.privateView().pendingRescue, undefined);
  assert.equal(target.pool.left(piece.id), before);
  assert.equal(match.handle(donor.playerId, request).error, 'BAD_TARGET');
  assert.deepEqual(collectViolations(match), []);
  harness.sched.advance(16000);
  assert.equal(target.alive, true);
});

test('unrescued targets are eliminated at the deadline and default mode eliminates immediately', (context) => {
  const { harness, match, target } = scenario(context);
  assert.equal(target.pendingRescue, true);
  harness.sched.advance(16000);
  assert.equal(target.pendingRescue, false);
  assert.equal(target.privateView().pendingRescue, undefined);
  assert.equal(target.alive, false);
  assert.equal(target.eliminatedRound, 1);
  assert.equal(match.handle('p_1', { t: 'g.rescue', playerId: 'p_0', matchId: match.publicView().matchId, round: 1 }).error, 'WRONG_PHASE');
});

test('disabled rescue and donors below 11 LP preserve immediate elimination', (context) => {
  for (const options of [{ enabled: false }, { donorLp: 10, otherLp: 10 }]) {
    const { match, target } = scenario(context, options);
    assert.equal(match.rescueWindow, null);
    assert.equal(target.alive, false);
    assert.equal(target.eliminatedRound, 1);
  }
});

test('stale and ineligible rescue requests cannot spend health', (context) => {
  const { match, target, donor } = scenario(context, { donorLp: 10 });
  const request = { t: 'g.rescue', playerId: target.playerId, matchId: match.publicView().matchId, round: match.round };
  assert.ok(match.rescueWindow);
  assert.equal(match.handle(donor.playerId, request).error, 'BAD_TARGET');
  assert.equal(donor.lp, 10);
  assert.equal(match.handle('p_2', { ...request, matchId: 'stale' }).error, 'WRONG_PHASE');
  assert.equal(match.handle('p_2', { ...request, round: 2 }).error, 'WRONG_PHASE');
  assert.equal(target.pendingRescue, true);
  assert.deepEqual(match.handle('p_2', request), { ok: true });
  assert.equal(match.players.get('p_2').lp, 10);
});

test('a rescued target cannot be rescued again in a later round', (context) => {
  const { harness, match, target, donor } = scenario(context);
  const request = { t: 'g.rescue', playerId: target.playerId, matchId: match.publicView().matchId, round: match.round };
  assert.deepEqual(match.handle(donor.playerId, request), { ok: true });
  assert.ok(harness.sched.runUntil(() => match.phase === PHASE.PREP && match.round === 2));
  for (const player of match.alivePlayers()) {
    if (!player.tempEmpty) player.resolveTemp();
    assert.deepEqual(match.handle(player.playerId, { t: 'g.ready', ready: true }), { ok: true });
  }
  assert.ok(harness.sched.runUntil(() => match.phase === PHASE.SETTLE && match.round === 2));
  assert.equal(target.rescued, true);
  assert.equal(target.alive, false);
  assert.equal(target.pendingRescue, false);
  assert.equal(target.eliminatedRound, 2);
});

test('rewinding during a rescue window restores the previous prep and clears the window', (context) => {
  const { harness, match, target } = scenario(context);
  assert.ok(target.pendingRescue);
  assert.deepEqual(rewindToPrep(match, 1), { ok: true, round: 1 });
  assert.equal(match.rescueWindow, null);
  assert.equal(target.pendingRescue, false);
  assert.equal(target.alive, true);
  assert.equal(target.rescued, false);
  harness.sched.advance(16000);
  assert.equal(match.phase, PHASE.PREP);
});

test('replay records a successful rescue and rewind removes the abandoned event', (context) => {
  const previous = getReplayConfig();
  setReplayConfig({ enabled: true });
  context.after(() => setReplayConfig(previous));
  const { match, target, donor } = scenario(context);
  assert.deepEqual(match.handle(donor.playerId, { t: 'g.rescue', playerId: target.playerId,
    matchId: match.publicView().matchId, round: 1 }), { ok: true });
  assert.equal(match.replay.rescueEnabled, true);
  assert.deepEqual(match.replay.rounds.find(round => round.phase === 'SETTLE').rescues,
    [{ donorId: 'p_1', targetId: 'p_0', cost: 10 }]);
  assert.deepEqual(rewindToPrep(match, 1), { ok: true, round: 1 });
  assert.ok(match.replay.rounds.every(round => round.round < 1));
});
