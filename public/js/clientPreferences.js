import { createStore, loadPref, savePref } from './store.js';
import { defaultClientPreferencePolicy, normalizeClientPreferencePolicy } from '../../shared/clientPreferences.js';

// Policy is scoped to the current server connection and is never persisted.
// The source preference stays sparse: a host default for an unseen option must
// not turn into a saved user choice when an unrelated option is changed.
export const clientPreferencePolicy = createStore({ config: defaultClientPreferencePolicy() });
export const canChangeClientPreference = key => clientPreferencePolicy.get().config.userControls[key] !== false;
export function setClientPreferencePolicy(raw) {
  const result = normalizeClientPreferencePolicy(raw || {});
  if (!result.error && JSON.stringify(result.config) !== JSON.stringify(clientPreferencePolicy.get().config)) clientPreferencePolicy.set({ config: result.config });
  return !result.error;
}
export function resolveClientPreference(key, saved) {
  const { defaults, userControls } = clientPreferencePolicy.get().config;
  return structuredClone(userControls[key] === false || saved === undefined ? defaults[key] : saved);
}

/** Compatible observable store with a private persisted layer and a public
 * effective layer. Policy updates only publish; user writes only save permitted
 * fields. External tests and legacy callers may keep using set/patch/reset. */
export function createClientPreferenceStore({ prefix, preference, normalize = v => v || {}, migrate = v => v || {}, initial = undefined, fields = null, persist = v => v }) {
  const loaded = initial === undefined ? loadPref(preference, null) : initial;
  const migrated = migrate(loaded);
  let saved = migrated && typeof migrated === 'object' && !Array.isArray(migrated) ? { ...migrated } : {}, effective;
  const known = () => fields || Object.keys(clientPreferencePolicy.get().config.defaults).filter(k => k.startsWith(prefix + '.')).map(k => k.slice(prefix.length + 1));
  const policyKey = key => prefix ? prefix + '.' + key : key;
  const calculate = () => {
    const values = { ...saved };
    for (const key of known()) values[key] = resolveClientPreference(policyKey(key), saved[key]);
    return normalize(values);
  };
  effective = createStore(calculate());
  const publish = () => { const next = calculate(); if (JSON.stringify(next) !== JSON.stringify(effective.get())) effective.set(next); };
  clientPreferencePolicy.subscribe(publish);
  const write = patch => {
    const proposed = typeof patch === 'function' ? patch(effective.get()) : patch;
    if (!proposed || typeof proposed !== 'object') return;
    const allowed = Object.fromEntries(Object.entries(proposed).filter(([key]) => !known().includes(key) || canChangeClientPreference(policyKey(key))));
    // A function often returns a normalized full settings object. Only changes
    // against effective state are user changes; retain absent defaults as absent.
    const changes = Object.fromEntries(Object.entries(allowed).filter(([key, value]) => typeof patch !== 'function' || JSON.stringify(value) !== JSON.stringify(effective.get()[key]) || Object.hasOwn(saved, key)));
    if (!Object.keys(changes).length) return;
    const sanitized = normalize({ ...saved, ...changes });
    for (const key of Object.keys(changes)) saved[key] = sanitized[key];
    savePref(preference, persist(saved)); publish();
  };
  return { get: effective.get, subscribe: effective.subscribe, set: write,
    patch(key, patch) { const value = typeof patch === 'function' ? patch(effective.get()[key]) : patch; write({ [key]: { ...effective.get()[key], ...value } }); },
    reset() { write(normalize({})); }, saved: () => structuredClone(saved), refresh: publish };
}
