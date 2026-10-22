// Group-local permissions and independent clocks in the strategy screen and contingency pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraft, normalizeSp, normalizePersonalChoice } from '../../public/js/ui/gameLogic.js';
import { otherBandGroups, teammateBands, draftClock, hasManualTeammateAfter } from '../../public/js/screens/bandDraft.js';
import { ChoiceView, choicePage, defaultChoiceGroup, cardPickable, armedCard } from '../../public/js/ui/choiceOverlay.js';
import { draftRequestScope, choiceRequestScope } from '../../public/js/ui/gameActions.js';
import { validateC2S } from '../../shared/protocol.js';

test('request identity omits absent legacy guards and retains current-stage guards', () => {
  for (const scope of [undefined, {}, { draftId: null, groupId: null }]) {
    assert.deepEqual(draftRequestScope(scope), {});
    assert.equal(validateC2S({ t: 'g.choice', idx: 5, ...draftRequestScope(scope) }), null);
  }
  assert.deepEqual(draftRequestScope({ draftId: 'sp:3:1', groupId: 2 }), { draftId: 'sp:3:1', groupId: 2 });
  assert.equal(validateC2S({ t: 'g.bandSkip', ...draftRequestScope({ draftId: 'band:1', groupId: 2 }) }), null);
});

test('personal PREP choice identity stays separate from the public group draft scope', () => {
  const grouped = { draftId: 'sp:3:1', groupId: 2 };
  assert.deepEqual(choiceRequestScope(), {});
  assert.deepEqual(choiceRequestScope(grouped), grouped);
  assert.deepEqual(choiceRequestScope('personal:3:1'), { choiceId: 'personal:3:1' });
  assert.deepEqual(choiceRequestScope({ choiceId: 'personal:3:1' }), { choiceId: 'personal:3:1' });
  for (const scope of [choiceRequestScope(grouped), choiceRequestScope('personal:3:1')]) {
    assert.equal(validateC2S({ t: 'g.choice', idx: 2, ...scope }), null);
  }
});

const players = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((playerId, seat) => ({
  playerId, seat, name: playerId, alive: true, connected: true, isBot: false, autoplay: false,
}));
const poolGroups = [{ id: 1, playerIds: ['a1', 'a2', 'a3'] }, { id: 2, playerIds: ['b1', 'b2', 'b3'] }];
const cards = () => Array.from({ length: 6 }, (_, idx) => ({ name: `选项${idx}`, desc: '效果' }));
const spRaw = () => ({
  id: 'sp:3', family: 'supply', groups: [
    { id: 1, order: ['a1', 'a2', 'a3'], turn: 'a2', picks: { a1: 0 }, cards: cards(), turnDeadline: 5000, turnSeconds: 16 },
    { id: 2, order: ['b1', 'b2', 'b3'], turn: 'b1', picks: {}, cards: cards(), turnDeadline: 9000, turnSeconds: 30 },
  ],
});
function* walk(node) {
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
  if (!node || typeof node !== 'object') return;
  yield node;
  yield* walk(node.props?.children);
}
const hasClass = (node, cls) => node.props?.class?.split(/\s+/).includes(cls);
const textOf = (node) => node == null || typeof node === 'boolean' ? ''
  : typeof node === 'string' || typeof node === 'number' ? String(node)
    : Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props?.children);

test('personal PREP choice retains two-tap confirmation and the prep clock without group tabs', () => {
  const pub = { phase: 'PREP', round: 3, deadline: 9000, players, poolGroups };
  const priv = { playerId: 'b1', alive: true, personalChoice: { id: 'personal:3:1', round: 3, cards: cards().slice(0, 3) } };
  const sp = normalizePersonalChoice(pub, priv, 'b1');
  const picked = [];
  const nodes = [...walk(ChoiceView({ pub, sp, myId: 'b1', solo: false, personal: true, armed: 1, onConfirm: () => picked.push(1) }))];
  assert.equal(nodes.find((node) => node.props?.role === 'dialog').props['aria-label'], '教鞭选择');
  assert.ok(!nodes.some((node) => hasClass(node, 'spov__groups') || hasClass(node, 'spov__order')));
  assert.equal(nodes.find((node) => node.type?.name === 'Countdown').props.deadline, pub.deadline);
  const shownCards = nodes.filter((node) => hasClass(node, 'spcard'));
  assert.equal(shownCards.length, 3);
  assert.ok(shownCards.every((node) => !node.props.disabled));
  const confirm = nodes.find((node) => node.props?.['data-testid'] === 'sp-confirm');
  confirm.props.onClick();
  assert.deepEqual(picked, [1]);
});

test('strategy availability and skip stay local while other-group picks create group markers', () => {
  const draft = normalizeDraft({ id: 'band:1', groups: [
    { id: 1, order: ['a1', 'a2', 'a3'], turn: 'a2', picks: { a1: 'band_x' }, turnDeadline: 5000, turnSeconds: 30 },
    { id: 2, order: ['b1', 'b2', 'b3'], turn: 'b2', picks: { b1: 'band_y' }, turnDeadline: 8000, turnSeconds: 30 },
  ] }, players, 'a2', poolGroups);
  const taken = teammateBands(draft.picks, 'a2');
  assert.equal(taken.has('band_x'), true);
  assert.equal(taken.has('band_y'), false, 'other-group selection stays available');
  assert.deepEqual(otherBandGroups(draft, 'band_y').map((g) => g.label), ['B']);
  assert.deepEqual(otherBandGroups(draft, 'band_x'), []);
  assert.deepEqual(draftClock({ deadline: 8000 }, draft), { deadline: 5000, total: 30 });
  assert.equal(hasManualTeammateAfter(draft, players, 'a2'), true);
  assert.equal(hasManualTeammateAfter(draft, players, 'a3'), false, 'manual people in B do not enable an A skip');
});

test('each contingency page retains stage identity and local indexes; only the own page is selectable', () => {
  const raw = spRaw();
  const own = normalizeSp(raw, players, 'b1', poolGroups);
  assert.equal(own.groupId, 2, 'B player starts on B');
  assert.equal(cardPickable(own, own.cards[0], { myId: 'b1', solo: false }), true);
  const other = choicePage(own, 1);
  assert.equal(other.id, 'sp:3', 'page number never overwrites the stage ID');
  assert.equal(other.groupId, 1);
  assert.equal(other.ownGroupId, 2);
  assert.equal(other.cards[0].takenBy, 'a1');
  assert.equal(own.cards[0].takenBy, null, 'A selection does not consume B index 0');
  assert.equal(cardPickable(other, other.cards[1], { myId: 'b1', solo: false }), false);
  assert.equal(cardPickable(other, other.cards[1], { myId: 'b1', solo: true }), false, 'solo flag cannot authorize another group');
  assert.equal(armedCard(1, other, { myId: 'b1', solo: false }), null, 'switching away cannot retain an armed index');
});

test('contingency tabs expose progress, local countdown, and a read-only return entry for a foreign page', () => {
  const sp = choicePage(normalizeSp(spRaw(), players, 'b1', poolGroups), 1);
  const switched = [];
  const nodes = [...walk(ChoiceView({ pub: { players, deadline: 99000 }, sp, myId: 'b1', solo: false, onGroup: (id) => switched.push(id) }))];
  const tabs = nodes.filter((node) => hasClass(node, 'spov__group-tab'));
  assert.equal(tabs.length, 2);
  assert.equal(tabs[0].props['aria-pressed'], 'true');
  assert.match(textOf(tabs[0]), /1\/3/);
  assert.match(textOf(tabs[1]), /本组/);
  tabs[1].props.onClick();
  assert.deepEqual(switched, [2]);
  const countdown = nodes.find((node) => node.type?.name === 'Countdown');
  assert.equal(countdown.props.deadline, 5000, 'foreign page shows A clock, not the root deadline');
  assert.equal(countdown.props.total, 16);
  assert.match(textOf(nodes.find((node) => hasClass(node, 'spov__readonly'))), /正在查看A组/);
  assert.equal(nodes.filter((node) => hasClass(node, 'spcard')).length, 6);
  assert.ok(nodes.filter((node) => hasClass(node, 'spcard')).every((node) => node.props.disabled));
});

test('eliminated fixed members and spectators can browse but cannot select', () => {
  const raw = spRaw();
  raw.groups[1].order = ['b2', 'b3'];
  raw.groups[1].turn = 'b2';
  const eliminated = normalizeSp(raw, players, 'b1', poolGroups);
  assert.equal(eliminated.groupId, 2, 'elimination keeps the permanent group page');
  assert.equal(cardPickable(eliminated, eliminated.cards[0], { myId: 'b1', solo: false }), false);
  const spectator = normalizeSp(raw, players, 'viewer', poolGroups);
  assert.equal(spectator.ownGroupId, null);
  assert.equal(cardPickable(spectator, spectator.cards[0], { myId: 'viewer', solo: false }), false);
});

test('completed own group waits for others and displays no stale countdown', () => {
  const raw = spRaw();
  raw.groups[1].picks = { b1: 0, b2: 1, b3: 2 };
  raw.groups[1].done = true;
  const sp = normalizeSp(raw, players, 'b1', poolGroups);
  const nodes = [...walk(ChoiceView({ pub: { players }, sp, myId: 'b1', solo: false }))];
  assert.match(textOf(nodes.find((node) => hasClass(node, 'spov__turntxt'))), /本组已完成，等待其他组/);
  assert.ok(!nodes.some((node) => node.type?.name === 'Countdown'));
  assert.equal(sp.allDone, false);
});

test('spectator initial focus skips completed pages while an eliminated member keeps the own page', () => {
  const raw = spRaw();
  raw.groups[0].picks = { a1: 0, a2: 1, a3: 2 };
  raw.groups[0].done = true;
  const spectator = normalizeSp(raw, players, 'viewer', poolGroups);
  const focused = choicePage(spectator, defaultChoiceGroup(spectator));
  const nodes = [...walk(ChoiceView({ pub: { players }, sp: focused, myId: 'viewer', solo: false }))];
  assert.equal(focused.groupId, 2);
  assert.equal(nodes.find((node) => hasClass(node, 'spov__group-tab') && node.props['aria-pressed'] === 'true').props['data-group'], 2);
  const member = normalizeSp(raw, players, 'a1', poolGroups);
  assert.equal(defaultChoiceGroup(member), 1, 'fixed member stays on A even when A is complete');
  assert.equal(choicePage(focused, 1).groupId, 1, 'manual browsing may still select a completed page');
  raw.groups[1].done = true;
  assert.equal(defaultChoiceGroup(normalizeSp(raw, players, 'viewer', poolGroups)), 1, 'all completed falls back to first');
});
