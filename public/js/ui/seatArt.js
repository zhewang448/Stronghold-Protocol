// 名片干员: the portrait a doctor shows on the room's seat card (screens/room.js) and on the strategy draft's name-card rows
// (screens/bandDraft.js) — the operator the player picked (room.card; room.state seats[].card), else one of the 5★/6★
// operators chosen by the player id, the same on every client.
import { CARD_PERIOD_ORDER, isCardChess, parseCardRoster } from '../../../shared/cardRoster.js';
import { chessPortraitUrl } from './assetUrls.js';
import { createStore, loadPref, savePref } from '../store.js';
import { ownerSkin } from './skins.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';

/** FNV-1a of a string (the portrait pick: the same operator for a player on every client). */
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** 名片干员: the player's own pick (localStorage; sent as room.card where the server knows it). */
export const CARD_PREF = 'room.card';
export const CARD_SKIN_PREF = 'room.cardSkin';

/**
 * The operators a seat card can show: one record per charId (the elite form for its E2 art), 6★ first.
 * @param {any[]} chessList chess.json records
 * @returns {any[]}
 */
export function cardOperators(chessList, catalogue = null, manifest = null, skins = null) {
  const by = new Map();
  for (const c of Array.isArray(chessList) ? chessList : []) {
    if (!isCardChess(c)) continue;
    const prev = by.get(c.charId);
    if (!prev || (c.isGolden && !prev.isGolden)) by.set(c.charId, c);
  }
  for (const c of Object.values(catalogue?.chars || {})) {
    const prev = by.get(c.charId);
    by.set(c.charId, { ...c, ...prev, choices: c.choices });
  }
  for (const [charId, record] of by) {
    const choices = new Map((record.choices || []).map(choice => [choice.id, choice]));
    for (const [skinId, installed] of Object.entries(manifest?.chars?.[charId]?.skins || {})) {
      const portrait = installed.portrait || installed.portraitE2 || installed.illust;
      if (!portrait) continue;
      const metadata = skins?.chars?.[charId]?.find(skin => skin.id === skinId);
      choices.set(skinId, { id: skinId, name: metadata?.name || installed.name || skinId, portrait });
    }
    if (choices.size) by.set(charId, { ...record, choices: [...choices.values()] });
  }
  return [...by.values()].sort((a, b) => ((b.rarity ?? 0) - (a.rarity ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh'));
}

/**
 * The seat card's portrait: the operator the player picked (room.state seats[].card, or one's own pick), else one of
 * the 5★/6★ operators chosen by the player id — the same on every client (null before the data loads).
 * @param {any} seat room.state seat @param {{ pool: any[], byChar: Map<string, any>, m: any, myId: any, myCard: string, mySkin?: string }} ctx
 */
export function seatPortrait(seat, { pool, byChar, m, myId, myCard, mySkin = '' }) {
  if (!seat || seat.playerId == null) return null;
  const pick = (seat.playerId === myId && myCard) || seat.card;
  const rec = pick && byChar ? byChar.get(pick) : null;
  if (rec) {
    const skin = seat.playerId === myId ? mySkin : seat.cardSkin;
    return rec.choices?.find(s => s.id === skin)?.portrait || chessPortraitUrl(m, rec) || rec.choices?.[0]?.portrait || null;
  }
  if (!Array.isArray(pool) || !pool.length) return null;
  return chessPortraitUrl(m, pool[hash32(seat.playerId) % pool.length]);
}

/** A profile image is independent of equipping a battle model. Only installed manifest URLs are returned. */
export function cardAvatarUrl(charId, skinId, manifest) {
  const rec = manifest?.chars?.[charId];
  if (skinId === `${charId}#2`) return rec?.avatarE2 || rec?.avatar || null;
  return rec?.skins?.[skinId]?.avatar || rec?.avatar || null;
}
export function chosenPortrait(charId, skinId, manifest, catalogue, chess = []) {
  const rec = catalogue?.chars?.[charId];
  const choice = rec?.choices?.find((row) => row.id === skinId);
  return choice?.portrait || manifest?.chars?.[charId]?.skins?.[skinId]?.portrait
    || chessPortraitUrl(manifest, chess.find((row) => row.charId === charId && row.isGolden) || chess.find((row) => row.charId === charId))
    || rec?.choices?.[0]?.portrait || null;
}

// Shared preference and portrait helpers used by the upstream card views.
/** The store field of the pick (ui/loadoutSync.js installCardSync `key`) and its sync state field. */
export const CARD_KEY = 'card';
export const CARD_SYNC_KEY = 'cardSync';
export const CARD_SKIN_KEY = 'cardSkin';

/** A stored pick as the store holds it: a charId string, '' for none (默认). */
export function parseStoredCard(v) {
  return typeof v === 'string' ? v : '';
}

/** This browser's pick and its sync state (survives room / match resets like ui/skins.js' store). */
export const cardStore = createStore({ [CARD_KEY]: parseStoredCard(loadPref(CARD_PREF, '')), [CARD_SKIN_KEY]: parseStoredCard(loadPref(CARD_SKIN_PREF, '')), [CARD_SYNC_KEY]: 'idle' });

/**
 * Pick the 名片干员 ('' = 默认): persisted at once, the sync engine sends it.
 * @param {string} charId
 */
export function setCard(charId, skinId = '') {
  const next = parseStoredCard(charId);
  try { savePref(CARD_PREF, next); savePref(CARD_SKIN_PREF, parseStoredCard(skinId)); } catch { /* private mode: the session keeps it */ }
  cardStore.set({ [CARD_KEY]: next, [CARD_SKIN_KEY]: parseStoredCard(skinId) });
}

/**
 * What the seat cards draw from: the pickable operators by charId and the default pool (5★/6★, by charId so every
 * client orders it the same). `extra` (#877): the cross-period records (rosterOperators) — they resolve a pick, never
 * the default pool, and a charId of the room's list keeps the room's record (a plugin's redefinition included).
 * @param {any[]} list cardOperators()
 * @param {{ pending?: boolean, extra?: any[] }} [opts]
 */
export function cardContext(list, extra = []) {
  return {
    byChar: new Map([...extra, ...list].map((c) => [c.charId, c])),
    pool: list.filter((c) => (c.rarity ?? 0) >= 5).sort((a, b) => (a.charId < b.charId ? -1 : a.charId > b.charId ? 1 : 0)),
  };
}

/**
 * The picker's groups (#877, DESIGN §37.325): first the room's version (`key` 'room': the room's own list, then any
 * roster record whose periods include the room's version — an official operator the room's plugins hide, [ASSUMED] 6:
 * it stays a card, in this group, whichever other periods list it too), then the other periods newest first
 * (shared/cardRoster.js CARD_PERIOD_ORDER reversed). Any other cross-period operator shows once, in the newest period
 * that lists it. Empty groups are left out.
 * @param {any[]} list cardOperators() of the room
 * @param {any[]} others rosterOperators()
 * @param {string} roomVersion the room's version id (versions.js roomVersion)
 * @returns {{ key: string, version: string, ops: any[] }[]}
 */
export function rosterOperators(raw, list, manifest, skins) {
  const roster = parseCardRoster(raw);
  if (!roster) return [];
  const existing = new Set(list.map(c => c.charId));
  const candidates = [...roster.byChar.values()].filter(c => !existing.has(c.charId));
  return cardOperators(candidates.map(c => ({ ...c, isGolden: c.golden })), null, manifest, skins);
}

export function cardGroups(list, others, roomVersion) {
  const room = Array.isArray(list) ? [...list] : [];
  /** @type {Map<string, any[]>} */
  const by = new Map();
  for (const c of Array.isArray(others) ? others : []) {
    if (!c) continue;
    const periods = Array.isArray(c.periods) ? c.periods : [];
    const rest = periods.filter((p) => p !== roomVersion && CARD_PERIOD_ORDER.includes(p));
    if (!rest.length || periods.includes(roomVersion)) { room.push(c); continue; }
    const key = rest.reduce((a, b) => (CARD_PERIOD_ORDER.indexOf(b) > CARD_PERIOD_ORDER.indexOf(a) ? b : a));
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(c);
  }
  const groups = [{ key: 'room', version: roomVersion, ops: room }];
  for (const v of [...CARD_PERIOD_ORDER].reverse()) if (by.has(v)) groups.push({ key: v, version: v, ops: by.get(v) });
  return groups.filter((g) => g.ops.length);
}

/**
 * The players whose outfits the strategy draft's name cards read (#877, DESIGN §37.325): the match's public players
 * (m.public.players[].skins), plus — only for the operators the match's data lacks (`matchOps`) — the room's seats'
 * (room.state seats[].skins). The match keeps only the operators of the data it plays (server/match/player/basics.js
 * setSkins), so a cross-period card's outfit comes from the room; for an operator of the match's data the match's map
 * alone decides (#877 review): `room.skins` during a match re-broadcasts no room.state (server/lobby.js skins), so the
 * room's seats keep the map from before the start, and an outfit a teammate took off in the match's 干员调配 would show
 * again. A player without a room seat keeps its own map.
 * @param {any[]} players m.public players
 * @param {any[] | null | undefined} roomSeats room.state seats
 * @param {Set<string> | null} [matchOps] the operators of the match's data (shared/protocol.js operatorCharIds of the
 *   room's files, the set setSkins keeps); null: none known yet, the room's map fills every gap
 * @returns {any[]}
 */
export function cardSkinPlayers(players, roomSeats, matchOps = null) {
  const list = Array.isArray(players) ? players : [];
  const seats = new Map();
  for (const s of Array.isArray(roomSeats) ? roomSeats : []) if (s && s.playerId != null) seats.set(s.playerId, s);
  return list.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const fromRoom = seats.get(p.playerId)?.skins;
    if (!fromRoom || typeof fromRoom !== 'object') return p;
    const extra = {};
    for (const [charId, skinId] of Object.entries(fromRoom)) if (!(matchOps instanceof Set && matchOps.has(charId))) extra[charId] = skinId;
    if (!Object.keys(extra).length) return p;
    return { ...p, skins: { ...extra, ...(p.skins && typeof p.skins === 'object' ? p.skins : {}) } };
  });
}

/**
 * The operator on a seat card: the player's pick (one's own seat shows the local pick at once, the others the server's
 * seats[].card), else one of the pool chosen by the player id [ASSUMED, see the header]. null for an empty seat, a bot,
 * or before the data loads.
 * @param {any} seat room.state seat
 * @param {{ byChar: Map<string, any>, pool: any[] }} ctx cardContext()
 * @param {{ myId?: any, myCard?: string }} [own]
 * @returns {{ chess: any, picked: boolean } | null}
 */
export function seatOperator(seat, { byChar, pool }, { myId, myCard } = {}) {
  if (!seat || seat.playerId == null || seat.isBot) return null;
  const pick = (seat.playerId === myId ? myCard : seat.card) || '';
  const rec = pick && byChar ? byChar.get(pick) : null;
  if (rec) return { chess: rec, picked: true };
  if (!Array.isArray(pool) || !pool.length) return null;
  return { chess: pool[hash32(seat.playerId) % pool.length], picked: false };
}

/**
 * The outfit a seat card's operator wears (docs/SKINS.md; the maintainer's decision 4 of 2026-10-21), by the rule of
 * every owner-aware card (ui/skins.js ownerSkin): one's own card wears this browser's choice at once (`localSkins`),
 * another doctor's the choice that seat published — `players` holds `{ playerId, skins }`: the room's seats
 * (room.state seats[].skins) or a match's public players — unless 「显示其他玩家的皮肤」 is off. null = the default art;
 * a skinId the local manifest does not hold (an appearance plugin this page lacks) also draws the default
 * (ui/assetUrls.js chessPortraitUrl falls back).
 * @param {any} seat a seat or player record (`playerId`, `isBot`)
 * @param {string | null | undefined} charId the operator the card shows (seatOperator)
 * @param {{ myId?: any, localSkins?: Record<string, string>, players?: any[], otherSkins?: boolean }} ctx
 * @returns {string | null}
 */
export function seatCardSkin(seat, charId, { myId = null, localSkins = {}, players = [], otherSkins = true } = {}) {
  if (!seat || seat.isBot || seat.playerId == null || !charId) return null;
  if (seat.playerId === myId) return ownerSkin(charId, { localSkins });
  return ownerSkin(charId, { ownerId: seat.playerId, myId, players: Array.isArray(players) ? players.filter(Boolean) : [], otherSkins });
}

/**
 * The picture a seat card draws: the first of `srcs` — the outfit's portrait, then the operator's default portrait — that
 * has not failed to load in this card (`failed`); null when none is left, and the card shows its avatar frame (§35.18's
 * leftover: an outfit file that failed went straight to the frame).
 * @param {(string | null | undefined)[]} srcs in order of preference
 * @param {readonly string[]} [failed]
 * @returns {string | null}
 */
export function seatArtSrc(srcs, failed = []) {
  for (const src of Array.isArray(srcs) ? srcs : []) if (src && !failed.includes(src)) return src;
  return null;
}

// [ASSUMED] Bounded UI recovery; a missing asset must not cause an endless request loop.
const SEAT_ART_RETRY_MS = [1000, 3000, 10000];

/** A transient image error must not hide the portrait until the seat is remounted. */
export function useSeatArt(srcs, owner) {
  const key = JSON.stringify([owner, ...srcs]);
  const latest = useRef(key);
  latest.current = key;
  const empty = () => ({ key, failed: [], attempt: 0 });
  const [state, setState] = useState(empty);
  const current = state.key === key ? state : empty();
  const src = seatArtSrc(srcs, current.failed);
  useEffect(() => { setState(previous => previous.key === key ? previous : empty()); }, [key]);
  useEffect(() => {
    if (!current.failed.length || current.attempt >= SEAT_ART_RETRY_MS.length) return;
    const timer = setTimeout(() => {
      if (latest.current !== key) return;
      setState(previous => previous.key === key ? { ...previous, failed: [], attempt: previous.attempt + 1 } : previous);
    }, SEAT_ART_RETRY_MS[current.attempt]);
    return () => clearTimeout(timer);
  }, [key, current.failed, current.attempt]);
  useEffect(() => {
    const recover = () => {
      if (latest.current === key) setState(previous => previous.key === key && previous.failed.length ? empty() : previous);
    };
    globalThis.addEventListener?.('online', recover);
    globalThis.addEventListener?.('focus', recover);
    return () => {
      globalThis.removeEventListener?.('online', recover);
      globalThis.removeEventListener?.('focus', recover);
    };
  }, [key]);
  return { src, onError: () => {
    if (!src || latest.current !== key) return;
    setState(previous => {
      const next = previous.key === key ? previous : empty();
      return next.failed.includes(src) ? next : { ...next, failed: [...next.failed, src] };
    });
  } };
}
