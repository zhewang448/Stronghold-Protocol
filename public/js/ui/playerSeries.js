// One seat palette for live charts, settled history, rankings and the host console.
import { poolGroupSizes } from '../../../shared/playerCapacity.js';

export const PLAYER_COLORS = Object.freeze([
  '#69adff', '#ff9973', '#64d5af', '#f2ca62', '#c7a1ff',
  '#ff83b1', '#6fdbe8', '#dfbc92', '#a8d975', '#d7dff0',
  '#8d99ff', '#ffbd85', '#50d5cf', '#e4a6e4', '#e9e074',
  '#9bc8ed', '#f18e91', '#a8c4a0', '#c8b8ed', '#e8b7c5',
]);

/** The same seat identity also colors avatars outside statistics; absent/invalid seats use the first seat. */
export function playerSeatColor(seat) {
  return PLAYER_COLORS[Number.isInteger(seat) && seat >= 0 && seat < PLAYER_COLORS.length ? seat : 0];
}

/** Prefer explicit seats/groups. Older records use the full opening roster and the fixed capacity layout. */
export function playerSeries(history, nameOf, { players = [], poolGroups = [] } = {}) {
  const roster = new Map();
  for (const p of players) {
    const id = p.playerId || p.id;
    if (id) roster.set(id, { ...p, playerId: id });
  }
  for (const h of history) for (const p of h.players || []) {
    if (!roster.has(p.playerId)) roster.set(p.playerId, p);
  }
  const validSeat = (seat) => Number.isInteger(seat) && seat >= 0 && seat < PLAYER_COLORS.length;
  const reserved = new Set([...roster.values()].filter(p => validSeat(p.seat)).map(p => p.seat)), used = new Set();
  const ordered = [...roster.values()].map((p) => {
    let seat = p.seat;
    if (!validSeat(seat) || used.has(seat)) {
      seat = 0;
      while (used.has(seat) || reserved.has(seat)) seat++;
    }
    used.add(seat);
    return { ...p, seat };
  })
    .sort((a, b) => a.seat - b.seat);
  const groups = new Map();
  if (poolGroups.length) {
    for (const g of poolGroups) for (const id of g.playerIds || []) groups.set(id, g.id);
  } else if (ordered.length && ordered.length <= PLAYER_COLORS.length) {
    let offset = 0;
    for (const [i, count] of poolGroupSizes(ordered.length).entries()) {
      for (const p of ordered.slice(offset, offset + count)) groups.set(p.playerId, i + 1);
      offset += count;
    }
  }
  return ordered.map((p) => ({ id: p.playerId, name: nameOf(p.playerId), seat: p.seat,
    group: groups.get(p.playerId) || null, color: playerSeatColor(p.seat) }));
}

export function selectedSeries(series, state, viewerId = '') {
  const groups = [...new Set(series.map((s) => s.group).filter(Boolean))].sort((a, b) => a - b);
  if (state.group == null) state.group = groups.length > 1 ? String(series.find((s) => s.id === viewerId)?.group || groups[0]) : '';
  if (state.group && !groups.includes(Number(state.group))) state.group = '';
  const visible = state.group ? series.filter((s) => s.group === Number(state.group)) : series;
  if (state.highlight && !visible.some((s) => s.id === state.highlight)) state.highlight = null;
  return { groups, visible };
}
