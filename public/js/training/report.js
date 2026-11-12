// Training-only reporting composes the live game's effective-damage/healing meter without changing simulation state.
import { trackCombat, combineCombat, DAMAGE_TYPES } from '../battle/metrics.js';

function ownerOperator(unit) {
  const seen = new Set();
  while (unit?.kind === 'token' && unit.ownerUnit && !seen.has(unit)) { seen.add(unit); unit = unit.ownerUnit; }
  return unit?.side === 'ally' && unit.kind === 'op' ? unit : null;
}
const positive = n => Number.isFinite(n) && n > 0 ? n : 0;
export function createTrainingReport(battle, compiled) {
  const meter = trackCombat(battle), samples = [];
  let nextTick = 0;
  const accounting = () => {
    const value = combineCombat([meter()]), counters = new Map();
    for (const unit of battle.allyUnits) {
      const owner = ownerOperator(unit); if (!owner) continue;
      const key = `${owner.ownerId}:${owner.uid}`;
      const stats = counters.get(key) || { taken: 0, kills: 0, attacks: 0 };
      for (const field of ['taken', 'kills', 'attacks']) stats[field] += positive(unit.stats?.[field]);
      counters.set(key, stats);
    }
    const rows = value.rows.map(row => ({ ...row, ...(counters.get(`${row.ownerId}:${row.uid}`) || { taken: 0, kills: 0, attacks: 0 }) }));
    return { ...value, rows, taken: rows.reduce((n, row) => n + row.taken, 0),
      attacks: rows.reduce((n, row) => n + row.attacks, 0), creditedKills: rows.reduce((n, row) => n + row.kills, 0),
      types: Object.fromEntries(DAMAGE_TYPES.map(type => [type, rows.reduce((n, row) => n + row.types[type], 0)])) };
  };
  const point = value => ({ seconds: battle.time, damage: value.damage, healing: value.healing, taken: value.taken });
  const sample = () => {
    const ticks = Math.round(battle.time * 30);
    if (ticks < nextTick) return;
    samples.push(point(accounting())); nextTick = (Math.floor(ticks / 30) + 1) * 30;
  };
  const read = () => {
    const value = accounting(), result = battle.result(), seconds = battle.time;
    const series = samples.slice();
    if (!series.length || series.at(-1).seconds < seconds) series.push(point(value));
    const max = compiled.extraData?.enemies?.training_dummy?.stats.maxHp;
    const count = compiled.spec.spawns.find(s => s.enemyKey === 'training_dummy')?.count || 0;
    const targets = battle.units.filter(u => u.name === 'training_dummy');
    return { ...value, dps: seconds > 0 ? value.damage / seconds : 0, hps: seconds > 0 ? value.healing / seconds : 0,
      seconds, testSeconds: Math.min(compiled.cap, compiled.spec.timeLimit || compiled.cap), reason: result.reason, killed: result.killed, total: result.total,
      resolved: result.resolved, leaks: Object.values(result.perPlayer).reduce((n, p) => n + (p.leakedInTotal || 0), 0),
      bossHpLeft: result.bossHpLeft ?? null, bossHpMax: compiled.spec.boss?.poolMax ?? null,
      targetHpMax: max ? max * count : null,
      targetHpLeft: max ? targets.length ? targets.reduce((n, u) => n + Math.max(0, u.hp), 0) : max * count : null,
      series, version: compiled.version, cs: compiled.cs };
  };
  return { sample, read, stop: meter.stop };
}
