// Public grouped-draft frames: independent turns/pages with one stable shared-pool identity.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraft, normalizeSp, poolGroups, playerPoolGroup, poolGroupIdentity, poolGroupSections } from '../../public/js/ui/gameLogic.js';
import { createPoolGroups } from '../../server/match/pool.js';

const players = Array.from({ length: 9 }, (_, seat) => ({ playerId: `p${seat}`, seat, alive: true }));
const fixedGroups = createPoolGroups({ visibleChess: [] }, players)
  .map(({ id, playerIds }) => ({ id, playerIds }));
const members = (id) => fixedGroups.find((group) => group.id === id).playerIds;
const bandFrame = () => ({
  id: 'band:1',
  order: ['p0', 'p1', 'p2', 'p3'], turn: 'p1', picks: { p0: 'band_a', p4: 'band_a' },
  groups: [
    { id: 1, playerIds: members(1), order: ['p0', 'p1', 'p2', 'p3'], turn: 'p1', picks: { p0: 'band_a' },
      skipsLeft: { p1: 0 }, turnDeadline: 30_000, turnSeconds: 30, untimed: false, done: false },
    { id: 2, playerIds: members(2), order: ['p4', 'p5', 'p6', 'p7', 'p8'], turn: 'p5', picks: { p4: 'band_a' },
      skipsLeft: { p5: 1 }, turnDeadline: 50_000, turnSeconds: 30, untimed: false, done: false },
  ],
});
const spFrame = () => ({
  id: 'sp:round7:1', family: 'bounty', name: '赏金敌人', desc: '每组独立选择', eventId: 'bounty_1',
  cards: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'], order: ['p0', 'p1', 'p2'], turn: 'p1',
  // The compatibility facade's aggregate picks must never mark a different group's card.
  picks: { p0: 0, p4: 0 }, taken: { 0: 'p0' },
  groups: [
    { id: 1, playerIds: members(1), cards: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'],
      order: ['p0', 'p1', 'p2'], turn: 'p1', picks: { p0: 0 }, taken: { 0: 'p0' },
      turnDeadline: 25_000, turnSeconds: 16, done: false },
    { id: 2, playerIds: members(2), cards: ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'],
      order: ['p4', 'p5', 'p6'], turn: 'p5', picks: { p4: 0 }, taken: { 0: 'p4' },
      turnDeadline: 47_000, turnSeconds: 30, done: false },
  ],
});

describe('stable group identity for parallel selections', () => {
  test('supports authoritative three/four/five-person groups, not seat division', () => {
    for (const count of [6, 9, 13, 20]) {
      const occupied = Array.from({ length: count }, (_, seat) => ({ playerId: `s${seat}`, seat: seat * 2 }));
      const source = createPoolGroups({ visibleChess: [] }, occupied)
        .map(({ id, playerIds }) => ({ id, playerIds }));
      const pub = { players: occupied, poolGroups: source.slice().reverse() };
      const groups = poolGroups(pub);
      assert.deepEqual(groups.flatMap((group) => group.playerIds), occupied.map((p) => p.playerId));
      for (const group of groups) {
        assert.ok(group.playerIds.length >= 3 && group.playerIds.length <= 5);
        assert.deepEqual(poolGroupIdentity(group.id), { id: group.id, label: group.label, color: group.color });
        for (const pid of group.playerIds) assert.deepEqual(playerPoolGroup(pub, pid), group);
      }
    }
  });

  test('single-group identity is available while existing player-list decoration stays hidden', () => {
    const pub = { players: players.slice(0, 5), poolGroups: [{ id: 1, playerIds: players.slice(0, 5).map((p) => p.playerId) }] };
    assert.equal(poolGroups(pub).length, 1);
    assert.equal(playerPoolGroup(pub, 'p3').label, 'A');
    assert.equal(poolGroupSections(pub)[0].group, null);
  });

  test('invalid and duplicate metadata does not invent groups or mutate membership', () => {
    const source = [null, { id: 0, playerIds: ['x'] }, { id: 6, playerIds: ['x'] },
      { id: 5, playerIds: ['p8', null, 'p8', ''] }, { id: 5, playerIds: ['other'] },
      { id: 2, playerIds: [] }, { id: 1, playerIds: ['p0'] }];
    const snapshot = structuredClone(source);
    assert.deepEqual(poolGroups({ poolGroups: source }).map((group) => [group.id, group.playerIds]), [[1, ['p0']], [5, ['p8']]]);
    assert.equal(playerPoolGroup({ poolGroups: source }, 'p8').label, 'E');
    assert.equal(playerPoolGroup({ poolGroups: source }, 'unknown'), null);
    assert.equal(poolGroupIdentity('1'), null);
    assert.deepEqual(poolGroups(null), []);
    assert.deepEqual(source, snapshot);
  });
});

describe('parallel opening strategy normalization', () => {
  test('both groups have active turns, but local picks/skips/timer belong only to my group', () => {
    const frame = bandFrame();
    const snapshot = structuredClone(frame);
    const draft = normalizeDraft(frame, players, 'p5', fixedGroups);
    assert.equal(draft.id, 'band:1');
    assert.equal(draft.ownGroupId, 2);
    assert.equal(draft.groupId, 2);
    assert.deepEqual(draft.order, ['p4', 'p5', 'p6', 'p7', 'p8']);
    assert.equal(draft.turnPid, 'p5');
    assert.equal(draft.picks.has('p0'), false);
    assert.deepEqual([...draft.picks], [['p4', 'band_a']]);
    assert.deepEqual([...draft.allPicks], [['p0', 'band_a'], ['p4', 'band_a']], 'the same strategy can be selected by two groups');
    assert.equal(draft.skipsLeft.get('p5'), 1);
    assert.equal(draft.turnDeadline, 50_000);
    assert.equal(draft.turnSeconds, 30);
    assert.deepEqual(draft.groups.map((group) => group.turnPid), ['p1', 'p5']);
    assert.equal(draft.allDone, false);
    assert.deepEqual(frame, snapshot);
  });

  test('eliminated member retains own group; spectator falls back to first group', () => {
    const frame = bandFrame();
    frame.groups[1].order = ['p4', 'p5'];
    const eliminated = players.map((p) => p.playerId === 'p8' ? { ...p, alive: false, left: true } : p);
    assert.equal(normalizeDraft(frame, eliminated, 'p8', fixedGroups).ownGroupId, 2);
    assert.equal(normalizeDraft(frame, eliminated, 'p8', fixedGroups).groupId, 2);
    const spectator = normalizeDraft(frame, players, 'viewer', fixedGroups);
    assert.equal(spectator.ownGroupId, null);
    assert.equal(spectator.groupId, 1);
    assert.equal(normalizeDraft(frame, players, 'p5').ownGroupId, 2, 'full phase membership is also authoritative');
  });

  test('empty participating group stays empty and complete; explicit done is respected', () => {
    const frame = bandFrame();
    frame.groups[0] = { id: 1, playerIds: members(1), order: [], turn: null, picks: {} };
    frame.groups[1] = { ...frame.groups[1], done: true };
    const draft = normalizeDraft(frame, players, 'p0', fixedGroups);
    assert.deepEqual(draft.order, []);
    assert.equal(draft.done, true);
    assert.equal(draft.allDone, true);
    frame.groups[0].done = false;
    assert.equal(normalizeDraft(frame, players, 'p0', fixedGroups).allDone, false);
  });

  test('aggregates page picks when the facade omits them, and tracks the next stage id', () => {
    const frame = bandFrame();
    delete frame.picks;
    assert.equal(normalizeDraft(frame, players, 'p5', fixedGroups).allPicks.size, 2);
    frame.id = 'band:rematch2';
    assert.equal(normalizeDraft(frame, players, 'p5', fixedGroups).id, 'band:rematch2');
  });
});

describe('parallel six-option machine-event normalization', () => {
  test('defaults to my independently drawn page; repeated card indexes stay isolated', () => {
    const frame = spFrame();
    const snapshot = structuredClone(frame);
    const sp = normalizeSp(frame, players, 'p5', fixedGroups);
    assert.equal(sp.id, 'sp:round7:1');
    assert.equal(sp.groupId, 2);
    assert.equal(sp.ownGroupId, 2);
    assert.equal(sp.cards[0].id, 'b0');
    assert.equal(sp.cards[0].takenBy, 'p4');
    assert.equal(sp.cards[1].takenBy, null);
    assert.equal(sp.pickOf.has('p0'), false);
    assert.equal(sp.pickOf.get('p4'), 0);
    assert.equal(sp.pickedCount, 1);
    assert.equal(sp.turnPid, 'p5');
    assert.equal(sp.turnDeadline, 47_000);
    assert.equal(sp.turnSeconds, 30);
    assert.equal(sp.family, 'bounty');
    assert.equal(sp.eventId, 'bounty_1');
    assert.deepEqual(sp.groups.map((group) => group.takenBy.get(0)), ['p0', 'p4']);
    assert.deepEqual(frame, snapshot);
  });

  test('viewing another page keeps my membership and returns that page status only', () => {
    const frame = spFrame();
    const sp = normalizeSp(frame, players, 'p5', fixedGroups, 1);
    assert.equal(sp.ownGroupId, 2);
    assert.equal(sp.groupId, 1);
    assert.equal(sp.turnPid, 'p1');
    assert.equal(sp.cards[0].id, 'a0');
    assert.equal(sp.pickOf.has('p4'), false);
    assert.equal(normalizeSp(frame, players, 'p5', fixedGroups, 99).groupId, 2, 'stale/invalid page falls back to my group');
    const viewer = normalizeSp(frame, players, 'spectator', fixedGroups);
    assert.equal(viewer.ownGroupId, null);
    assert.equal(viewer.groupId, 1);
    assert.equal(normalizeSp(frame, players, 'p8', fixedGroups).ownGroupId, 2, 'nonparticipating member still opens own page');
  });

  test('page metadata may override the stage family without sharing cards or picks', () => {
    const frame = spFrame();
    frame.groups[1] = { ...frame.groups[1], family: 'equipment', name: '装备页', eventId: 'equip_2',
      cards: [{ itemId: 'eq1' }, { itemId: 'eq2', takenBy: 'p5' }], picks: {}, taken: {}, untimed: true };
    const sp = normalizeSp(frame, players, 'p5', fixedGroups);
    assert.equal(sp.family, 'equipment');
    assert.equal(sp.name, '装备页');
    assert.equal(sp.eventId, 'equip_2');
    assert.equal(sp.untimed, true);
    assert.equal(sp.cards[0].takenBy, null);
    assert.equal(sp.cards[1].takenBy, 'p5');
    assert.equal(sp.pickOf.size, 1);
    assert.equal(sp.groups[0].family, 'bounty');
  });

  test('empty groups, inferred completion, and changing stage ids remain independent', () => {
    const frame = spFrame();
    frame.groups[0] = { id: 1, playerIds: members(1), order: [], cards: [], picks: {}, turn: null };
    frame.groups[1] = { ...frame.groups[1], order: ['p4'], done: undefined };
    const sp = normalizeSp(frame, players, 'p0', fixedGroups);
    assert.deepEqual(sp.order, []);
    assert.equal(sp.done, true);
    assert.equal(sp.allDone, true);
    frame.id = 'sp:round11:2';
    frame.groups[1].done = false;
    const next = normalizeSp(frame, players, 'p5', fixedGroups);
    assert.equal(next.id, 'sp:round11:2');
    assert.equal(next.groupId, 2);
    assert.equal(next.allDone, false);
  });
});

describe('legacy draft compatibility', () => {
  test('old band object/array picks and empty-order tolerance remain available', () => {
    const draft = normalizeDraft({ order: [], turn: 1, picks: ['band_x', null, 'band_z'], skips: { p1: 0 } }, players.slice(0, 3));
    assert.deepEqual(draft.order, ['p0', 'p1', 'p2']);
    assert.equal(draft.turnPid, 'p1');
    assert.equal(draft.picks.get('p2'), 'band_z');
    assert.equal(draft.allPicks.get('p0'), 'band_x');
    assert.equal(draft.skipsLeft.get('p1'), 0);
    assert.equal(draft.id, null);
    assert.equal(draft.groupId, null);
    assert.deepEqual(draft.groups, []);
    assert.equal(normalizeDraft(null, []).done, false);
  });

  test('old SP forms tolerate invalid picks and enforce the restored six-card limit', () => {
    const sp = normalizeSp({ cards: ['e1', { id: 'e2', takenBy: 'p2' }, {}, {}, {}, {}, 'extra'],
      order: ['p1', 'p0'], turn: 0, picks: [{ playerId: 'p1', idx: 2 }, { playerId: 'bad', idx: 9 }], taken: { 0: 'p0' } });
    assert.equal(sp.cards.length, 6);
    assert.equal(sp.turnPid, 'p1');
    assert.equal(sp.pickOf.get('p0'), 0);
    assert.equal(sp.pickOf.get('p1'), 2);
    assert.equal(sp.pickOf.get('p2'), 1);
    assert.equal(sp.pickOf.has('bad'), false);
    assert.equal(sp.allDone, true);
    assert.deepEqual(sp.groups, []);
    assert.equal(normalizeSp(null), null);
  });

  test('invalid group ids do not invent parallel pages or defeat legacy facade', () => {
    const raw = { cards: ['legacy'], order: ['p0'], turn: 'p0', picks: {},
      groups: [null, { id: 0, cards: ['bad'] }, { id: 6, cards: ['bad'] }, { id: 1, cards: ['missing-members'] }] };
    const sp = normalizeSp(raw, players, 'p0');
    assert.equal(sp.cards[0].id, 'legacy');
    assert.deepEqual(sp.groups, []);
    assert.equal(sp.ownGroupId, null);
  });

  test('missing page member metadata may use the fixed group, while duplicate pages are ignored', () => {
    const frame = spFrame();
    delete frame.groups[1].playerIds;
    frame.groups.push({ ...frame.groups[1], cards: ['duplicate'] });
    const sp = normalizeSp(frame, players, 'p5', fixedGroups);
    assert.equal(sp.groups.length, 2);
    assert.equal(sp.cards[0].id, 'b0');
    assert.deepEqual(sp.groups[1].playerIds, members(2));
  });
});
