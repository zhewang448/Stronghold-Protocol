// Permanent UI groups come from the server's shared-pool metadata, never from seat / 4.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { POOL_GROUP_COLORS, poolGroupSections } from '../../public/js/ui/gameLogic.js';
import { createPoolGroups } from '../../server/match/pool.js';

const player = (seat, extra = {}) => ({ playerId: `p${seat}`, seat, alive: true, ...extra });
const ids = (sections) => sections.map((s) => s.players.map((p) => p.playerId));
const publicGroups = (players) => createPoolGroups({ visibleChess: [] }, players)
  .map(({ id, playerIds }) => ({ id, playerIds }));

describe('permanent shared-pool UI sections', () => {
  for (const [count, sizes] of [[6, [3, 3]], [9, [4, 5]], [20, [4, 4, 4, 4, 4]]]) {
    test(`${count} players: shows the server's ${sizes.join('+')} groups in seat order`, () => {
      const players = Array.from({ length: count }, (_, seat) => player(seat));
      const pub = { players: players.slice().reverse(), poolGroups: publicGroups(players).reverse() };
      const sections = poolGroupSections(pub);
      assert.deepEqual(sections.map((s) => s.players.length), sizes);
      assert.deepEqual(sections.flatMap((s) => s.players), players, 'every player remains in occupied-seat order');
      assert.deepEqual(sections.map((s) => s.group.id), sizes.map((_, i) => i + 1));
      assert.deepEqual(sections.map((s) => s.group.label), ['A', 'B', 'C', 'D', 'E'].slice(0, sizes.length));
      assert.deepEqual(sections.map((s) => s.group.color), POOL_GROUP_COLORS.slice(0, sizes.length));
      for (const section of sections) assert.deepEqual(section.group.playerIds, section.players.map((p) => p.playerId));
      assert.deepEqual(pub.players, players.slice().reverse(), 'does not mutate the public player order');
    });
  }

  test('noncontiguous seats follow authoritative membership, including a boundary within the same seat / 4 bucket', () => {
    const players = [0, 2, 5, 6, 11, 19].map((seat) => player(seat));
    const sections = poolGroupSections({ players: players.slice().reverse(), poolGroups: publicGroups(players) });
    assert.deepEqual(ids(sections), [['p0', 'p2', 'p5'], ['p6', 'p11', 'p19']]);
    assert.deepEqual(sections.map((s) => s.group.label), ['A', 'B']);
  });

  test('death, leaving, disconnection, and AI takeover keep the same group identity', () => {
    const players = Array.from({ length: 9 }, (_, seat) => player(seat));
    const poolGroups = publicGroups(players);
    const changed = players.map((p) => ({ ...p, alive: false, left: true, connected: false, autoplay: true }));
    const before = poolGroupSections({ players, poolGroups });
    const after = poolGroupSections({ players: changed, poolGroups });
    assert.deepEqual(ids(after), ids(before));
    assert.deepEqual(after.map((s) => s.group), before.map((s) => s.group));
  });

  test('missing metadata or a single group leaves the original list undecorated', () => {
    const players = [player(4), player(0), player(2)];
    for (const poolGroups of [undefined, null, [], publicGroups(players)]) {
      const sections = poolGroupSections({ players, poolGroups });
      assert.equal(sections.length, 1);
      assert.equal(sections[0].group, null);
      assert.deepEqual(ids(sections), [['p0', 'p2', 'p4']]);
    }
    assert.deepEqual(poolGroupSections(null), []);
    assert.deepEqual(poolGroupSections({ players: [] }), []);
  });

  test('unassigned members remain in place and split only the enclosing group frame', () => {
    const players = [0, 1, 2, 3, 4].map((seat) => player(seat));
    const poolGroups = [{ id: 1, playerIds: ['p0', 'p2'] }, { id: 5, playerIds: ['p4'] }];
    const sections = poolGroupSections({ players, poolGroups });
    assert.deepEqual(ids(sections), [['p0'], ['p1'], ['p2'], ['p3'], ['p4']]);
    assert.deepEqual(sections.map((s) => s.group?.label ?? null), ['A', null, 'A', null, 'E']);
    assert.equal(sections[0].group, sections[2].group, 'split sections still share one fixed identity');
    assert.equal(sections[4].group.color, POOL_GROUP_COLORS[4], 'color is indexed by id, not metadata position');
  });

  test('unsupported metadata never invents a group or drops players', () => {
    const players = [player(0), player(1)];
    const poolGroups = [null, { id: 0, playerIds: ['p0'] }, { id: 6, playerIds: ['p1'] },
      { id: 1, playerIds: ['p0'] }, { id: 1, playerIds: ['p1'] }, { id: 2, playerIds: [] }];
    const sections = poolGroupSections({ players, poolGroups });
    assert.deepEqual(sections, [{ group: null, players }], 'one valid id does not trigger multi-group decoration');
  });
});
