// test/ui/seat-art.test.js — 名片干员 on the room's seat cards (PR #643 split 6, public/js/ui/seatArt.js): the pickable
// operators (one per charId of the visible, non-自选 chess records, the elite form, 6★ first), the default pool (5★/6★ by
// charId), the operator a seat shows (one's own local pick at once, a teammate's seats[].card, else one chosen by the
// player id — the same whatever order the records arrive in; none for a bot or an empty seat), the outfit it wears
// (seatCardSkin, the maintainer's decision 4 of 2026-10-21), the picture a card falls back to when one fails to load
// (seatArtSrc: the outfit, the default portrait, the avatar frame), the pick's store, and room.css following 文字大小
// without !important. (The server's whitelist: test/lobby-card.test.js; the browser: test/ui/room-cards.e2e.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CARD_PREF, CARD_KEY, cardStore, setCard, parseStoredCard, cardOperators, cardContext, seatOperator, seatCardSkin, seatArtSrc } from '../../public/js/ui/seatArt.js';
import { chessPortraitUrl } from '../../public/js/ui/assetUrls.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHESS = Object.values(JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8').replace(/\r\n/g, '\n')));

test('the pickable operators: one per visible, non-自选 charId, the elite form, 6★ first', () => {
  const list = cardOperators(CHESS);
  const ids = list.map((c) => c.charId);
  assert.equal(new Set(ids).size, ids.length, 'one record per charId');
  const visible = new Set(CHESS.filter((c) => !c.isDiy && c.visible !== false && typeof c.charId === 'string').map((c) => c.charId));
  assert.deepEqual(new Set(ids), visible);
  assert.ok(!ids.includes('char_616_pithst'), 'a hidden preset is not offered');
  for (const c of list) {
    if (CHESS.some((x) => x.charId === c.charId && x.isGolden && x.visible !== false && !x.isDiy)) assert.equal(c.isGolden, true, c.charId);
  }
  for (let i = 1; i < list.length; i++) assert.ok((list[i - 1].rarity ?? 0) >= (list[i].rarity ?? 0), 'rarity descending');
  assert.equal(list[0].rarity, 6);
  assert.deepEqual(cardOperators(null), []);
  assert.deepEqual(cardOperators([null, { isDiy: true, charId: 'char_1_x' }, { charId: 7 }]), []);
});

test('the default pool: 5★/6★ only, ordered by charId whatever order the records came in', () => {
  const list = cardOperators(CHESS);
  const a = cardContext(list);
  assert.ok(a.pool.length > 50 && a.pool.every((c) => c.rarity >= 5));
  const ids = a.pool.map((c) => c.charId);
  assert.deepEqual(ids, [...ids].sort());
  const b = cardContext(cardOperators([...CHESS].reverse()));
  assert.deepEqual(b.pool.map((c) => c.charId), ids);
  assert.equal(a.byChar.get('char_498_inside')?.charId, 'char_498_inside');
});

test('the operator a seat shows: own pick at once, a teammate\'s seats[].card, else the same default on every client', () => {
  const ctx = cardContext(cardOperators(CHESS));
  const other = cardContext(cardOperators([...CHESS].reverse()));
  const me = { playerId: 'p_me', name: 'Me', isBot: false, card: 'char_1012_skadi2' };
  const mate = { playerId: 'p_mate', name: 'Mate', isBot: false, card: 'char_498_inside' };
  // one's own seat: the local pick, even before the server echoes it (seat.card is still the old one)
  assert.deepEqual(seatOperator(me, ctx, { myId: 'p_me', myCard: 'char_498_inside' }), { chess: ctx.byChar.get('char_498_inside'), picked: true });
  // a teammate's seat: what the server says
  assert.equal(seatOperator(mate, ctx, { myId: 'p_me', myCard: 'char_1012_skadi2' }).chess.charId, 'char_498_inside');
  // no pick / an operator this client does not have / 默认 on one's own seat: the default by player id
  for (const [seat, own] of [[{ ...mate, card: undefined }, {}], [{ ...mate, card: 'char_999_nobody' }, {}], [me, { myId: 'p_me', myCard: '' }]]) {
    const op = seatOperator(seat, ctx, own);
    assert.equal(op.picked, false);
    assert.ok(ctx.pool.includes(op.chess));
    assert.equal(seatOperator(seat, other, own).chess.charId, op.chess.charId, 'the same default on every client');
  }
  const picks = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => seatOperator({ playerId: `p_${id}` }, ctx).chess.charId));
  assert.ok(picks.size > 1, 'different players get different defaults');
  // no portrait for a bot, an empty seat, or before the data loads
  assert.equal(seatOperator({ playerId: 'ai_1', isBot: true }, ctx), null);
  assert.equal(seatOperator(null, ctx), null);
  assert.equal(seatOperator({ playerId: 'p_x' }, cardContext([])), null);
  assert.equal(CARD_PREF, 'room.card');
});

test('the outfit a seat card wears (decision 4 of 2026-10-21): one\'s own choice at once, another doctor\'s published map, the switch, the fallback', () => {
  const OP = 'char_1012_skadi2';
  const SKIN = `${OP}@test#1`;
  const me = { playerId: 'p_me', isBot: false };
  const mate = { playerId: 'p_mate', isBot: false, skins: { [OP]: SKIN } };
  const bare = { playerId: 'p_bare', isBot: false };
  const bot = { playerId: 'ai_1', isBot: true, skins: { [OP]: SKIN } };
  const players = [me, mate, bare, bot];
  const ctx = { myId: 'p_me', localSkins: { [OP]: 'mine#2' }, players, otherSkins: true };
  // one's own card: this browser's choice (not the published map — it shows at once, before the sync)
  assert.equal(seatCardSkin({ ...me, skins: { [OP]: 'old#1' } }, OP, ctx), 'mine#2');
  assert.equal(seatCardSkin(me, 'char_498_inside', ctx), null, 'no choice for that operator: the default');
  // another doctor's card: what that seat published (room.state seats[].skins, or a match's players[].skins)
  assert.equal(seatCardSkin(mate, OP, ctx), SKIN);
  assert.equal(seatCardSkin(bare, OP, ctx), null);
  assert.equal(seatCardSkin(mate, OP, { ...ctx, players: [] }), null, 'a seat not in the list publishes nothing');
  // 「显示其他玩家的皮肤」 off: the others' cards draw the default, one's own keeps its outfit
  assert.equal(seatCardSkin(mate, OP, { ...ctx, otherSkins: false }), null);
  assert.equal(seatCardSkin(me, OP, { ...ctx, otherSkins: false }), 'mine#2');
  // a bot, an empty seat, no operator: nothing
  assert.equal(seatCardSkin(bot, OP, ctx), null);
  assert.equal(seatCardSkin(null, OP, ctx), null);
  assert.equal(seatCardSkin(mate, null, ctx), null);
  // the picture: the outfit's when this page's manifest has it, else the operator's own (an appearance plugin missing here)
  const rec = { charId: OP, isGolden: true, assets: { portrait: `${OP}_2` } };
  const withSkin = { chars: { [OP]: { portrait: '/p/skadi_1.png', portraitE2: '/p/skadi_2.png', skins: { [SKIN]: { name: 'T', portrait: '/p/skin.png' } } } } };
  const without = { chars: { [OP]: { portrait: '/p/skadi_1.png', portraitE2: '/p/skadi_2.png' } } };
  assert.equal(chessPortraitUrl(withSkin, rec, { skin: seatCardSkin(mate, OP, ctx) }), '/p/skin.png');
  assert.equal(chessPortraitUrl(without, rec, { skin: seatCardSkin(mate, OP, ctx) }), '/p/skadi_2.png');
});

test('a picture that fails to load: the outfit gives way to the default portrait, that to the avatar frame (§35.18)', () => {
  const OUTFIT = '/assets/chars/outfit.png';
  const PLAIN = '/assets/chars/plain.png';
  assert.equal(seatArtSrc([OUTFIT, PLAIN]), OUTFIT, 'the outfit first');
  assert.equal(seatArtSrc([OUTFIT, PLAIN], [OUTFIT]), PLAIN, 'the outfit failed: the default portrait');
  assert.equal(seatArtSrc([OUTFIT, PLAIN], [OUTFIT, PLAIN]), null, 'both failed: the avatar frame');
  assert.equal(seatArtSrc([PLAIN, null]), PLAIN, 'no outfit worn: the default only');
  assert.equal(seatArtSrc([PLAIN, PLAIN], [PLAIN]), null, 'an outfit this page lacks drew the default already: no second try');
  assert.equal(seatArtSrc([null, null]), null);
  assert.equal(seatArtSrc(undefined), null);
  // screens/room.js: the card gets both pictures and walks them on each failed load
  const room = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(room, /const portraitDefault = seat\.isBot/);
  assert.match(room, /portrait && bad !== portrait \? portrait : portraitDefault/);
  assert.match(room, /onError=.*setBad/);
});

test('the pick\'s store: a string pref, \'\' for 默认; setCard persists and tells the store', () => {
  assert.equal(parseStoredCard('char_1_a'), 'char_1_a');
  for (const junk of [null, 7, {}, ['x']]) assert.equal(parseStoredCard(junk), '');
  const seen = [];
  const off = cardStore.subscribe((st) => seen.push(st[CARD_KEY]));
  try {
    setCard('char_498_inside');
    setCard(42);
  } finally { off(); }
  assert.deepEqual(seen, ['char_498_inside', '']);
  assert.equal(cardStore.get()[CARD_KEY], '');
});

test('local room typography follows utility text scale and keeps touch controls', () => {
 const css=readFileSync(path.join(ROOT,'public/css/screens/room.css'),'utf8');
 assert.match(css,/var\(--utility-text, var\(--t\)\)/);
 assert.match(css,/\.room-screen/); assert.match(readFileSync(path.join(ROOT,'public/css/screens/lobby.css'),'utf8'),/\.rseat/); assert.match(readFileSync(path.join(ROOT,'public/css/screens/lobby.css'),'utf8'),/prefers-reduced-motion/);
});

test('an AI teammate\'s name split for the plate: 「AI·」 + the rest; a number-only name and a human seat unsplit (botNameParts)', async () => {
  const { botNameParts } = await import('../../public/js/screens/room.js');
  assert.deepEqual(botNameParts({ isBot: true, name: 'AI·华法琳' }), ['AI·', '华法琳']);
  assert.deepEqual(botNameParts({ isBot: true, name: 'AI · Warfarin' }), ['AI · ', 'Warfarin']);
  assert.deepEqual(botNameParts({ isBot: true, name: 'AI·Kal\'tsit\nx' }), ['AI·', 'Kal\'tsit\nx']);
  assert.equal(botNameParts({ isBot: true, name: 'AI·2' }), null, 'only a number after the prefix keeps it');
  assert.equal(botNameParts({ isBot: true, name: '华法琳' }), null);
  assert.equal(botNameParts({ isBot: true, name: 'AI·' }), null);
  assert.equal(botNameParts({ isBot: true }), null);
  assert.equal(botNameParts({ isBot: false, name: 'AI·x' }), null, 'a doctor named 「AI·x」 keeps the whole name');
  assert.equal(botNameParts({ name: 'AI·x' }), null);
  assert.equal(botNameParts(null), null);
});
