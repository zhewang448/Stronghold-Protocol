// Shared virtual-time runner and built-in bot metrics for matchrun and botbench.
export async function runMatch(m, done, { maxSteps = 5e6 } = {}) {
  try {
    return m.sched.runUntil(done, { maxSteps });
  } catch (error) {
    m.dispose();
    throw error;
  }
}

export function strategyMetrics(m, summary) {
  return (summary?.players || []).map((p) => ({
    seat: p.seat,
    strategy: m.bot?.id || 'legacy',
    survivalRound: p.eliminatedRound ?? m.round,
    roundsPassed: p.roundsPassed,
    finalLP: p.lp,
    damageDealt: p.stats.dmgDealt,
    leaderDamage: p.stats.bossDamage,
    wins: Number(p.victory),
  }));
}

export function aggregateStrategies(records) {
  const groups = new Map();
  for (const r of records) for (const p of r.strategyMetrics || []) {
    const key = `${r.config || r.difficulty}:${p.strategy}`;
    const stats = groups.get(key) || { key, seats: 0, survivalRound: 0, finalLP: 0, damageDealt: 0, leaderDamage: 0, wins: 0 };
    stats.seats++;
    for (const field of ['survivalRound', 'finalLP', 'damageDealt', 'leaderDamage', 'wins']) stats[field] += p[field];
    groups.set(key, stats);
  }
  return [...groups.values()].map((stats) => ({
    ...stats,
    survivalRound: stats.survivalRound / stats.seats,
    finalLP: stats.finalLP / stats.seats,
    damageDealt: stats.damageDealt / stats.seats,
    leaderDamage: stats.leaderDamage / stats.seats,
  }));
}
