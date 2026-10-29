import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { trackCombat, combineCombat } from '../../public/js/battle/metrics.js';

test('combat statistics keep same-name pieces separate and accumulate each piece across battles', () => {
  const row = (uid, damage) => ({ key: JSON.stringify(['p1', `uid:${uid}`]), ownerId: 'p1', uid,
    defId: 'same-op', name: '同名干员', kind: 'op', damage, healing: 0,
    types: { phys: damage, arts: 0, true: 0, elemental: 0 } });
  const totals = combineCombat([
    { seconds: 10, owners: ['p1'], rows: [row(1, 20), row(2, 30)] },
    { seconds: 5, owners: ['p1'], rows: [row(1, 10), row(2, 5)] },
  ], 'p1');
  assert.deepEqual(totals.rows.map(({ uid, damage }) => ({ uid, damage })).sort((a, b) => a.uid - b.uid), [
    { uid: 1, damage: 30 }, { uid: 2, damage: 35 },
  ]);
  assert.equal(totals.damage, 65);
});

test('combat accounting observes effective damage/healing without changing events or deterministic results', () => {
  const opts = { content: 'none', seed: 19, timeLimit: 10,
    defs: { chess: { guard: chessRec({ id: 'guard', skill: null }) }, enemies: { enemy: enemyRec({ key: 'enemy', hp: 10000, speed: 0 }) } },
    units: [{ chessId: 'guard', uid: 1, row: 10, col: 5 }], enemies: [{ key: 'enemy', time: 0, pos: [10, 6] }] };
  const plain = makeBattle(opts), observed = makeBattle(opts);
  const snapshot = trackCombat(observed.b);
  const exercise = h => {
    h.step(); const op = h.unit(1), enemy = h.enemy('enemy');
    h.b.loseHp(op, 200);
    assert.equal(h.b.heal(op, op, 1000), 200, 'overheal is excluded');
    h.b.dealDamage(op, enemy, { amount: 200, type: 'phys', canDodge: false });
    h.b.dealDamage(op, enemy, { amount: 100, type: 'arts', canDodge: false });
    h.b.loseHp(enemy, 50, { source: op, silent: true });
    h.runToEnd();
  };
  exercise(plain); exercise(observed);
  assert.deepEqual(observed.b.result(), plain.b.result());
  assert.deepEqual(observed.events, plain.events);
  const totals = combineCombat([snapshot()], 'p1');
  assert.equal(totals.healing, 200);
  assert.ok(totals.damage >= 350);
  const types = totals.rows[0].types;
  assert.equal(Object.values(types).reduce((a,b) => a+b, 0), totals.damage);
  snapshot().rows[0].damage = -1;
  assert.ok(snapshot().rows[0].damage >= 350, 'returned records are detached');
});
