import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { createPoolGroups } from '../../server/match/pool.js';
import { capturePrep, rewindToPrep } from '../../server/match/rewind.js';
import { installDraftFacade } from '../../server/match/match/phases.js';
import { attachAudit } from '../../server/match/audit.js';
import { makeMatch } from './harness.js';

const PACK = 'chess_item_5_07_e_a';

for (const humans of [2, 8, 20]) test(`${humans} players: independent stock preserves the ordinary draft groups`, (context) => {
  const harness = makeMatch({ humans, fake: true, independentPools: true });
  context.after(() => harness.m.dispose());
  const match = harness.m;
  const ordinary = createPoolGroups(match.gd, match.order, { banned: match.bannedChess });
  assert.equal(match.poolGroups.length, humans);
  assert.equal(new Set(match.order.map((player) => player.pool)).size, humans);
  assert.equal(new Set(match.order.map((player) => match.itemPoolFor(player))).size, humans);
  assert.deepEqual(match.draftGroups.map((group) => group.playerIds), ordinary.map((group) => group.playerIds));
  assert.deepEqual(match.publicView().poolGroups.map((group) => group.playerIds), ordinary.map((group) => group.playerIds));
  assert.equal(match.publicView().independentPools, true);
  harness.invariants();
});

test('independent operator and equipment stock follows its owner through acquisition and sale', (context) => {
  const harness = makeMatch({ humans: 2, bots: 1, fake: true, independentPools: true }).start().toPrep();
  context.after(() => harness.m.dispose());
  const match = harness.m, first = harness.ps('p_0'), second = harness.ps('p_1'), bot = harness.ps('ai_0');
  const id = [...first.pool.entries.keys()].find((entry) => match.gd.tierOf(entry) === 6 && match.gd.goldenIdOf(entry));
  const cap = first.pool.cap(id);
  for (let index = 0; index < cap; index++) assert.ok(first.acquireChess(id));
  assert.equal(first.pool.left(id), 0);
  assert.equal(second.pool.left(id), cap);
  assert.equal(bot.pool.left(id), cap);
  const elite = first.allChess().find((piece) => match.gd.baseIdOf(piece.id) === id && match.gd.isGolden(piece.id));
  assert.ok(elite);
  assert.ok(first.sell(elite.uid).ok);
  assert.equal(first.pool.left(id), 3);
  assert.equal(second.pool.left(id), cap);
  assert.ok(first.acquireItem(PACK));
  assert.ok(first.acquireItem(PACK));
  assert.equal(match.itemPoolFor(first).left(PACK), 0);
  assert.equal(match.itemPoolFor(second).left(PACK), match.itemPoolFor(second).cap(PACK));
  assert.ok(second.acquireItem(PACK));
  assert.equal(match.itemPoolFor(first).left(PACK), 0);
  harness.invariants();
});

test('draft equipment availability uses the current player stock', (context) => {
  const harness = makeMatch({ humans: 2, fake: true, independentPools: true }).start().toPrep();
  context.after(() => harness.m.dispose());
  const match = harness.m, first = harness.ps('p_0'), second = harness.ps('p_1');
  assert.ok(first.acquireItem(PACK));
  match.phase = PHASE.SP_DRAFT;
  const group = { id: 1, playerIds: ['p_0', 'p_1'], cards: [PACK, PACK, 'chess_item_1_01_e_a'].map((id, idx) => ({ idx, id, kind: 'item' })),
    order: ['p_0', 'p_1'], idx: 0, picks: {}, taken: {}, untimed: true, token: 0, done: false };
  match.sp = installDraftFacade({ id: 'sp:test', groups: [group], picks: group.picks, untimed: true }, ['cards', 'order', 'idx', 'taken', 'turnDeadline', 'turnSeconds']);
  assert.ok(match.pickCard(first, 0).ok);
  assert.equal(match.itemPoolFor(first).left(PACK), 0);
  assert.equal(match.spTurn(), 'p_1');
  assert.equal(match.publicView().sp.cards[1].soldOut, false);
  assert.ok(match.pickCard(second, 1).ok);
  assert.equal(match.itemPoolFor(second).left(PACK), 1);
  harness.invariants();
});

test('a player with no available draft card does not block the next player', (context) => {
  const harness = makeMatch({ humans: 2, fake: true, independentPools: true }).start().toPrep();
  context.after(() => harness.m.dispose());
  const match = harness.m, first = harness.ps('p_0'), second = harness.ps('p_1');
  assert.ok(first.acquireItem(PACK));
  assert.ok(first.acquireItem(PACK));
  match.phase = PHASE.SP_DRAFT;
  const group = { id: 1, playerIds: ['p_0', 'p_1'], cards: Array.from({ length: 6 }, (_unused, index) => ({ idx: index, id: PACK, kind: 'item' })),
    order: ['p_0', 'p_1'], idx: 0, picks: {}, taken: {}, untimed: false, token: 0, done: false };
  match.sp = installDraftFacade({ id: 'sp:test', groups: [group], picks: group.picks, untimed: false }, ['cards', 'order', 'idx', 'taken', 'turnDeadline', 'turnSeconds']);
  const audit = attachAudit(match);
  match.startSpTurn(group);
  assert.equal(group.done, false);
  assert.deepEqual(group.skipped, ['p_0']);
  assert.equal(match.spTurn(), 'p_1');
  assert.ok(match.pickCard(second, 0).ok);
  assert.equal(match.itemPoolFor(second).left(PACK), 1);
  match.finishSpDraft();
  assert.deepEqual(audit.violations, []);
  harness.invariants();
});

test('opening reroll and rewind retain every independent pool', (context) => {
  const harness = makeMatch({ humans: 2, bots: 1, fake: true, independentPools: true }).start();
  context.after(() => harness.m.dispose());
  const match = harness.m;
  assert.deepEqual(match.completeSetupReroll(), { ok: true });
  assert.equal(match.poolGroups.length, 3);
  assert.equal(match.draftGroups.length, 1);
  harness.toPrep();
  const snapshot = capturePrep(match);
  assert.ok(snapshot);
  match.prepSnapshots.set(match.round, snapshot);
  const before = match.poolGroups.map((group) => ({ entries: structuredClone(group.pool.entries), debt: new Map(group.itemPool.debt) }));
  for (const group of match.poolGroups) {
    group.pool.take([...group.pool.entries.keys()][0]);
    group.itemPool.debt.set('fixture', 1);
  }
  assert.deepEqual(rewindToPrep(match, match.round), { ok: true, round: match.round });
  for (const [index, group] of match.poolGroups.entries()) {
    assert.deepEqual(group.pool.entries, before[index].entries);
    assert.deepEqual(group.itemPool.debt, before[index].debt);
  }
  harness.invariants();
});

for (const bots of [2, 6]) test(`a complete independent-pool match with ${bots} bots preserves stock and draft invariants`, (context) => {
  const harness = makeMatch({ humans: 2, bots, fake: true, seed: 31, independentPools: true });
  context.after(() => harness.m.dispose());
  const audit = attachAudit(harness.m);
  harness.autoHumans().start().runToEnd({ maxSteps: 3e6 });
  assert.equal(harness.m.errorCount, 0);
  assert.deepEqual(harness.sched.errors, []);
  assert.deepEqual(audit.violations, []);
  assert.equal(harness.m.lastResultMsg.independentPools, true);
  harness.invariants();
});
