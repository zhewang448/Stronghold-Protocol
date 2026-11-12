// Player training documents. These values never become room intents or personal loadout writes.
import { newScenario, emptyPlayer, validateShape, keys, number, oneOf, fail, cloneScenario, SCENARIO_BYTES } from './studio/scenario.js';

export const TRAINING_VERSION = 1;
export const TRAINING_STORAGE = 'sp.training.v1';
export const TRAINING_TIMES = Object.freeze([30, 60, 120]);
export const TRAINING_SIDES = Object.freeze(['A', 'B']);

export function newTraining({ version, cs, scenario = newScenario() }) {
  const { stageId, modeId } = scenario;
  return { v: TRAINING_VERSION, name: '', version, cs, mode: 'unit',
    environment: { stageId, modeId, kind: 'normal', round: 1, seed: 1, seconds: 60, bossId: null, fields: 1 },
    dummy: { hp: 10000000, def: 0, res: 0, count: 1 },
    plans: { A: [emptyPlayer()], B: [emptyPlayer()] } };
}

export function trainingScenario(doc, side) {
  oneOf(side, TRAINING_SIDES, 'side');
  const { fields: _fields, ...environment } = doc.environment;
  return { ...newScenario(), ...environment, players: doc.plans[side] };
}

export function validateTraining(doc) {
  keys(doc, ['v', 'name', 'version', 'cs', 'mode', 'environment', 'dummy', 'plans'], 'training');
  if (doc.v !== TRAINING_VERSION) fail('v', 'version');
  if (typeof doc.name !== 'string' || doc.name.length > 120) fail('name', 'size');
  if (typeof doc.version !== 'string' || doc.version.length > 100) fail('version', 'id');
  if (typeof doc.cs !== 'string' || !/^[a-f0-9]{64}$/.test(doc.cs)) fail('cs', 'id');
  oneOf(doc.mode, ['unit', 'team'], 'mode');
  keys(doc.environment, ['stageId', 'modeId', 'kind', 'round', 'seed', 'seconds', 'bossId', 'fields'], 'environment');
  number(doc.environment.fields, 1, doc.environment.kind === 'normal' ? 1 : 2, 'environment.fields', true);
  oneOf(doc.environment.kind, ['normal', 'boss', 'hidden'], 'kind');
  keys(doc.dummy, ['hp', 'def', 'res', 'count'], 'dummy');
  number(doc.dummy.hp, 1, 1e10, 'dummy.hp');
  number(doc.dummy.def, 0, 1e6, 'dummy.def');
  number(doc.dummy.res, -100, 100, 'dummy.res');
  number(doc.dummy.count, 1, 12, 'dummy.count', true);
  keys(doc.plans, TRAINING_SIDES, 'plans');
  for (const side of TRAINING_SIDES) {
    const scenario = validateShape(trainingScenario(doc, side));
    if (scenario.players.length !== doc.environment.fields) fail('players', 'limit');
    if (doc.mode === 'unit') {
      oneOf(doc.environment.seconds, TRAINING_TIMES, 'seconds');
      if (scenario.players.length !== 1 || scenario.players[0].units.filter(u => u.kind === 'chess').length > 1) fail('players', 'limit');
      if (scenario.kind !== 'normal') fail('kind', 'unsupported');
    }
  }
  return cloneScenario(doc);
}

export function parseTraining(text) {
  if (typeof text !== 'string' || text.length > SCENARIO_BYTES) fail('training', 'size');
  let bytes = 0;
  for (const c of text) { const code = c.codePointAt(0); bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; }
  if (bytes > SCENARIO_BYTES) fail('training', 'size');
  let doc;
  try { doc = JSON.parse(text); } catch { fail('training', 'json'); }
  return validateTraining(doc);
}

// Include the public conditions in both fingerprints: changing an enemy or seed invalidates A and B together.
export function trainingFingerprint(doc, side) {
  return JSON.stringify([doc.version, doc.cs, doc.mode, doc.environment, doc.dummy, doc.plans[side]]);
}

export function copyTrainingPlan(doc, from, to) {
  return { ...doc, plans: { ...doc.plans, [to]: cloneScenario(doc.plans[from]) } };
}

export function metricDelta(a, b) {
  const delta = b - a;
  return { delta, percent: a === 0 ? null : delta / Math.abs(a) * 100 };
}

/** Differences retain their field paths so the UI can label actual changed controls in the current locale. */
export function trainingChanges(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [{ path, before: a, after: b }];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => trainingChanges(a[k], b[k], path ? `${path}.${k}` : k));
}
