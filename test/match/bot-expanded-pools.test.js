import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

for (const players of [4, 8, 10, 16, 20]) for (const independentPools of [false, true]) {
  test(`upgraded AI completes three preps with ${players} seats and ${independentPools ? 'independent' : 'grouped'} stock`, { timeout: 60000 }, t => {
    const seats = Array.from({ length: players }, (_, seat) => ({ seat, playerId: 'ai_' + seat,
      name: 'AI ' + seat, isBot: true, connected: true }));
    const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', seats, fake: true, seed: 73,
      botRehearsal: 0, independentPools }).start().toPrep(4);
    t.after(() => h.m.dispose());
    h.invariants();
    assert.deepEqual(h.logs.error, []);
    assert.equal(h.m.order.length, players);
    assert.equal(Object.keys(h.m.draft.picks).length, players);
    const pools = new Set(h.m.order.map(player => player.pool));
    assert.equal(pools.size, independentPools ? players : h.m.draftGroups.length);
    assert.ok(h.m.order.some(player => player._botSelf?.plan?.bonds?.length > 0), 'the upgraded main-bond policy runs');
    for (const player of h.m.order) {
      assert.ok(player.board.size > 0, player.playerId + ' bought and deployed a lineup');
      assert.ok(player.shop.level <= 5);
      assert.ok(!player._botSelf || player._botSelf.plan?.bonds?.length > 0, player.playerId + ' has a valid optional main-bond plan');
    }
  });
}
