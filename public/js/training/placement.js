import { attackRangeGrid, loadoutRecord, resolveRecordLoadout } from '../../../shared/loadoutRecord.js';
import { rotateOffset } from '../ui/facing.js';

export function trainingRange(record, unit) {
  if (!record) return [];
  const loadout = resolveRecordLoadout(record, unit);
  return attackRangeGrid(loadoutRecord(record, loadout)) || record.rangeGrid || [];
}
export function rangeAt(record, unit) {
  return trainingRange(record, unit).map(([r, c]) => {
    const [dr, dc] = rotateOffset(r, c, unit.dir); return [unit.row + dr, unit.col + dc];
  });
}
export function legalTrainingTile(record, type) {
  return !!type && (type !== 'ranged' || record?.position !== 'MELEE' || /可以放置于远程位/.test(record?.trait?.desc || ''));
}
/** Prefer adjacent ground with the dummy in attack range. Deterministic, including non-attacking operators. */
export function autoTrainingPlacement(record, unit, mapEntries, occupied = []) {
  const candidates = [];
  const busy = new Set(occupied.map(u => `${u.row},${u.col}`));
  for (const [key, type] of mapEntries) {
    const [row, col] = key.split(',').map(Number);
    if (!legalTrainingTile(record, type) || busy.has(key) || (row === 10 && col === 6)) continue;
    for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
      const next = { ...unit, row, col, dir };
      const hits = rangeAt(record, next).some(([r, c]) => r === 10 && c === 6);
      const distance = Math.abs(row - 10) + Math.abs(col - 6);
      candidates.push({ ...next, score: (hits ? 0 : 100) + distance * 2 + (type === 'ranged' ? 1 : 0) });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  if (!candidates.length) return null;
  const { score: _score, ...best } = candidates[0]; return best;
}

export function prepTrainingState(doc, side, field, raw) {
  const player = doc.plans[side][field];
  const board = player.units.map(u => ({ ...u, id: u.chessId || u.tokenId, items: (u.items || []).map(id => ({ id })) }));
  let nextEnemies = [];
  if (doc.mode === 'team') {
    const spawns = doc._compiled?.spec.spawns || [];
    nextEnemies = spawns.slice(0, 20).map(e => ({ enemyKey: e.enemyKey, count: e.count, time: e.time, start: e.pos || doc._compiled?.spec.routes[e.routeIndex]?.start }));
  }
  const dummy = doc.mode === 'unit' ? [{ id: 'training-dummy-preview', uid: -1, kind: 'enemy', side: 'enemy', defId: 'enemy_1007_slime',
    name: 'training_dummy', spine: raw.enemies.enemy_1007_slime?.spine || 'enemy_1007_slime', avatar: 'enemy_1007_slime',
    x: 6, y: 10, facing: -1, maxHp: doc.dummy.hp }] : [];
  const other = doc.environment.kind !== 'normal' && doc.plans[side].length > 1 ? doc.plans[side][field ? 0 : 1].units.map(u => ({
    id: `mate-${u.uid}`, uid: u.uid, kind: u.kind === 'token' ? 'token' : 'op', side: 'ally', ownerId: `console-${field ? 1 : 2}`,
    defId: u.chessId || u.tokenId, spine: raw.chess[u.chessId]?.charId || raw.tokens[u.tokenId]?.assets?.spine,
    avatar: raw.chess[u.chessId]?.charId || u.tokenId, x: field ? u.col : 20 - u.col, y: u.row - 7, dir: u.dir, maxHp: 1 })) : [];
  return { board, hand: [], temp: [], nextEnemies, prepMapChars: dummy, bossMate: { units: other } };
}
