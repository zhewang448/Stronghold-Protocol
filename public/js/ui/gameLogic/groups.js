// Permanent shared-pool identity, separate from the current boss-field pairing.

import { sortedPlayers } from './shared.js';

export const POOL_GROUP_COLORS = ['#83b8ee', '#b69ddd', '#d8b96d', '#81cbce', '#dda4c2'];

/** One fixed group identity, independent of its current members or display position. */
export function poolGroupIdentity(id) {
  if (!Number.isInteger(id) || id < 1 || id > POOL_GROUP_COLORS.length) return null;
  return { id, label: String.fromCharCode(64 + id), color: POOL_GROUP_COLORS[id - 1] };
}

/** Authoritative groups, including a single group whose player-list decoration is hidden. */
export function poolGroups(pub) {
  const groups = new Map();
  for (const g of Array.isArray(pub?.poolGroups) ? pub.poolGroups : []) {
    const identity = poolGroupIdentity(g?.id);
    if (!identity || groups.has(identity.id) || !Array.isArray(g.playerIds)) continue;
    const playerIds = [...new Set(g.playerIds.filter((id) => typeof id === 'string' && id))];
    if (!playerIds.length) continue;
    groups.set(identity.id, { ...identity, playerIds });
  }
  return [...groups.values()].sort((a, b) => a.id - b.id);
}

/** Membership stays fixed after death, leaving, disconnection, and AI takeover. */
export function playerPoolGroup(pub, playerId) {
  return poolGroups(pub).find((group) => group.playerIds.includes(playerId)) || null;
}

/**
 * Contiguous sections in occupied-seat order. Only m.public.poolGroups supplies membership;
 * missing metadata and a single pool keep the undecorated player list.
 */
export function poolGroupSections(pub) {
  const groups = poolGroups(pub);
  const byPlayer = new Map();
  if (groups.length > 1) {
    for (const group of groups) {
      for (const id of group.playerIds) if (!byPlayer.has(id)) byPlayer.set(id, group);
    }
  }
  const sections = [];
  for (const player of sortedPlayers(pub)) {
    const group = byPlayer.get(player.playerId) || null;
    const previous = sections[sections.length - 1];
    if (previous && previous.group === group) previous.players.push(player);
    else sections.push({ group, players: [player] });
  }
  return sections;
}
