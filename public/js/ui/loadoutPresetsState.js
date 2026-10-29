// Browser adapter: strict persistence first, publish to existing sync stores only after success.
import { createStore, store } from '../store.js';
import { data } from '../data.js';
import { pageVersion } from '../content.js';
import { PHASE } from '../../../shared/constants.js';
import { VERSIONS } from '../../../shared/versions.js';
import { ruleOption } from '../../../shared/plugins/rules.js';
import { effectiveRoomRules } from '../../../shared/roomConvenience.js';
import { loadoutStore, preparePresetLoadout, publishPresetLoadout, preparePresetOwnership, publishPresetOwnership } from './loadoutSync.js';
import { skinsStore, skinRandomStore } from './skins.js';
import { cleanPicks, parseStoredDiy, diyPrefKey, sanitizeDiyPicks } from './diyModel.js';
import { PRESETS_KEY, readLibrary, atomicWrite, snapshotOf, snapshotEqual, mergeSnapshot, diyWrites, presetError, stable } from './loadoutPresetsModel.js';
import { rosterOf } from './loadoutModel.js';
import { checkLoadout, cultivationCharIds } from '../../../shared/protocol.js';
import { isDroppableChess } from '../../../shared/standIn.js';

function initial() {
  try { return { library: readLibrary(), error: null }; } catch (e) { return { library: null, error: e.code }; }
}
export const presetsStore = createStore(initial());
export function reloadPresets() { presetsStore.set(initial()); }
globalThis.addEventListener?.('storage', e => { if (e.key === PRESETS_KEY || e.key === null) reloadPresets(); });
export function currentPresetState(storage = globalThis.localStorage, versions = VERSIONS.map(v => v.id)) {
  const s = loadoutStore.get();
  const diy = {};
  for (const v of VERSIONS) {
    if (!versions.includes(v.id)) continue;
    if (v.id === s.diyVersion) diy[v.id] = s.diy;
    else {
      const raw = storage?.getItem('sp.pref.' + diyPrefKey(v.id));
      try { diy[v.id] = raw === null ? {} : parseStoredDiy(JSON.parse(raw)); } catch { throw presetError('invalid'); }
    }
  }
  return { byChar: s.byChar || {}, ops: s.ops, skins: skinsStore.get().skins, random: skinRandomStore.get(), notOwnedChars: s.notOwnedChars, diy };
}
export function saveLibrary(library, storage = globalThis.localStorage) {
  atomicWrite([[PRESETS_KEY, JSON.stringify(library)]], storage);
  presetsStore.set({ library, error: null });
}
export function capturePreset(parts, versions, scope = null) {
  if (!loadoutStore.get().byChar) throw presetError('loading');
  return snapshotOf(currentPresetState(globalThis.localStorage, versions), parts, versions, scope);
}
export function presetDirty(item) {
  try { return !snapshotEqual(capturePreset({ ...item.snapshot.loadout.extension.sections, ownership: item.snapshot.ownership !== undefined }, Object.keys(item.snapshot.diy), item.snapshot.scope || null), item.snapshot); } catch { return true; }
}
export function presetPermissions(app = store.get(), ls = loadoutStore.get()) {
  const phase = app.match?.public?.phase;
  const playing = !!app.room?.inMatch;
  const prep = phase === PHASE.PREP && ruleOption(effectiveRoomRules(app.room), 'prepLoadout') === 'prep' && !app.match?.private?.ready;
  return { loadout: !((playing && phase && phase !== PHASE.INFO_CHECK && phase !== PHASE.LOBBY && !prep) || ls.sync === 'locked'),
    diy: !playing && ls.diySync !== 'locked', ownership: !playing && ls.ownSync !== 'locked' && ls.notOwnedChars != null };
}
const versionData = new Map();
let operatorRosters = null;
/** Official selectable chess rosters only. DIY-only operators remain covered by the all-settings option. */
export async function loadPresetRosters() {
  if (operatorRosters) return operatorRosters;
  const rows = await Promise.all(VERSIONS.map(async v => {
    const response = await fetch('/data/' + v.dir + 'chess.json');
    if (!response.ok) throw presetError('data');
    const chess = await response.json();
    if (!chess || typeof chess !== 'object' || Array.isArray(chess)) throw presetError('data');
    const ids = [...new Set(rosterOf(Object.values(chess)).map(c => c.charId))];
    if (!ids.length) throw presetError('data');
    return [v.id, ids];
  }));
  operatorRosters = Object.fromEntries(rows);
  return operatorRosters;
}
async function getDiyData(id) {
  if (id === pageVersion()) {
    if (!data.get('chess') || !data.get('backups')) throw presetError('loading');
    return { chess: data.get('chess'), backups: data.get('backups') };
  }
  const v = VERSIONS.find(v => v.id === id);
  if (!v) throw presetError('invalid');
  if (!versionData.has(id)) {
    const result = await Promise.all(['chess', 'backups'].map(async table => {
      const r = await fetch('/data/' + v.dir + table + '.json');
      if (!r.ok) throw presetError('data');
      return r.json();
    }));
    versionData.set(id, { chess: result[0], backups: result[1] });
  }
  return versionData.get(id);
}
/** Preview may load other versions, but never changes pageVersion, preferences, room or store. */
export async function inspectPreset(item, versions) {
  const diy = {}, dropped = [];
  for (const id of versions) {
    const raw = item.snapshot.diy[id];
    if (!raw) continue;
    const tables = await getDiyData(id);
    const clean = sanitizeDiyPicks(raw, tables, loadoutStore.get().diyKitted);
    diy[id] = cleanPicks(raw);
    for (const [slot, pick] of Object.entries(raw)) {
      // Normalisation may add defaults; report loss of the pick, not harmless default fields.
      if (!clean[slot] || clean[slot].charId !== pick.charId
        || (pick.skillIndex !== undefined && clean[slot].skillIndex !== pick.skillIndex)
        || (pick.uniEquipId != null && clean[slot].uniEquipId !== pick.uniEquipId)) {
        dropped.push({ version: id, slot, name: tables.backups?.units?.[pick.charId]?.name || pick.charId });
        delete diy[id][slot];
      }
    }
  }
  return { diy, dropped };
}
/** Rechecks phases after asynchronous validation, before any persistent or observable mutation. */
export async function applyPreset(item, parts, versions, { skipInvalid = false, storage = globalThis.localStorage } = {}) {
  if (!loadoutStore.get().byChar) throw presetError('loading');
  if (parts.ownership && item.snapshot.ownership === undefined) throw presetError('invalid');
  const shownVersion = pageVersion(), contentId = data.contentId();
  const inspected = await inspectPreset(item, versions);
  if (parts.ownership && item.snapshot.ownership !== undefined) await validateOwnership(item.snapshot);
  if (shownVersion !== pageVersion() || contentId !== data.contentId()) throw presetError('stale');
  if (inspected.dropped.length && !skipInvalid) return { needsConfirmation: inspected.dropped };
  const allowed = presetPermissions();
  if ((!allowed.loadout && ['skills', 'modules', 'potential', 'cultivate'].some(k => parts[k]))
    || (!allowed.diy && versions.length) || (!allowed.ownership && parts.ownership)) throw presetError('locked');
  if (!Object.values(parts).some(Boolean) && !versions.length) throw presetError('empty');
  const library = readLibrary(storage);
  if (!library.items.some(p => p.id === item.id && stable(p) === stable(item))) throw presetError('stale');
  const next = mergeSnapshot(currentPresetState(storage, []), item.snapshot, parts);
  const selected = { ...item.snapshot.loadout.extension.sections, ownership: item.snapshot.ownership !== undefined };
  const full = stable(selected) === stable(parts) && stable(Object.keys(item.snapshot.diy).sort()) === stable([...versions].sort()) && !inspected.dropped.length;
  const nextLibrary = { ...library, activeId: full ? item.id : null };
  const changesLoadout = ['skills', 'modules', 'potential', 'cultivate'].some(k => parts[k]);
  const writes = [...(changesLoadout ? [['sp.pref.loadout', JSON.stringify(preparePresetLoadout(next.byChar, next.ops))]] : []),
    ...(parts.skins ? [['sp.pref.skins', JSON.stringify(next.skins)]] : []),
    ...(parts.skinRandom || parts.skinLocks ? [['sp.pref.skinRandom', JSON.stringify(next.random)]] : []),
    ...(parts.ownership && item.snapshot.ownership !== undefined ? [['sp.pref.ownership', JSON.stringify(preparePresetOwnership(next.notOwnedChars))]] : []),
    ...diyWrites(inspected.diy), [PRESETS_KEY, JSON.stringify(nextLibrary)]];
  atomicWrite(writes, storage);
  // All writes succeeded: publish complete snapshots. Existing sync debounces the resulting requests.
  const currentDiy = Object.hasOwn(inspected.diy, pageVersion()) ? cleanPicks(inspected.diy[pageVersion()]) : undefined;
  if (changesLoadout) publishPresetLoadout(next.byChar, next.ops, currentDiy);
  else if (currentDiy !== undefined) loadoutStore.set({ diy: currentDiy });
  if (parts.skins) skinsStore.set({ skins: next.skins });
  if (parts.skinRandom || parts.skinLocks) skinRandomStore.set(next.random);
  if (parts.ownership && item.snapshot.ownership !== undefined) publishPresetOwnership(next.notOwnedChars);
  presetsStore.set({ library: nextLibrary, error: null });
  return { applied: true, skipped: inspected.dropped };
}

/** File imports share snapshot replacement, phase guards and transaction semantics without creating a preset. */
export function applyTransferredSnapshot(snapshot, parts, storage = globalThis.localStorage) {
  if (!loadoutStore.get().byChar) throw presetError('loading');
  if (parts.ownership && snapshot.ownership === undefined) throw presetError('invalid');
  const changesLoadout = ['skills', 'modules', 'potential', 'cultivate'].some(k => parts[k]);
  if (changesLoadout && !presetPermissions().loadout) throw presetError('locked');
  if (parts.ownership && !presetPermissions().ownership) throw presetError('locked');
  if (!Object.values(parts).some(Boolean)) throw presetError('empty');
  if (snapshot.scope && !snapshot.scope.charIds.length && Object.entries(parts).some(([key, on]) => on && key !== 'skinRandom')) throw presetError('scopeEmpty');
  const next = mergeSnapshot(currentPresetState(storage, []), snapshot, parts);
  const writes = [...(changesLoadout ? [['sp.pref.loadout', JSON.stringify(preparePresetLoadout(next.byChar, next.ops))]] : []),
    ...(parts.skins ? [['sp.pref.skins', JSON.stringify(next.skins)]] : []),
    ...(parts.skinRandom || parts.skinLocks ? [['sp.pref.skinRandom', JSON.stringify(next.random)]] : []),
    ...(parts.ownership && snapshot.ownership !== undefined ? [['sp.pref.ownership', JSON.stringify(preparePresetOwnership(next.notOwnedChars))]] : [])];
  atomicWrite(writes, storage);
  if (changesLoadout) publishPresetLoadout(next.byChar, next.ops);
  if (parts.skins) skinsStore.set({ skins: next.skins });
  if (parts.skinRandom || parts.skinLocks) skinRandomStore.set(next.random);
  if (parts.ownership && snapshot.ownership !== undefined) publishPresetOwnership(next.notOwnedChars);
}

/** Keep valid explicit defaults, but never turn rejected choices into an empty replacement.
 * Historical-only choices may be valid in another official version and must remain stored. */
export async function validateTransferChoices(snapshot, parts, sourceOps = []) {
  const initialVersion = pageVersion(), initialContent = data.contentId();
  const shown = { chess: data.get('chess'), backups: data.get('backups') };
  if (!shown.chess || !shown.backups) throw presetError('loading');
  if (parts.ownership && snapshot.ownership !== undefined) await validateOwnership(snapshot);
  const tables = [shown];
  let historical = false;
  const allowed = snapshot.scope ? new Set(snapshot.scope.charIds) : null;
  const entries = Object.entries(snapshot.loadout.byChar || {}).filter(([id]) => !allowed || allowed.has(id));
  const ops = [...new Set([...Object.keys(snapshot.loadout.ops || {}), ...sourceOps])].filter(id => !allowed || allowed.has(id));
  const validChoice = (id, entry, table) => {
    const base = rosterOf(Object.values(table.chess)).find(c => c.charId === id);
    if (!base) return false;
    const fields = {};
    if (parts.skills && entry.skill !== undefined) fields.skill = entry.skill;
    if (parts.modules && entry.module !== undefined) fields.module = entry.module;
    if (!Object.keys(fields).length) return true;
    return !!checkLoadout({ [base.chessId]: fields }, key => table.chess[key] || null).ok;
  };
  const ensureHistory = async () => {
    if (historical) return;
    tables.push(...await Promise.all(VERSIONS.filter(v => v.id !== initialVersion).map(v => getDiyData(v.id))));
    historical = true;
  };
  for (const [id, entry] of entries) {
    if (!parts.skills && !parts.modules) break;
    if (!tables.some(table => validChoice(id, entry, table))) await ensureHistory();
    if (!tables.some(table => validChoice(id, entry, table))) throw presetError('choice');
  }
  for (const id of ops) {
    if (!parts.potential && !parts.cultivate) break;
    if (!tables.some(table => cultivationCharIds(table.chess, table.backups).has(id))) await ensureHistory();
    if (!tables.some(table => cultivationCharIds(table.chess, table.backups).has(id))) throw presetError('choice');
  }
  if (pageVersion() !== initialVersion || data.contentId() !== initialContent) throw presetError('stale');
}

async function validateOwnership(snapshot) {
  if (!snapshot.ownership.length) return;
  const tables = await Promise.all(VERSIONS.map(version => getDiyData(version.id)));
  const known = new Set(tables.flatMap(table => Object.values(table.chess || {}).filter(isDroppableChess).map(char => char.charId)));
  for (const char of Object.values(data.get('chess') || {})) if (isDroppableChess(char)) known.add(char.charId);
  const scope = snapshot.scope ? new Set(snapshot.scope.charIds) : null;
  if (snapshot.ownership.some(id => (!scope || scope.has(id)) && !known.has(id))) throw presetError('choice');
}
