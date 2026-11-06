import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diyDraftChanges, diyDraftReady, toggleDiyDraft } from '../../public/js/ui/diyChoice.js';

test('clearing and partial drafts can be applied, while untouched tiers retain their server defaults', () => {
  const tier = { tier: 5, slots: 2, candidates: ['a', 'b', 'c', 'd'].map(charId => ({ charId })), chosen: ['a', 'b'], picked: false };
  const priv = { diyChoice: { allowFewer: true, tiers: [tier, { ...tier, tier: 6 }] } };
  let draft = toggleDiyDraft(tier, null, 'a');
  assert.deepEqual(draft, ['b']); assert.equal(diyDraftReady(tier, draft), true);
  draft = toggleDiyDraft(tier, draft, 'b');
  assert.deepEqual(draft, []); assert.equal(diyDraftReady(tier, draft), true);
  assert.deepEqual(diyDraftChanges(priv, { 5: draft }), { 5: [] });
  assert.deepEqual(tier.chosen, ['a', 'b'], 'the confirmed summary never reads local drafts');
  assert.deepEqual(diyDraftChanges(priv, { 5: ['b', 'a'] }), {}, 'unchanged defaults are not converted to manual selections');
});

test('old servers keep their exact-count restriction; invalid and duplicate candidates cannot be applied', () => {
  const tier = { tier: 5, slots: 2, candidates: ['a', 'b', 'c'].map(charId => ({ charId })), chosen: ['a', 'b'] };
  assert.equal(diyDraftReady(tier, [], false), false);
  assert.equal(diyDraftReady(tier, ['c'], false), false);
  assert.equal(diyDraftReady(tier, ['a', 'c'], false), true);
  for (const draft of [['a', 'a'], ['x'], ['a', 'b', 'c']]) assert.equal(diyDraftReady(tier, draft), false);
});
