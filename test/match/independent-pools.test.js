import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoolGroups } from '../../server/match/pool.js';
import { makeMatch } from './harness.js';

test('independent stock groups give each player a complete isolated pool', (context) => {
  const harness = makeMatch({ humans: 4, fake: true });
  context.after(() => harness.m.dispose());
  const groups = createPoolGroups(harness.m.gd, harness.m.order, { banned: harness.m.bannedChess, independent: true });
  assert.deepEqual(groups.map((group) => group.playerIds), [['p_0'], ['p_1'], ['p_2'], ['p_3']]);
  const id = [...groups[0].pool.entries.keys()][0];
  const cap = groups[0].pool.cap(id);
  assert.equal(cap, harness.m.gd.poolCopies(id));
  assert.equal(groups[0].pool.take(id), 1);
  assert.equal(groups[0].pool.left(id), cap - 1);
  assert.equal(groups[1].pool.left(id), cap);
});
