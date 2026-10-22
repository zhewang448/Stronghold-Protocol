import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give } from './harness.js';
import { poolGroupSizes, poolCopyScale } from '../../shared/playerCapacity.js';
import { makeCtx } from '../../server/match/effectsMeta.js';

const GROUP_CASES = [[1, [1]], [2, [2]], [3, [3]], [4, [4]], [5, [5]], [6, [3, 3]], [7, [4, 3]],
  [8, [4, 4]], [9, [4, 5]], [10, [4, 3, 3]], [11, [4, 4, 3]], [12, [4, 4, 4]], [13, [5, 4, 4]],
  [14, [4, 4, 3, 3]], [15, [4, 4, 4, 3]], [16, [4, 4, 4, 4]], [17, [5, 4, 4, 4]],
  [18, [4, 4, 4, 3, 3]], [19, [4, 4, 4, 4, 3]], [20, [4, 4, 4, 4, 4]]];
const COOP_CAPS = { 1: 24, 2: 28, 3: 36, 4: 32, 5: 16, 6: 10 };
const FIVE_PLAYER_CAPS = { 1: 30, 2: 35, 3: 45, 4: 40, 5: 20, 6: 13 };

for (const [count, sizes] of GROUP_CASES) {
  test(`${count} players: fixed pool groups ${sizes.join('+')}, including a complete co-op pool for three`, () => {
    const h = makeMatch({ humans: count, fake: true });
    const m = h.m;
    assert.deepEqual(poolGroupSizes(count), sizes);
    assert.deepEqual(m.poolGroups.map((g) => g.playerIds.length), sizes);
    assert.equal(new Set(m.poolGroups.flatMap((g) => g.playerIds)).size, count);
    for (const group of m.poolGroups) {
      assert.equal(group.scale, poolCopyScale(group.playerIds.length));
      for (const [id, entry] of group.pool.entries) {
        const five = group.playerIds.length === 5;
        const base = m.gd.poolCopies(id);
        const scaled = base * group.scale;
        const expected = five && entry.tier === 3 ? Math.floor(scaled) : Math.ceil(scaled);
        assert.equal(entry.cap, expected, id);
        if (!Object.hasOwn(m.gd.economy.poolCopiesOverrides || {}, id)) {
          assert.equal(entry.cap, (five ? FIVE_PLAYER_CAPS : COOP_CAPS)[entry.tier], `${id} tier baseline`);
        }
      }
      for (const id of group.playerIds) assert.equal(m.poolFor(id), group.pool);
    }
    h.invariants();
    m.dispose();
  });
}

test('pool group sizes reject invalid counts and cannot be changed by a previous caller', () => {
  for (const count of [0, -1, 21, 1.5, NaN, Infinity]) assert.throws(() => poolGroupSizes(count), RangeError);
  const first = poolGroupSizes(9);
  first[0] = 9;
  first.pop();
  assert.deepEqual(poolGroupSizes(9), [4, 5]);
});

test('nine occupied seats are assigned in seat order, including empty seat gaps and reversed input', () => {
  const seats = [0, 2, 4, 6, 8, 10, 12, 14, 19].map((seat) => ({
    seat, playerId: `seat_${seat}`, name: `P${seat}`, isBot: false, connected: true,
  })).reverse();
  const h = makeMatch({ seats, fake: true });
  assert.deepEqual(h.m.poolGroups.map((g) => g.playerIds), [
    ['seat_0', 'seat_2', 'seat_4', 'seat_6'], ['seat_8', 'seat_10', 'seat_12', 'seat_14', 'seat_19'],
  ]);
  h.invariants();
  h.m.dispose();
});

for (const [count, firstSize] of [[6, 3], [8, 4], [9, 4], [13, 5]]) {
  test(`${count} players: buying, merging, selling and elimination preserve every other group's copies`, () => {
    const h = makeMatch({ humans: count, fake: true });
    const m = h.m, p0 = h.ps('p_0'), matePs = h.ps(`p_${firstSize}`);
    const id = [...p0.pool.entries.keys()].find((id) => m.gd.tierOf(id) === 3 && m.gd.goldenIdOf(id) && m.gd.mergeCount(id) === 3);
    const caps = m.poolGroups.map((g) => g.pool.cap(id));
    const left = () => m.poolGroups.map((g) => g.pool.left(id));
    for (let i = 0; i < 3; i++) p0.acquireChess(id, { source: 'test' });
    assert.deepEqual(left(), caps.map((n, i) => n - (i === 0 ? 3 : 0)));
    assert.ok(p0.hand.some((p) => p && p.id === m.gd.goldenIdOf(id)));
    const mate = give(m, matePs, id);
    assert.deepEqual(left(), caps.map((n, i) => n - (i === 0 ? 3 : i === 1 ? 1 : 0)));
    p0.eliminate(1);
    assert.deepEqual(left(), caps.map((n, i) => n - (i === 1 ? 1 : 0)));
    assert.equal(m.poolGroups[0].playerIds.length, firstSize, 'elimination never reshuffles the groups');
    matePs.returnCopies(mate);
    matePs.hand.fill(null);
    matePs.recompute();
    assert.deepEqual(left(), caps);
    h.invariants();
    m.dispose();
  });
}

test('depleting one group leaves shop rolls and effect grants of the other group available', () => {
  const h = makeMatch({ humans: 7, fake: true });
  const p0 = h.ps('p_0'), p4 = h.ps('p_4');
  const id = [...p0.pool.entries.keys()][0];
  const held = p0.pool.take(id, 1000);
  assert.equal(p0.pool.roll(h.m.rngMeta, { filter: (x) => x === id }), null);
  assert.equal(p4.pool.roll(h.m.rngMeta, { filter: (x) => x === id }), id);
  assert.equal(p4.pool.cap(id), h.m.gd.poolCopies(id), 'three-player group has the full current co-op amount');
  p0.pool.give(id, held);
  h.invariants();
  h.m.dispose();
});

test('nine players: a five-player group does not expand private DIY stock', () => {
  const slotId = 'chess_char_5_diy1_a';
  const seats = Array.from({ length: 9 }, (_, seat) => ({
    seat, playerId: `p_${seat}`, name: `P${seat}`, connected: true, isBot: false,
    diy: seat === 8 ? { [slotId]: { charId: 'char_609_acguad' } } : null,
  }));
  const h = makeMatch({ seats, fake: true });
  const ps = h.ps('p_8');
  assert.equal(h.m.poolGroups[1].playerIds.length, 5);
  assert.equal(ps.diyStock.cap(slotId), 16, 'private tier V retains this branch\'s doubled co-op stock');
  for (const group of h.m.poolGroups) assert.equal(group.pool.has(slotId), false);
  const piece = ps.acquireChess(slotId, { source: 'test' });
  assert.ok(piece);
  assert.equal(ps.diyStock.left(slotId), 15);
  ps.eliminate(1);
  assert.equal(ps.diyStock.left(slotId), 16);
  h.invariants();
  h.m.dispose();
});

test('twenty client-combat participants finish a complete match with grouped pools and no engine errors', () => {
  const h = makeMatch({ humans: 20, fake: true, clientCombat: true, seed: 2050,
    script: (battle) => battle.kind === 'boss' || battle.kind === 'hidden' ? { bossDps: 1e9 } : {},
  }).start().autoHumans();
  const result = h.runToEnd();
  assert.equal(result.players.length, 20);
  assert.equal(result.reason, 'victory');
  assert.equal(h.m.errorCount, 0);
  assert.deepEqual(h.m.poolGroups.map((g) => g.playerIds.length), [4, 4, 4, 4, 4]);
  h.invariants();
  h.m.dispose();
});

test('twenty players: buying, merging, selling and eliminating DIY / stand-in pieces preserves the last group and each personal stock', () => {
  const slotId = 'chess_char_5_diy1_a';
  const notOwned = Object.values(DATA.chess)
    .filter((c) => c.visible && !c.isGolden && c.chessType === 'NORMAL' && c.backup)
    .map((c) => c.chessId);
  const seats = Array.from({ length: 20 }, (_, seat) => ({
    seat, playerId: `p_${seat}`, name: `P${seat}`, connected: true, isBot: false,
    diy: [0, 8, 19].includes(seat) ? { [slotId]: { charId: 'char_609_acguad' } } : null,
    notOwned: seat === 19 ? notOwned : null,
  }));
  const h = makeMatch({ seats, seed: 11, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_19');
  ps.shop.level = 6;
  ps.funds = 100;
  const buy = (id) => {
    ps.shop.slots[0] = { kind: 'chess', id, basePrice: ps.gd.chessPrice(id), frozen: false, sold: false };
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.buy', slot: 0 }), { ok: true });
  };
  assert.equal(ps.pool, m.poolGroups[4].pool, 'the last seat belongs to the fifth shared pool');
  for (const group of m.poolGroups) assert.equal(group.pool.has(slotId), false, 'DIY stock never joins a group pool');
  for (let i = 0; i < 3; i++) buy(slotId);
  const diyElite = ps.allChess().find((p) => p.id === ps.gd.goldenIdOf(slotId));
  assert.ok(diyElite);
  assert.equal(ps.diyStock.left(slotId), 13);
  assert.equal(h.ps('p_0').diyStock.left(slotId), 16);
  assert.equal(h.ps('p_8').diyStock.left(slotId), 16);
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.sell', uid: diyElite.uid }), { ok: true });
  assert.equal(ps.diyStock.left(slotId), 16);

  const id = [...ps.pool.entries.keys()].find((id) => ps.fieldsStandIn(id)
    && ps.pool.left(id) >= 3 && !ps.allChess().some((p) => ps.gd.baseIdOf(p.id) === id));
  assert.ok(id, 'an unowned operator with three free copies in the fifth group');
  const before = m.poolGroups.map((g) => g.pool.left(id));
  for (let i = 0; i < 3; i++) buy(id);
  const standInElite = ps.allChess().find((p) => p.id === ps.gd.goldenIdOf(id));
  assert.ok(standInElite && ps.fieldsStandIn(standInElite.id));
  assert.deepEqual(m.poolGroups.map((g) => g.pool.left(id)), before.map((n, i) => n - (i === 4 ? 3 : 0)));
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.sell', uid: standInElite.uid }), { ok: true });
  assert.deepEqual(m.poolGroups.map((g) => g.pool.left(id)), before);

  const ctx = makeCtx(m, ps, { key: 'test' }, 'onTest');
  assert.ok(ctx.grantChess(slotId));
  assert.equal(ps.diyStock.left(slotId), 15, 'effect grants take the receiver\'s private stock');
  assert.ok(ctx.grantChess(id));
  assert.equal(ps.pool.left(id), before[4] - 1, 'stand-in still spends the original operator\'s group copy');
  h.invariants();
  ps.eliminate(1);
  assert.equal(ps.diyStock.left(slotId), 16);
  assert.deepEqual(m.poolGroups.map((g) => g.pool.left(id)), before);
  h.invariants();
  assert.equal(m.errorCount, 0);
  m.dispose();
});
