// i18n-ignore-file: read-only host console statistics.
import fs from 'node:fs';
import path from 'node:path';
import { resultRules } from './admin-observability.js';

function validRecord(rec) {
  if (!rec || !Number.isFinite(rec.savedAt) || typeof rec.mode !== 'string' || typeof rec.difficulty !== 'string'
    || typeof rec.result?.victory !== 'boolean' || !Number.isFinite(rec.result.roundsPassed) || !Array.isArray(rec.result.players)) return false;
  const list = (x) => x == null || Array.isArray(x);
  if (!list(rec.history)) return false;
  for (const p of rec.result.players) if (!p || !list(p.lineup) || !list(p.bonds)) return false;
  for (const h of rec.history || []) {
    if (!h || !Array.isArray(h.players)) return false;
    for (const p of h.players) if (!p || !list(p.units) || !list(p.bonds)) return false;
  }
  return true;
}

/** Cache parsed records by file metadata; vanished records leave the cache immediately. */
export function createResultSummary(dir) {
  const cache = new Map();
  return function summary({ from, to, mode, difficulty, version, rules } = {}) {
    let files;
    try { files = fs.readdirSync(dir).filter((f) => /^[\w-]+\.json$/.test(f)); } catch { files = []; }
    const present = new Set(files);
    for (const key of cache.keys()) if (!present.has(key)) cache.delete(key);
    let skipped = 0, games = 0, wins = 0;
    const ruleCounts = { standard: 0, custom: 0, unknown: 0 };
    const groups = new Map(), operators = new Map(), bonds = new Map();
    const increment = (map, name) => { map.set(name, (map.get(name) || 0) + 1); };
    for (const file of files) {
      let rec;
      try {
        const filename = path.join(dir, file), stat = fs.statSync(filename);
        const signature = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
        if (cache.get(file)?.signature === signature) rec = cache.get(file).rec;
        else { rec = JSON.parse(fs.readFileSync(filename, 'utf8')); cache.set(file, { signature, rec }); }
        if (!validRecord(rec)) throw new Error('invalid');
      } catch { skipped++; continue; }
      if ((from && rec.savedAt < Number(from)) || (to && rec.savedAt > Number(to)) || (mode && rec.mode !== mode) || (difficulty && rec.difficulty !== difficulty)) continue;
      if (rec.result.test === true) continue;
      const recordVersion = rec.version || rec.result.version || 'act2autochess';
      if (version && recordVersion !== version) continue;
      const status = resultRules(rec);
      ruleCounts[status]++;
      if (['standard', 'custom', 'unknown'].includes(rules) && rules !== status) continue;
      games++; if (rec.result.victory) wins++;
      const key = JSON.stringify([rec.mode, rec.difficulty, recordVersion]);
      const group = groups.get(key) || { mode: rec.mode, difficulty: rec.difficulty, version: recordVersion, games: 0, wins: 0, rounds: 0 };
      group.games++; group.wins += Number(rec.result.victory);
      group.rounds += Math.max(rec.result.roundsPassed, ...(rec.history || []).map((h) => Number.isFinite(h.round) ? h.round : 0));
      groups.set(key, group);
      const used = new Set(), activated = new Set(), damage = new Map();
      const unit = (u) => { if (typeof u?.name === 'string') used.add(u.name); };
      for (const p of rec.result.players) {
        for (const u of p?.lineup || []) unit(u);
        for (const b of p?.bonds || []) if (b?.active && b.name) activated.add(b.name);
      }
      for (const h of rec.history || []) for (const p of h?.players || []) {
        for (const u of p?.units || []) {
          unit(u); if (typeof u?.name === 'string' && Number.isFinite(u.dmg) && u.dmg >= 0) damage.set(u.name, (damage.get(u.name) || 0) + u.dmg);
        }
        for (const b of p?.bonds || []) if (b?.active && b.name) activated.add(b.name);
      }
      for (const name of used) {
        const op = operators.get(name) || { name, games: 0, damage: 0, maxDamage: 0 };
        op.games++; op.damage += damage.get(name) || 0; op.maxDamage = Math.max(op.maxDamage, damage.get(name) || 0); operators.set(name, op);
      }
      for (const name of activated) increment(bonds, name);
    }
    return { games, wins, winRate: games ? wins / games : 0, skipped, ruleCounts,
      groups: [...groups.values()].map((g) => ({ ...g, winRate: g.wins / g.games, averageRound: g.rounds / g.games })),
      operators: [...operators.values()].sort((a, b) => b.games - a.games),
      bonds: [...bonds].map(([name, games]) => ({ name, games })).sort((a, b) => b.games - a.games) };
  };
}
