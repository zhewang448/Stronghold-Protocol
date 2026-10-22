import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { generateDraft, generateGroupDrafts, selectDraftFamily, reinforcementBond } from '../../server/match/choices.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA } from './harness.js';

const MODE = 'mode_multi_abyss';
const STAGE = 'act2autochess_m01';
const GROUPS = [1, 2, 3, 4, 5].map((id) => ({ id, playerIds: [0, 1, 2, 3].map((seat) => `p_${(id - 1) * 4 + seat}`) }));
const OPTIONS = { stageId: STAGE, bondAvailable: () => true };
const bountyById = new Map(DATA.choices.cards.bounty.map((c) => [c.effectId, c]));
const pageIds = (d) => d.cards.map((c) => c.id);
const signature = (d) => JSON.stringify([d.family, d.cards.map((c) => JSON.stringify([c.kind, c.id])).sort()]);

function forcedData(family, round, overrides = {}) {
  const modeId = round === 6 ? 'mode_multi_normal' : MODE;
  const schedule = DATA.choices.schedule[modeId];
  const choices = {
    ...DATA.choices,
    ...overrides,
    schedule: {
      ...DATA.choices.schedule,
      [modeId]: { ...schedule, rounds: { ...schedule.rounds,
        [round]: { ...schedule.rounds[round], families: [{ family, weight: 1 }] },
      } },
    },
  };
  return new GameData({ ...DATA, choices }, modeId);
}

test('event selection preserves the original round weights and has a supply fallback', () => {
  const gd = new GameData(DATA, MODE);
  for (const [value, family] of [[0, 'bounty'], [13.9 / 22, 'bounty'], [14.1 / 22, 'shop'], [18.1 / 22, 'tactic']]) {
    assert.equal(selectDraftFamily(gd, () => value, 11), family);
  }
  assert.equal(selectDraftFamily(gd, () => 0.99, 4), 'supply', 'a round without a schedule keeps the original fallback');
});

test('a forced family bypasses the event roll; every co-op page stays at six cards', () => {
  const gd = new GameData(DATA, MODE);
  assert.equal(selectDraftFamily(gd, createRng(1), 3), 'bounty');
  for (const family of ['bounty', 'supply', 'shop', 'tactic']) {
    const d = generateDraft(gd, createRng(101), 3, { family, stageId: STAGE, bondAvailable: () => true });
    assert.equal(d.family, family);
    assert.equal(d.cards.length, 6);
    assert.deepEqual(d.cards.map((c) => c.idx), [0, 1, 2, 3, 4, 5]);
    assert.ok(d.cards.every((c) => c.family === family));
  }
});

test('solo retains three choices and training retains its scheduled six choices', () => {
  const solo = new GameData(DATA, 'mode_single_hard');
  for (const family of ['bounty', 'supply', 'shop', 'tactic']) {
    assert.equal(generateDraft(solo, createRng(31), 11, { family, stageId: STAGE }).cards.length, 3, family);
  }
  const training = new GameData(DATA, 'mode_training_1');
  const d = generateDraft(training, createRng(31), 3);
  assert.equal(d.family, 'supply');
  assert.equal(d.cards.length, 6);
});

test('zero active groups have no pages and do not consume an event roll', () => {
  const gd = new GameData(DATA, MODE);
  const rng = createRng(1);
  const state = rng.state();
  assert.deepEqual(generateGroupDrafts(gd, rng, 3, []), []);
  assert.equal(rng.state(), state);
});

test('all group pages share one event family with stable IDs and deterministic independent draws', () => {
  const gd = new GameData(DATA, MODE);
  let differentPages = false;
  for (let seed = 1; seed <= 12; seed++) {
    const pages = generateGroupDrafts(gd, createRng(seed), 11, GROUPS, OPTIONS);
    assert.deepEqual(pages, generateGroupDrafts(gd, createRng(seed), 11, GROUPS, OPTIONS), `repeat seed ${seed}`);
    assert.deepEqual(pages.map((d) => d.id), [1, 2, 3, 4, 5]);
    assert.ok(pages.every((d) => d.cards.length === 6));
    assert.equal(new Set(pages.map((d) => d.family)).size, 1);
    if (new Set(pages.map(signature)).size > 1) differentPages = true;
  }
  assert.ok(differentPages, 'groups receive independently drawn pages rather than one copied page');
});

test('group generation consumes only one family roll for the whole match', () => {
  const gd = forcedData('supply', 3);
  const base = createRng(17);
  let calls = 0;
  const rng = () => { calls++; return base(); };
  const pages = generateGroupDrafts(gd, rng, 3, GROUPS, OPTIONS);
  assert.equal(pages.length, 5);
  assert.equal(calls, 1 + 5 * 7, 'one event-family roll, then six item rolls and one event ID per group');
});

test('each group bounty keeps the original initial, boss and hunter structure without copied cards', () => {
  for (const round of [3, 9, 11]) {
    const gd = forcedData('bounty', round);
    for (let seed = 1; seed <= 24; seed++) {
      const pages = generateGroupDrafts(gd, createRng(seed), round, GROUPS, OPTIONS);
      for (const d of pages) {
        const ids = pageIds(d);
        assert.equal(new Set(ids).size, 6, `round ${round}, group ${d.id}`);
        const records = ids.map((id) => bountyById.get(id));
        const kind = round === 3 ? 'initial' : round === 9 ? 'boss' : 'hunter';
        assert.ok(records.every((c) => c.draft && c.draftPool === kind));
        if (round === 3) {
          assert.equal(records.map((c) => c.tier).sort().join(''), '111223');
          assert.ok(d.cards.every((c) => c.rounds === 2));
        } else if (round === 9) {
          assert.ok(DATA.choices.bountyDrafts.boss.groups.some((g) => ids.every((id) => g.cards.includes(id))));
          assert.ok(d.cards.every((c) => c.rounds === 1));
        } else {
          const rule = DATA.choices.bountyDrafts.hunter.rule;
          const series = records.map((c) => c.series).filter((s) => rule.onePerSeries.includes(s));
          assert.equal(new Set(series).size, series.length);
          assert.ok(ids.filter((id) => rule.giants.includes(id)).length <= 1);
          assert.ok(d.cards.every((c) => c.rounds === 1));
        }
      }
    }
  }
});

test('each supply and secret-shop page retains its original tier range and fixed slots', () => {
  for (const [family, round] of [['supply', 3], ['supply', 6], ['supply', 9], ['shop', 11]]) {
    const gd = forcedData(family, round);
    for (let seed = 1; seed <= 16; seed++) {
      const pages = generateGroupDrafts(gd, createRng(seed), round, GROUPS, OPTIONS);
      for (const d of pages) {
        assert.ok(d.cards.every((c) => c.kind === 'item' && c.price === 0 && !DATA.items[c.id].isGolden));
        const tiers = d.cards.map((c) => DATA.items[c.id].tier);
        if (family === 'supply') {
          const [lo, hi] = gd.choices.schedule[gd.modeId].rounds[round].supplyTiers;
          assert.ok(tiers.every((tier) => tier >= lo && tier <= hi));
        } else {
          assert.equal(tiers.filter((tier) => tier === 6).length, 2);
          assert.ok(tiers.includes(5));
          assert.ok(pageIds(d).includes(DATA.choices.shopDraft.coin));
          assert.ok(d.cards.every((c) => c.id === DATA.choices.shopDraft.coin || c.tier >= 3));
        }
      }
    }
  }
});

test('group-bound tactic availability is passed through and original repeated positions remain legal', () => {
  const reinforce = DATA.choices.cards.tactic.find((c) => reinforcementBond(new GameData(DATA, MODE), c.effectId));
  const coin = DATA.choices.cards.tactic.find((c) => DATA.effects[c.effectId].buffs.some((b) => b.key === 'global_special_choice_gain_coin'));
  assert.ok(reinforce && coin);
  const bond = reinforcementBond(new GameData(DATA, MODE), reinforce.effectId);
  const gd = forcedData('tactic', 11, { cards: { ...DATA.choices.cards, tactic: [reinforce, coin] } });
  const groups = GROUPS.slice(0, 2);
  const pages = generateGroupDrafts(gd, () => 0, 11, groups, {
    ...OPTIONS,
    bondAvailable: (id, group) => {
      assert.ok(groups.includes(group), 'the original group metadata reaches the callback');
      return group.id === 1 && id === bond;
    },
  });
  assert.ok(pages[0].cards.every((c) => c.id === reinforce.effectId));
  assert.ok(pages[1].cards.every((c) => c.id === coin.effectId));
});

test('independent pages allow naturally identical initial choices and individual overlaps', () => {
  const gd = forcedData('bounty', 3);
  let foundOriginalDuplicate = false;
  for (let seed = 1; seed <= 24; seed++) {
    const ordinary = generateGroupDrafts(gd, createRng(seed), 3, GROUPS, OPTIONS);
    if (new Set(ordinary.map(signature)).size < GROUPS.length) foundOriginalDuplicate = true;
    assert.ok(ordinary.every((d) => d.family === 'bounty' && d.cards.length === 6));
    assert.ok(new Set(ordinary.flatMap(pageIds)).size < 30, 'single cards may still occur in different groups');
  }
  assert.ok(foundOriginalDuplicate, 'ordinary independent generation permits a naturally identical page');
});

test('identical complete pages retain their original draw without extra rerolls', () => {
  const baseSpec = DATA.choices.bountyDrafts.initial;
  const gd = forcedData('bounty', 3, { bountyDrafts: {
    ...DATA.choices.bountyDrafts,
    initial: { ...baseSpec, slots: 1, groups: [baseSpec.groups[0]] },
  } });
  const rng = createRng(71);
  let draws = 0;
  const originalInt = rng.int;
  rng.int = (n) => { draws++; return originalInt(n); };
  const pages = generateGroupDrafts(gd, rng, 3, GROUPS.slice(0, 2), OPTIONS);
  assert.equal(draws, 2, 'each group draws its original bounty combination once');
  assert.equal(signature(pages[0]), signature(pages[1]), 'groups can coincidentally have the same six-card multiset');
  assert.ok(pages.every((d) => d.cards.length === 6 && new Set(pageIds(d)).size === 6));
});

test('a single available supply item remains six separate cards in each independent page', () => {
  const gd = forcedData('supply', 3);
  const id = gd.shopItemsByTier[1][0];
  gd.shopItemsByTier = { 1: [id] };
  const pages = generateGroupDrafts(gd, createRng(3), 3, GROUPS.slice(0, 2), OPTIONS);
  assert.ok(pages.every((d) => d.cards.length === 6 && d.cards.every((c) => c.id === id)));
  assert.deepEqual(pages[1].cards.map((c) => c.idx), [0, 1, 2, 3, 4, 5]);
});

test('no group is silently omitted when card data cannot generate any reward', () => {
  const gd = forcedData('supply', 3);
  gd.shopItemsByTier = {};
  assert.equal(generateGroupDrafts(gd, createRng(3), 3, GROUPS, OPTIONS), null);
});
