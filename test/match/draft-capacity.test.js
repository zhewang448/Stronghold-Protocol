import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { generateDraft } from '../../server/match/choices.js';
import { createRng } from '../../server/sim/rng.js';
import { coopDraftCardCount } from '../../shared/playerCapacity.js';
import { DATA, makeMatch } from './harness.js';

function forcedData(family, round, choiceOverrides = {}) {
  const modeId = 'mode_multi_normal';
  const schedule = DATA.choices.schedule[modeId];
  return new GameData({ ...DATA, choices: { ...DATA.choices, ...choiceOverrides, schedule: { ...DATA.choices.schedule,
    [modeId]: { ...schedule, rounds: { ...schedule.rounds,
      [round]: { ...schedule.rounds[round], families: [{ family, weight: 1 }] },
    } },
  } } }, modeId);
}

for (const n of [1, 4, 5, 6, 7, 8, 10, 16, 20]) {
  test(`${n} living players receive ${coopDraftCardCount(n)} choice cards in every family`, () => {
    for (const [family, round] of [['bounty', 3], ['supply', 3], ['shop', 11], ['tactic', 11]]) {
      const draft = generateDraft(forcedData(family, round), createRng(1357), round,
        { playerCount: n, stageId: 'act2autochess_m01', bondAvailable: () => true });
      assert.equal(draft.family, family);
      assert.equal(draft.cards.length, coopDraftCardCount(n), family);
      assert.deepEqual(draft.cards.map((c) => c.idx), [...Array(draft.cards.length).keys()]);
    }
  });
}

test('large rooms still draw an original six-card bounty composition without capacity-driven repeats', () => {
  const draft = generateDraft(forcedData('bounty', 3), createRng(17), 3, { playerCount: 20 });
  const counts = new Map();
  for (const card of draft.cards) counts.set(card.id, (counts.get(card.id) || 0) + 1);
  assert.equal(counts.size, 6);
  assert.deepEqual([...counts.values()], [1, 1, 1, 1, 1, 1]);
});

test('restricted bounty data never invents extra enemy entries to fill a large-room draft', () => {
  const full = generateDraft(forcedData('bounty', 3), createRng(17), 3, { playerCount: 8 });
  const only = DATA.choices.cards.bounty.find((c) => c.effectId === full.cards[0].id);
  assert.ok(only);
  const gd = forcedData('bounty', 3, { cards: { ...DATA.choices.cards, bounty: [only] } });
  const draft = generateDraft(gd, createRng(17), 3, { playerCount: 8 });
  assert.equal(draft.cards.length, 1);
  assert.ok(draft.cards.every((c) => c.id === only.effectId));
});

test('the 20-player draft has five independent six-card groups and rejects indexes outside the group page', () => {
  const h = makeMatch({ humans: 20, fake: true });
  const m = h.m;
  m.round = 3;
  m.enterSpDraft();
  assert.equal(m.sp.groups.length, 5);
  assert.ok(m.sp.groups.every((g) => g.cards.length === 6));
  const group = m.sp.groups[4];
  const picker = m.spTurn(group.playerIds[0]);
  assert.notEqual(m.handle(picker, { t: 'g.choice', idx: 6 }).ok, true);
  assert.deepEqual(m.handle(picker, { t: 'g.choice', idx: 5 }), { ok: true });
  assert.equal(group.taken[5], picker);
  assert.equal(m.sp.groups[0].taken[5], undefined);
  m.dispose();
});
