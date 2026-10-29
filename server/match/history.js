// server/match/history.js — the per-round record the local console charts (server/admin.js, server/admin.html): one entry
// per settled round with every player's LP, funds, shop level, running totals and this round's battle (LP lost, leaks,
// kills, damage, the units' damage) and the round's enemy composition.
// i18n-ignore-file: host-console data, no player-facing text (tools/i18n.mjs)
//
// recordRound(m) runs after normal or leader settlement before the next round resets results, and once more in
// finish() for an interrupted round. m.history is a MATCH_KEYS field (rewind.js): a rewind to round R's
// prep restores the record as it was then, rounds ≥ R gone.

import { battleDamage, unitStatsKey } from '../../shared/battleDamage.js';
import { diyRecordOf } from '../../shared/diy.js';
import { timelineAt } from './fields.js';
import { PHASE } from '../../shared/constants.js';

function mergeUnits(units) {
  const rows = new Map();
  for (const u of units) {
    if (!u || u.kind === 'token' || !(u.dmg > 0 || u.kills > 0)) continue;
    if (!u.name && !u.defId) continue;
    const key = unitStatsKey(u);
    const row = rows.get(key) || { ...(Number.isInteger(u.uid) ? { uid: u.uid } : {}), defId: u.defId, name: u.name || u.defId, dmg: 0, kills: 0 };
    row.dmg += Math.max(0, Math.round(Number(u.dmg) || 0));
    row.kills += Math.max(0, Math.trunc(Number(u.kills) || 0));
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.dmg - a.dmg || b.kills - a.kills);
}

/** Append m.round's entry to m.history (a no-op when the round is already recorded). */
export function recordRound(m, { includeBattleResults = true, uniteResult = null, uniteResults = null } = {}) {
  if (!Array.isArray(m.history)) m.history = [];
  if (m.history.some((h) => h.round === m.round)) return;
  const prev = m.history[m.history.length - 1];
  const before = new Map(prev ? prev.players.map((p) => [p.playerId, p]) : []);
  const waves = includeBattleResults ? (uniteResults || [uniteResult]).filter((r) => r && !r.synthetic) : [];
  const players = m.order.map((ps) => {
    const s = ps.stats;
    const b = before.get(ps.playerId);
    const r = includeBattleResults && m.lastResults && m.lastResults.get(ps.playerId);
    const units = mergeUnits([...(r?.unitStats || []), ...waves.flatMap((wave) => wave.perPlayer?.[ps.playerId]?.unitStats || [])]);
    const dmg = Math.round(s.dmgDealt);
    return {
      playerId: ps.playerId,
      alive: ps.alive,
      lp: Math.max(0, ps.lp),
      funds: ps.funds,
      level: ps.shop.level,
      spent: s.gold,
      dmg,
      bossDmg: Math.round(s.bossDamage),
      loss: s.lpLost - (b ? b.lpLost : 0),
      lpLost: s.lpLost,
      leaks: s.leaks - (b ? b.leaksTotal : 0),
      leaksTotal: s.leaks,
      kills: s.kills - (b ? b.killsTotal : 0),
      killsTotal: s.kills,
      roundDmg: dmg - (b ? b.dmg : 0),
      perfect: !!r && s.leaks === (b ? b.leaksTotal : 0) && r.perfect !== false,
      economy: ps.economy ? { ...structuredClone(ps.economy), closing: ps.funds, refreshes: ps.round.refreshes, buys: ps.round.buys, sells: ps.round.sells } : null,
      income: ps.economy ? Object.values(ps.economy.income).reduce((n, v) => n + v, 0) : null,
      expense: ps.economy ? Object.values(ps.economy.expense).reduce((n, v) => n + v, 0) : null,
      bonds: Object.entries(ps.lastRoundBonds || ps.bonds || {}).map(([id,b]) => ({ id, name: ps.gd.bond(id)?.name || id, noStack: !!ps.gd.bond(id)?.noStack, active: b.active, layers: b.layers, tier: b.tier })),
      leakDetails: includeBattleResults ? structuredClone(ps.leakHistory || []) : [],
      units,
    };
  });
  m.history.push({ round: m.round, enemy: enemyOf(m), players });
}

/** Public chart/ranking projection: omit economic sources, enemy overrides and host logs. */
export function roundChartHistory(m, { live = false } = {}) {
  const keys = ['playerId', 'alive', 'lp', 'funds', 'spent', 'dmg', 'roundDmg', 'level', 'income', 'expense'];
  const out = (m.history || []).map((h) => ({
    round: h.round,
    players: h.players.map((p) => ({
      ...Object.fromEntries(keys.map((key) => [key, p[key]])),
      units: (p.units || []).map(({ uid, defId, name, dmg, kills }) => ({ ...(Number.isInteger(uid) ? { uid } : {}), defId, name, dmg, kills })),
      bonds: (p.bonds || []).filter((b) => !(b.noStack || m.gd.bond(b.id)?.noStack))
        .map(({ id, name, active, layers }) => ({ id, name, active, layers })),
    })),
  }));
  if (!live || ![PHASE.COMBAT, PHASE.UNITE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE].includes(m.phase) || out.some((h) => h.round === m.round)) return out;
  const prev = out[out.length - 1];
  const base = new Map((prev?.players || []).map((p) => [p.playerId, p]));
  const ownResult = (pid) => m.phase === PHASE.UNITE ? m.lastResults?.get(pid) : null;
  const liveUnits = new Map(m.order.map((ps) => [ps.playerId, [...(ownResult(ps.playerId)?.unitStats || [])]]));
  const liveDamage = new Map(m.order.map((ps) => [ps.playerId, Number(ownResult(ps.playerId)?.damageDealt) || 0]));
  const addDamage = (pid, dmg, units) => {
    const amount = Number.isFinite(dmg) ? dmg : (units || []).reduce((n, u) => n + (Number(u.dmg) || 0), 0);
    liveDamage.set(pid, liveDamage.get(pid) + Math.min(1e13, Math.max(0, amount)));
  };
  // Completed waves disappear from m.fields when the next pair enters. Retain their accepted totals without
  // counting the current field twice; synthetic waves have no actual damage or operator ranking to publish.
  const addResult = (result) => {
    if (!result || result.synthetic) return;
    for (const [pid, p] of Object.entries(result.perPlayer || {})) if (liveUnits.has(pid)) {
      liveUnits.get(pid).push(...(p.unitStats || []));
      addDamage(pid, p.damageDealt, p.unitStats);
    }
  };
  if (m.phase === PHASE.UNITE) for (const result of m.unitePlan?.history || []) addResult(result);
  for (const f of m.fields || []) {
    if (f.done && f.result?.perPlayer) {
      addResult(f.result);
      continue;
    }
    // Headless bots may already have computed their whole fight: publish only the sample at the field clock.
    const damage = f.mode === 'server' && f.damageTimeline
      ? timelineAt(f.damageTimeline, m._fieldElapsed(f))[1]
      : (!f.cc || f.mode === 'server') && f.battle ? battleDamage(f.battle) : f.progress?.damage;
    for (const p of damage || []) {
      const rows = liveUnits.get(p.playerId);
      if (!rows || !f.players?.includes(p.playerId)) continue;
      addDamage(p.playerId, p.damageDealt, p.units);
      const specPlayer = (f.spec?.players || []).find((x) => x.playerId === p.playerId);
      const defs = new Map((specPlayer?.units || []).filter((u) => u.kind !== 'token').map((u) => {
        const base = m.gd.chess(u.chessId);
        const rec = u.standIn ? m.gd.standIn?.(u.chessId) : u.diy && base?.isDiy ? diyRecordOf(base, u.diy, m.gd.raw) : base;
        return [u.uid, { defId: u.chessId, name: rec?.name || u.chessId }];
      }));
      if (!f.spec) for (const owner of f.battle?.players || []) if (owner.playerId === p.playerId) {
        for (const u of owner.units || []) if (u.kind === 'op') defs.set(u.uid, { defId: u.defId, name: u.name });
      }
      for (const u of p.units || []) {
        const rec = defs.get(u.uid);
        if (rec) rows.push({ ...rec, uid: u.uid, dmg: Math.min(1e13, Math.max(0, Number(u.dmg) || 0)), kills: Math.min(1e9, Math.max(0, Number(u.kills) || 0)) });
      }
    }
  }
  out.push({ round: m.round, live: true, players: m.order.map((ps) => {
    const old = base.get(ps.playerId);
    const units = mergeUnits(liveUnits.get(ps.playerId) || []);
    const roundDmg = Math.round(liveDamage.get(ps.playerId) || 0);
    return { playerId: ps.playerId, alive: ps.alive, lp: old?.lp ?? null, funds: old?.funds ?? null, spent: old?.spent ?? null, dmg: (old?.dmg || 0) + roundDmg,
      roundDmg, level: old?.level ?? null, income: null, expense: null, units, bonds: old?.bonds || [] };
  }) });
  return out;
}

/** The round's composition (the shared pick of its wave; a leader round's escorts follow it), with names. */
function enemyOf(m) {
  const gd = m.gd;
  const boss = m.round === gd.bossRound || m.round === gd.hiddenRound;
  const pick = boss ? m.bossWaves && m.bossWaves[0] && m.bossWaves[0].wave.pick : m.wave && m.wave.pick;
  if (!pick) return null;
  const name = (k) => (k ? (gd.enemy(k) && gd.enemy(k).name) || k : null);
  const t = gd.factions.types && gd.factions.types[pick.type];
  return {
    type: pick.type, typeName: String((t && t.name) || pick.type).replace(/^特训敌人·/, ''), special: name(pick.key), normal: name(pick.normal),
    elite: name(pick.elite), fly: !!pick.fly, overridden: !!(m.adminPicks && m.adminPicks[m.round]),
  };
}
