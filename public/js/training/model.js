import { parseTraining, TRAINING_STORAGE } from '../../../shared/training.js';
import { parseStoredByChar, parseStoredOps, parseStored, charKeyMap, entriesToChar } from '../ui/loadoutModel.js';
import { t } from '../../../shared/i18n.js';

/** Official mode names are shared across solo/co-op, but their rule identities are distinct. */
export function trainingModeLabel(mode, displayName = mode.name) {
  return `${mode.type === 'MULTI' ? t('同盟模拟') : t('独立模拟')} · ${displayName}`;
}

export function readLibrary(storage) {
  try {
    const value = JSON.parse((storage || globalThis.localStorage).getItem(TRAINING_STORAGE) || '{}');
    return { drafts: value?.drafts && typeof value.drafts === 'object' ? value.drafts : {},
      saved: Array.isArray(value?.saved) ? value.saved.slice(0, 20) : [] };
  } catch { return { drafts: {}, saved: [] }; }
}

export function writeLibrary(value, storage) {
  try { (storage || globalThis.localStorage).setItem(TRAINING_STORAGE, JSON.stringify(value)); return true; } catch { return false; }
}

export function storedTraining(text) { return parseTraining(typeof text === 'string' ? text : JSON.stringify(text)); }

/** Read by charId across versions. Legacy chess-id preferences are mapped through the original version only. */
export function personalUnit(record, raw, preference, legacyRaw = null) {
  let choices = parseStoredByChar(preference);
  if (preference?.v !== 2 && legacyRaw) {
    const map = charKeyMap(Object.values(legacyRaw.chess || {}));
    choices = entriesToChar(parseStored(preference), id => map.toChar.get(id));
  }
  const choice = choices[record.charId] || {};
  const ops = parseStoredOps(preference)[record.charId] || {};
  const selected = raw.chess[record.chessId] || record;
  return { kind: 'chess', chessId: selected.chessId, dir: 'RIGHT', items: [],
    ...(selected.skills?.some(s => s.index === choice.skill) ? { skillIndex: choice.skill } : {}),
    ...(choice.module === 'none' || selected.modules?.some(m => m.uniEquipId === choice.module) ? { moduleId: choice.module } : {}),
    ...ops };
}

export function changeLabels(path) {
  return path.split('.').filter(x => !/^\d+$/.test(x) && !['units', 'players', 'plans'].includes(x)).at(-1) || path;
}
