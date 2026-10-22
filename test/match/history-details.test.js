import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { recordRound } from '../../server/match/history.js';
import { groupLeaks, normalLeakHistory } from '../../server/match/leak-history.js';
import { rewindToPrep } from '../../server/match/rewind.js';

test('leaks group by enemy and preserve counted and LP distinctions', () => {
  const gd = { enemy: (k) => ({ name: k === 'a' ? '甲' : '乙' }) };
  assert.deepEqual(groupLeaks(gd, [{ enemyKey: 'a' }, { enemyKey: 'a', counted: false }, { enemyKey: 'b', lpr: 3 }]),
    [{ name: '甲', count: 2, counted: 1, leakLp: 2 }, { name: '乙', count: 1, counted: 1, leakLp: 3 }]);
  const ps = { playerId: 'p' };
  const details = normalLeakHistory({ gd }, ps, { leaked: [{ enemyKey: 'a' }] }, { plan: { leakers: [ps] }, uniteResult: { perPlayer: { helper: { leaked: [{ enemyKey: 'a', sourcePlayerId: 'p' }] } }, unspawned: [{ enemyKey: 'b', sourcePlayerId: 'p' }] }, uniteRan: true, loss: 2 });
  assert.equal(details[0].loss, 0); assert.equal(details[1].loss, 2); assert.equal(details[1].enemies.length, 2);
});

test('economy balances actual coins; rewind discards abandoned economy and leak history', (t) => {
  const h = makeMatch({ mode: 'solo', fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const ps = h.ps('p_0'), opening = ps.funds;
  ps.addFunds(20, { reason: 'admin' }); ps.spend(3, 'buy'); ps.refresh();
  ps.leakHistory = [{ kind: 'normal', enemies: [], loss: 2 }];
  recordRound(h.m);
  const p = h.m.history[0].players[0];
  assert.equal(p.economy.opening + p.income - p.expense, p.funds);
  assert.equal(p.economy.income.admin, 20); assert.equal(p.economy.expense.buy, 3);
  assert.ok(p.bonds.length); assert.equal(p.leakDetails[0].loss, 2);
  assert.equal(rewindToPrep(h.m).ok, true);
  assert.equal(ps.funds, opening); assert.equal(h.m.history.length, 0); assert.deepEqual(ps.leakHistory, []);
});

test('a failed later Unite wave records the planned survivors and excludes runtime summons', () => {
  const ps = { playerId: 'p' }, gd = { enemy: (id) => id === 'a' ? { name: '甲' } : null };
  const own = { leaked: [{ enemyKey: 'a' }, { enemyKey: 'a' }, { enemyKey: 'missing' }] };
  const plan = { leakers: [ps], leaked: [{ enemyKey: 'a', sourcePlayerId: 'p' }] };
  for (const uniteResult of [null, { synthetic: true, perPlayer: {} }]) {
    const failed = normalLeakHistory({ gd }, ps, own, { plan, uniteResult, uniteRan: true, loss: 2 });
    assert.equal(failed[1].enemies.reduce((n, e) => n + e.counted, 0), 2, 'the failed wave cannot erase surviving leaks');
  }
  const completed = normalLeakHistory({ gd }, ps, own, { plan, uniteResult: { perPlayer: { helper: { leaked: [
    { enemyKey: 'a', sourcePlayerId: 'p' }, { enemyKey: 'a', sourcePlayerId: 'p', uniteRuntime: true },
  ] } }, unspawned: [] }, uniteRan: true, loss: 2 });
  assert.equal(completed[1].enemies.reduce((n, e) => n + e.counted, 0), 2, 'runtime summons never enter billed leak history');
});
