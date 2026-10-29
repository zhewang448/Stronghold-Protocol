// Read-only, bounded operator counters used by the live progress view.
export const LIVE_DAMAGE_UNITS = 64;
export function unitStatsKey(unit) {
  return Number.isInteger(unit?.uid) && unit.uid >= 1 && unit.uid <= 2 ** 31
    ? `uid:${unit.uid}`
    : `legacy:${JSON.stringify([unit?.defId || '', unit?.name || ''])}`;
}
const counter = (n, cap = 1e13) => Number.isFinite(n) && n > 0 ? Math.min(cap, Math.round(n)) : 0;

export function battleDamage(battle) {
  return (battle?.players || []).slice(0, 4).map((p) => ({
    playerId: p.playerId,
    // Keep the curve's total consistent with settlement, including summons omitted from the operator ranking.
    damageDealt: counter(battle._perPlayer?.[p.playerId]?.damageDealt),
    units: (p.units || []).filter((u) => u.kind === 'op' && u.uid != null).slice(0, LIVE_DAMAGE_UNITS)
      .map((u) => ({ uid: u.uid, dmg: counter(u.stats?.dmg), kills: counter(u.stats?.kills, 1e9) })),
  }));
}
