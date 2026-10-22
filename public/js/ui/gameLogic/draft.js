// ui/gameLogic/draft.js — 机变 and band-draft normalisation. Re-exported from ../gameLogic.js.

import { isObj } from './shared.js';
import { poolGroupIdentity, poolGroups as normalizePoolGroups } from './groups.js';
import { MAX_DRAFT_CARDS, PHASE } from '../../../../shared/constants.js';
import { t } from '../../../../shared/i18n.js';

const playerIds = (players) => (Array.isArray(players) ? players : []).filter(isObj).map((p) => p.playerId);
const stringIds = (ids) => Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === 'string' && id))] : [];
const clockNumber = (value) => Number.isFinite(value) ? value : null;

function turnPlayer(turn, order) {
  if (typeof turn === 'string') return turn;
  return Number.isInteger(turn) && turn >= 0 && turn < order.length ? order[turn] : null;
}

function draftPage(draft, players, grouped = false) {
  const order = grouped ? stringIds(draft?.order)
    : Array.isArray(draft?.order) && draft.order.length ? draft.order.filter((x) => typeof x === 'string') : playerIds(players);
  const picks = new Map();
  const src = draft?.picks;
  if (Array.isArray(src)) {
    src.forEach((v, i) => {
      if (typeof v === 'string' && order[i]) picks.set(order[i], v);
      else if (isObj(v) && typeof v.playerId === 'string' && typeof v.bandId === 'string') picks.set(v.playerId, v.bandId);
    });
  } else if (isObj(src)) {
    for (const [k, v] of Object.entries(src)) if (typeof v === 'string' && v) picks.set(k, v);
  }
  const skipsLeft = new Map();
  const sk = draft?.skipsLeft ?? draft?.skips;
  if (isObj(sk)) for (const [k, v] of Object.entries(sk)) if (Number.isFinite(v)) skipsLeft.set(k, v);
  const done = typeof draft?.done === 'boolean' ? draft.done
    : (grouped || order.length > 0) && order.every((pid) => picks.has(pid));
  return {
    order, turnPid: turnPlayer(draft?.turn, order), picks, skipsLeft, done,
    untimed: !!draft?.untimed,
    turnDeadline: clockNumber(draft?.turnDeadline),
    turnSeconds: clockNumber(draft?.turnSeconds),
  };
}

function groupedPages(stage, fixedGroups, normalize) {
  const identities = new Map(normalizePoolGroups({ poolGroups: fixedGroups }).map((group) => [group.id, group]));
  const seen = new Set();
  return (Array.isArray(stage?.groups) ? stage.groups : []).flatMap((raw) => {
    const identity = poolGroupIdentity(raw?.id);
    if (!identity || seen.has(identity.id)) return [];
    const members = identities.get(identity.id)?.playerIds ?? stringIds(raw.playerIds);
    if (!members.length) return [];
    seen.add(identity.id);
    return [{ ...identity, playerIds: members.slice(), ...normalize(raw) }];
  }).sort((a, b) => a.id - b.id);
}

function ownGroupId(groups, fixedGroups, myId) {
  const fixed = normalizePoolGroups({ poolGroups: fixedGroups });
  const source = fixed.length ? fixed : groups;
  return source.find((group) => group.playerIds.includes(myId))?.id ?? null;
}

function stageId(stage) {
  return typeof stage?.id === 'string' ? stage.id : null;
}

// ---- 机变 / band draft normalisation ----------------------------------------------------------------------

/**
 * Normalise m.public.draft ({order, turn, picks, skips?}) — tolerant of index/playerId turns and
 * object/array picks.
 * @param {any} draft
 * Grouped frames select my fixed pool group; legacy frames retain their original order fallback.
 * @param {any[]} [players]
 * @param {string|null} [myId]
 * @param {any[]} [fixedGroups]
 */
export function normalizeDraft(draft, players = [], myId = null, fixedGroups = []) {
  const groups = groupedPages(draft, fixedGroups, (raw) => draftPage(raw, players, true));
  const mine = ownGroupId(groups, fixedGroups, myId);
  const selected = groups.find((group) => group.id === mine) || groups[0];
  const page = selected || draftPage(draft, players);
  const allPicks = draftPage(draft, players).picks;
  for (const group of groups) for (const [pid, bandId] of group.picks) allPicks.set(pid, bandId);
  return {
    ...page, id: stageId(draft), groupId: selected?.id ?? mine, ownGroupId: mine,
    groups, allPicks, allDone: groups.length ? groups.every((group) => group.done) : page.done,
  };
}

function spPage(sp, players, grouped = false, inherited = null) {
  const order = grouped ? stringIds(sp.order)
    : Array.isArray(sp.order) && sp.order.length ? sp.order.filter((x) => typeof x === 'string') : playerIds(players);
  const cards = (Array.isArray(sp.cards) ? sp.cards : []).slice(0, MAX_DRAFT_CARDS).map((c, idx) => {
    const card = typeof c === 'string' ? { id: c } : isObj(c) ? { ...c } : {};
    return { ...card, idx, takenBy: typeof card.takenBy === 'string' ? card.takenBy : null };
  });
  const takenBy = new Map(); // idx → playerId, scoped to this page only
  const pickOf = new Map(); // playerId → idx
  const src = sp.picks;
  const add = (pid, idx) => {
    if (typeof pid !== 'string' || !Number.isInteger(idx) || idx < 0 || idx >= cards.length) return;
    takenBy.set(idx, pid);
    pickOf.set(pid, idx);
  };
  if (Array.isArray(src)) src.forEach((v, i) => { if (isObj(v)) add(v.playerId, v.idx); else if (Number.isInteger(v) && order[i]) add(order[i], v); });
  else if (isObj(src)) for (const [k, v] of Object.entries(src)) add(k, v);
  if (isObj(sp.taken)) for (const [k, v] of Object.entries(sp.taken)) add(v, Number(k));
  for (const c of cards) if (c.takenBy) add(c.takenBy, c.idx);
  for (const c of cards) c.takenBy = takenBy.get(c.idx) ?? null;
  const meta = (key) => {
    const value = sp[key] ?? inherited?.[key];
    return typeof value === 'string' && value ? value : null;
  };
  const done = typeof sp.done === 'boolean' ? sp.done
    : (grouped || order.length > 0) && order.every((pid) => pickOf.has(pid));
  return {
    family: meta('family'), name: meta('name'), desc: meta('desc'), eventId: meta('eventId'),
    untimed: !!(sp.untimed ?? inherited?.untimed),
    turnDeadline: clockNumber(sp.turnDeadline), turnSeconds: clockNumber(sp.turnSeconds),
    cards, order, turnPid: turnPlayer(sp.turn, order), pickOf, takenBy, pickedCount: pickOf.size, done,
  };
}

/**
 * Normalise m.public.sp ({family, cards, turn, picks, order?}).
 * Cards: string ids or objects; picks: {playerId: cardIdx} | [{playerId, idx}] | card.takenBy.
 * @param {any} sp
 * @param {any[]} [players]
 * @param {string|null} [myId]
 * @param {any[]} [fixedGroups]
 * @param {number|null} [viewGroupId]
 */
export function normalizeSp(sp, players = [], myId = null, fixedGroups = [], viewGroupId = null) {
  if (!isObj(sp)) return null;
  const groups = groupedPages(sp, fixedGroups, (raw) => spPage(raw, players, true, sp));
  const mine = ownGroupId(groups, fixedGroups, myId);
  const selected = groups.find((group) => group.id === viewGroupId)
    || groups.find((group) => group.id === mine) || groups[0];
  const page = selected || spPage(sp, players);
  return {
    ...page, id: stageId(sp), groupId: selected?.id ?? mine, ownGroupId: mine, groups,
    allDone: groups.length ? groups.every((group) => group.done) : page.done,
  };
}

/** Adapt only the recipient's current PREP choice; never write it into the public draft. */
export function normalizePersonalChoice(pub, priv, myId) {
  const choice = priv?.personalChoice;
  if (pub?.phase !== PHASE.PREP || !priv || priv.playerId !== myId || priv.alive === false
    || !choice || choice.round !== pub.round) return null;
  return {
    ...normalizeSp({ family: 'bounty', name: t('教鞭 · 战术特训'), desc: t('请选择一项战术特训'),
      cards: choice.cards, turn: myId, order: [myId], picks: {} }),
    id: choice.id,
  };
}
