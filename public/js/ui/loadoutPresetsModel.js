// Named local presets: cross-version snapshots, strict storage and reversible writes.
// [ASSUMED] Browser convenience; no simulation or protocol changes.
import { exportPayload, parseImport, LOADOUT_EXPORT_PARTS } from './loadoutModel.js';
import { cleanPicks, diyPrefKey, toStoredDiy } from './diyModel.js';
import { versionById } from '../../../shared/versions.js';

export const PRESETS_KEY = 'sp.pref.loadoutPresets';
export const PRESETS_LIMIT = 20;
export const DEFAULT_PARTS = Object.freeze({ skills: true, modules: true, potential: true, cultivate: true, skins: true, skinRandom: false, skinLocks: false });
const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
export function stable(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(v => JSON.parse(stable(v))));
  if (obj(value)) return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(stable(value[k]))])));
  return JSON.stringify(value);
}
export function presetError(code) { return Object.assign(new Error(code), { code }); }
export function presetName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || [...name].length > 24 || /[\u0000-\u001f\u007f]/u.test(name)) throw presetError('name');
  return name;
}
/** Version rosters use stable charIds, never recycled chessIds. Exclusive means absent from all other versions. */
export function operatorScope(mode, versions, rosters) {
  if (mode === 'all') return null;
  if (!['roster', 'exclusive'].includes(mode) || !versions.length || versions.some(id => !versionById(id))) throw presetError('scope');
  if (mode === 'exclusive' && Object.keys(rosters).length !== 4) throw presetError('loading');
  const selected = new Set();
  for (const id of versions) {
    const own = rosters[id];
    if (!Array.isArray(own)) throw presetError('loading');
    const others = new Set(Object.entries(rosters).filter(([key]) => key !== id).flatMap(([, ids]) => ids));
    for (const charId of own) if (mode === 'roster' || !others.has(charId)) selected.add(charId);
  }
  return { mode, versions: [...new Set(versions)].sort(), charIds: [...selected].sort() };
}
export function snapshotOf(current, parts = DEFAULT_PARTS, versions = [], scope = null) {
  const allowed = scope ? new Set(scope.charIds) : null;
  const filter = value => allowed ? Object.fromEntries(Object.entries(value || {}).filter(([id]) => allowed.has(id))) : value;
  const loadout = exportPayload(filter(current.byChar), { now: 0, ops: filter(current.ops), skins: filter(current.skins), sections: parts, random: current.random, locks: filter(current.random?.locked) });
  const diy = {};
  for (const id of versions) {
    if (!versionById(id)) throw presetError('invalid');
    diy[id] = cleanPicks(current.diy?.[id] || {});
  }
  return { loadout, diy, ...(scope ? { scope: structuredClone(scope) } : {}) };
}
export function snapshotEqual(a, b) { return stable(a) === stable(b); }
// A local preset may contain DIY alone. File imports intentionally reject an empty loadout;
// keep their contract and admit this one canonical empty snapshot only in the preset layer.
function parsePresetLoadout(raw) {
  const sections = raw?.extension?.sections;
  if (obj(sections) && LOADOUT_EXPORT_PARTS.every(k => sections[k] === false)) {
    const empty = exportPayload({}, { now: 0, ops: {}, skins: {}, sections });
    if (snapshotEqual(raw, empty)) return { ok: true, byChar: {}, ops: {}, sections };
  }
  return parseImport(raw);
}
export function readLibrary(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(PRESETS_KEY);
    if (raw == null) return { v: 1, activeId: null, items: [] };
    const value = JSON.parse(raw);
    if (value?.v > 2) throw presetError('newer');
    if (![1, 2].includes(value?.v) || !Array.isArray(value.items) || value.items.length > PRESETS_LIMIT) throw presetError('invalid');
    const ids = new Set(), names = new Set();
    for (const p of value.items) {
      const parsed = parsePresetLoadout(p?.snapshot?.loadout);
      if (!obj(p) || typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) || ids.has(p.id)
        || presetName(p.name) !== p.name || names.has(p.name) || !Number.isFinite(p.createdAt) || !Number.isFinite(p.updatedAt)
        || !parsed.ok || !parsed.sections || !obj(p.snapshot.diy)) throw presetError('invalid');
      const selected = LOADOUT_EXPORT_PARTS.some(k => parsed.sections[k]);
      if (!selected && !Object.keys(p.snapshot.diy).length) throw presetError('empty');
      for (const [v, picks] of Object.entries(p.snapshot.diy)) {
        if (!versionById(v) || !obj(picks) || stable(cleanPicks(picks)) !== stable(picks)) throw presetError('invalid');
      }
      // Reject damaged snapshots rather than silently turning malformed sections into defaults.
      const normalized = exportPayload(parsed.byChar || {}, { now: 0, ops: parsed.ops || {}, skins: parsed.skins || {}, sections: parsed.sections, random: parsed.skinRandom, locks: parsed.skinLocks });
      if (!snapshotEqual(normalized, p.snapshot.loadout)) throw presetError('invalid');
      const scope = p.snapshot.scope;
      if (scope !== undefined) {
        if (!obj(scope) || !['roster', 'exclusive'].includes(scope.mode) || !Array.isArray(scope.versions) || !scope.versions.length
          || scope.versions.some(id => !versionById(id)) || new Set(scope.versions).size !== scope.versions.length
          || !Array.isArray(scope.charIds) || scope.charIds.length > 1024 || new Set(scope.charIds).size !== scope.charIds.length
          || scope.charIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_\-.:]{1,64}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id))) throw presetError('invalid');
        const ids = new Set(scope.charIds);
        for (const map of [p.snapshot.loadout.byChar, p.snapshot.loadout.ops, p.snapshot.loadout.skins, p.snapshot.loadout.extension.skinLocks]) {
          if (map && Object.keys(map).some(id => !ids.has(id))) throw presetError('invalid');
        }
      }
      ids.add(p.id); names.add(p.name);
    }
    if (value.activeId !== null && !ids.has(value.activeId)) throw presetError('invalid');
    return value;
  } catch (e) { throw e?.code ? e : presetError('invalid'); }
}
export function putPreset(library, { id = null, name, snapshot, overwrite = false, now = Date.now(),
  newId = () => globalThis.crypto?.randomUUID?.() || `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` }) {
  name = presetName(name);
  if (!LOADOUT_EXPORT_PARTS.some(k => snapshot.loadout.extension.sections[k]) && !Object.keys(snapshot.diy).length) throw presetError('empty');
  const sameName = library.items.find(p => p.name === name && p.id !== id);
  if (sameName && !overwrite) throw presetError('duplicate');
  if (sameName) id = sameName.id;
  const previous = library.items.find(p => p.id === id);
  if (id && !previous) throw presetError('stale');
  if (!previous && library.items.length >= PRESETS_LIMIT) throw presetError('limit');
  const item = { id: previous?.id || newId(), name, createdAt: previous?.createdAt ?? now, updatedAt: now, snapshot: structuredClone(snapshot) };
  // A pre-scope browser must refuse the library instead of treating a scoped preset as a global reset.
  return { ...library, v: snapshot.scope ? 2 : library.v, activeId: item.id, items: [...library.items.filter(p => p.id !== item.id), item] };
}
export function renamePreset(library, id, name) {
  name = presetName(name);
  if (library.items.some(p => p.id !== id && p.name === name)) throw presetError('duplicate');
  return { ...library, items: library.items.map(p => p.id === id ? { ...p, name } : p) };
}
export function deletePreset(library, id) {
  return { ...library, activeId: library.activeId === id ? null : library.activeId, items: library.items.filter(p => p.id !== id) };
}
/** All storage writes finish before subscribers/network see any state. Restore exact old strings on failure. */
export function atomicWrite(writes, storage = globalThis.localStorage) {
  if (!storage) throw presetError('storage');
  const old = [];
  try {
    for (const [key, value] of writes) {
      old.push([key, storage.getItem(key)]);
      storage.setItem(key, value);
      if (storage.getItem(key) !== value) throw presetError('storage');
    }
  } catch {
    let failed = false;
    for (const [key, value] of old.reverse()) {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { failed = true; }
    }
    throw presetError(failed ? 'rollback' : 'storage');
  }
}
export function mergeSnapshot(current, snapshot, parts) {
  const incoming = parsePresetLoadout(snapshot.loadout);
  if (!incoming.ok) throw presetError('invalid');
  const scope = snapshot.scope ? new Set(snapshot.scope.charIds) : null;
  const merge = (before, after, fields) => {
    const out = structuredClone(before || {});
    for (const id of new Set([...Object.keys(out), ...Object.keys(after || {})])) {
      if (scope && !scope.has(id)) continue;
      const row = { ...(out[id] || {}) };
      for (const [part, field] of fields) if (parts[part]) {
        delete row[field];
        if (after?.[id]?.[field] !== undefined) row[field] = after[id][field];
      }
      if (Object.keys(row).length) out[id] = row; else delete out[id];
    }
    return out;
  };
  const scopedMap = (before, after) => scope ? { ...Object.fromEntries(Object.entries(before || {}).filter(([id]) => !scope.has(id))),
    ...Object.fromEntries(Object.entries(after || {}).filter(([id]) => scope.has(id))) } : after || {};
  return {
    byChar: merge(current.byChar, incoming.byChar, [['skills', 'skill'], ['modules', 'module']]),
    ops: merge(current.ops, incoming.ops, [['potential', 'potential'], ['cultivate', 'cultivate']]),
    skins: parts.skins ? scopedMap(current.skins, incoming.skins) : current.skins,
    random: { ...current.random, ...(parts.skinRandom ? incoming.skinRandom : {}), ...(parts.skinLocks ? { locked: scopedMap(current.random?.locked, incoming.skinLocks) } : {}) },
  };
}
export function diyWrites(diy) { return Object.entries(diy).map(([id, picks]) => ['sp.pref.' + diyPrefKey(id), JSON.stringify(toStoredDiy(picks))]); }
