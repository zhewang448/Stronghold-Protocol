// The historical cache predates the explicitly pinned three-operator extension.
// Reference checks use those three official records from their provenance snapshot;
// every other operator continues to use the untouched historical cache.
import { readFileSync } from 'node:fs';
const snapshot = JSON.parse(readFileSync(new URL('../../docs/research/new-operators-20261101.json', import.meta.url), 'utf8'));
export const scopedOperatorIds = Object.freeze([...snapshot.ids]);
export function officialCharactersForBackups(historical, backups) {
  return { ...historical, ...Object.fromEntries(snapshot.ids.filter(id => backups.units?.[id]).map(id => [id, snapshot.charTable[id]])) };
}
