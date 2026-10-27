import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PRESETS_KEY, DEFAULT_PARTS, snapshotOf, snapshotEqual, readLibrary, putPreset, renamePreset, deletePreset, atomicWrite, mergeSnapshot, presetName, operatorScope } from "../../public/js/ui/loadoutPresetsModel.js";
import { rosterOf, filterRoster, parseImport } from "../../public/js/ui/loadoutModel.js";
import { transferPayload, parseTransfer, transferParts, restrictTransferScope } from "../../public/js/ui/loadoutTransferModel.js";
import { VERSIONS } from "../../shared/versions.js";

class MemoryStorage {
  values = new Map();
  getItem(k) { return this.values.get(k) ?? null; }
  setItem(k, v) { this.values.set(k, v); }
  removeItem(k) { this.values.delete(k); }
}
globalThis.localStorage = new MemoryStorage();
const current = { byChar: { char_199_yak: { skill: 1, module: "none" }, char_198_blackd: { skill: 0 } }, ops: { char_199_yak: { potential: 1, cultivate: 0 } },
  skins: {}, random: { scope: "all", auto: false, locked: {} }, diy: { act2autochess: {}, act1autochess: {} } };
const snapshot = () => snapshotOf(current, DEFAULT_PARTS, ["act2autochess", "act1autochess"]);
const empty = () => ({ v: 1, activeId: null, items: [] });
const put = (library, values = {}) => putPreset(library, { name: "日常配置", snapshot: snapshot(), now: 100, newId: () => "preset-1", ...values });

test("preset names trim, count codepoints and reject blank, multiline and overlong names", () => {
  assert.equal(presetName("  日常配置  "), "日常配置");
  assert.equal([...presetName("😀".repeat(24))].length, 24);
  for (const name of [" ", "x".repeat(25), "a\nb".replace("\n", String.fromCharCode(10))]) assert.throws(() => presetName(name), { code: "name" });
});
test("CRUD preserves original snapshot, active identity, created timestamp and current settings", () => {
  const lib = put(empty());
  current.byChar.char_199_yak.skill = 2;
  assert.equal(lib.items[0].snapshot.loadout.byChar.char_199_yak.skill, 1);
  const updated = put(lib, { id: "preset-1", now: 200 });
  assert.equal(updated.items[0].createdAt, 100);
  assert.equal(updated.items[0].updatedAt, 200);
  const renamed = renamePreset(updated, "preset-1", "低练度挑战");
  assert.equal(renamed.activeId, "preset-1");
  assert.equal(deletePreset(renamed, "preset-1").activeId, null);
  assert.equal(current.byChar.char_199_yak.skill, 2);
  current.byChar.char_199_yak.skill = 1;
});
test("duplicate names require explicit overwrite; limit permits update, rename and delete", () => {
  let lib = put(empty());
  assert.throws(() => put(lib), { code: "duplicate" });
  assert.equal(put(lib, { overwrite: true }).items.length, 1);
  for (let n = 1; n < 20; n++) lib = put(lib, { name: "方案" + n, newId: () => "preset-" + (n + 1) });
  assert.throws(() => put(lib, { name: "第21个" }), { code: "limit" });
  assert.equal(put(lib, { id: "preset-1" }).items.length, 20);
  assert.equal(renamePreset(lib, "preset-1", "新名称").items[0].name, "新名称");
  assert.equal(deletePreset(lib, "preset-1").items.length, 19);
});
test("strict library read rejects damaged/newer content without modifying stored bytes", () => {
  const storage = new MemoryStorage();
  storage.setItem(PRESETS_KEY, JSON.stringify(put(empty())));
  assert.equal(readLibrary(storage).items[0].name, "日常配置");
  for (const value of ["bad", JSON.stringify({ v: 3 }), JSON.stringify({ ...put(empty()), activeId: "missing" })]) {
    storage.setItem(PRESETS_KEY, value);
    assert.throws(() => readLibrary(storage));
    assert.equal(storage.getItem(PRESETS_KEY), value);
  }
});
test("snapshot replacement resets absent selected fields, preserves unselected fields and off-version operators", () => {
  const before = { ...current, byChar: { ...current.byChar, char_other_old: { skill: 2, module: "mod-old" } } };
  const parts = { ...DEFAULT_PARTS, modules: false, potential: false, cultivate: false, skins: false };
  const next = mergeSnapshot(before, snapshotOf({ ...current, byChar: { char_198_blackd: { skill: 1 } } }, parts), parts);
  assert.equal(next.byChar.char_198_blackd.skill, 1);
  assert.deepEqual(next.byChar.char_other_old, { module: "mod-old" });
  assert.deepEqual(next.ops, before.ops);
  assert.equal(next.byChar.char_199_yak.module, "none");
});
test("empty selected snapshots restore defaults, selected empty DIY stays explicit, unknown versions rejected", () => {
  const snap = snapshotOf({ ...current, byChar: {}, ops: {} }, DEFAULT_PARTS, ["act1autochess"]);
  assert.deepEqual(mergeSnapshot(current, snap, DEFAULT_PARTS).byChar, {});
  assert.deepEqual(snap.diy, { act1autochess: {} });
  assert.throws(() => snapshotOf(current, DEFAULT_PARTS, ["unknown"]), { code: "invalid" });
  assert.throws(() => put(empty(), { snapshot: snapshotOf(current, {}) }), { code: "empty" });
});
test("dirty comparison is stable across map key order and observes only captured sections", () => {
  const a = snapshot();
  const b = structuredClone(a);
  b.loadout.byChar = Object.fromEntries(Object.entries(b.loadout.byChar).reverse());
  assert.equal(snapshotEqual(a, b), true);
  b.loadout.byChar.char_199_yak.skill = 2;
  assert.equal(snapshotEqual(a, b), false);
});
test("atomic writes roll back exact strings and absent keys on failure", () => {
  const storage = new MemoryStorage();
  storage.setItem("first", "original bytes");
  const original = storage.setItem.bind(storage);
  storage.setItem = (k, v) => { if (k === "fail") throw new Error("quota"); original(k, v); };
  assert.throws(() => atomicWrite([["first", "changed"], ["new", "new"], ["fail", "x"]], storage), { code: "storage" });
  assert.equal(storage.getItem("first"), "original bytes");
  assert.equal(storage.getItem("new"), null);
});
test("personal recovery includes named preset library and its selected versions", async () => {
  const { personalKey, capturePersonalData, encodePersonalData, decodePersonalData, restorePersonalData } = await import("../../public/js/ui/personalData.js");
  assert.equal(personalKey(PRESETS_KEY), true);
  const source = new MemoryStorage(); source.setItem(PRESETS_KEY, JSON.stringify(put(empty())));
  Object.defineProperty(source, "length", { get() { return this.values.size; } });
  source.key = i => [...source.values.keys()][i];
  const backup = await capturePersonalData(source, async () => null, async () => null);
  const decoded = await decodePersonalData(await encodePersonalData(backup));
  assert.equal(decoded.entries[PRESETS_KEY], source.getItem(PRESETS_KEY));
  const target = new MemoryStorage(); Object.defineProperty(target, "length", { get() { return this.values.size; } }); target.key = i => [...target.values.keys()][i];
  await restorePersonalData(decoded, { storage: target, readMedia: async () => null, writeMedia: async () => {}, readTrack: async () => null, writeTrack: async () => {} });
  assert.equal(readLibrary(target).items[0].name, "日常配置");
});

const S = await import("../../public/js/ui/loadoutPresetsState.js");
const { loadoutStore } = await import("../../public/js/ui/loadoutSync.js");
const { data } = await import("../../public/js/data.js");
const { store } = await import("../../public/js/store.js");
const { skinsStore } = await import("../../public/js/ui/skins.js");
const read = f => JSON.parse(fs.readFileSync(new URL("../../data/" + f, import.meta.url), "utf8"));
const DEF = read("chess.json"), BACKUPS = read("backups.json"), OLD = read("versions/act1autochess/chess.json");
function setup() {
  globalThis.localStorage = new MemoryStorage();
  data.setContent({ id: "preset-test", values: new Map([["chess", DEF], ["backups", BACKUPS]]) });
  loadoutStore.set({ byChar: structuredClone(current.byChar), ops: structuredClone(current.ops), diy: {}, diyVersion: "act2autochess", notOwnedChars: [], sync: "idle", diySync: "idle", diyKitted: null });
  store.set({ room: null, match: { public: null, private: null } });
  const lib = put(empty()); S.saveLibrary(lib); return lib.items[0];
}
test("cross-version apply updates canonical charIds and rebuilds the current view without switching versions", async () => {
  const item = setup();
  data.setContent({ id: "old-preset-test", values: new Map([["chess", OLD], ["backups", BACKUPS]]) });
  loadoutStore.set({ byChar: {}, ops: {} });
  const result = await S.applyPreset(item, DEFAULT_PARTS, []);
  assert.equal(result.applied, true);
  assert.equal(loadoutStore.get().byChar.char_198_blackd.skill, 0);
  assert.equal(loadoutStore.get().entries.chess_char_1_02_a.skill, 0, "old version courier, not matterhorn");
  assert.equal(loadoutStore.get().entries.chess_char_2_03_a.skill, 1);
  assert.equal(data.contentId(), "old-preset-test");
});
test("phase lock prevents writes; cosmetic-only partial apply is allowed and does not claim full association", async () => {
  const item = setup(), original = localStorage.getItem("sp.pref.loadout");
  store.set({ room: { inMatch: true }, match: { public: { phase: "COMBAT" }, private: {} } });
  await assert.rejects(S.applyPreset(item, DEFAULT_PARTS, []), { code: "locked" });
  assert.equal(localStorage.getItem("sp.pref.loadout"), original);
  const parts = Object.fromEntries(Object.keys(DEFAULT_PARTS).map(k => [k, k === "skins"]));
  assert.equal((await S.applyPreset(item, parts, [])).applied, true);
  assert.equal(readLibrary().activeId, null);
});
test("failed application publishes no partial loadout or skins", async () => {
  const item = setup(), before = loadoutStore.get(), skins = skinsStore.get();
  const storage = globalThis.localStorage, original = storage.setItem.bind(storage);
  storage.setItem = (k, v) => { if (k === "sp.pref.skins") throw new Error("full"); original(k, v); };
  let notifications = 0; const off = loadoutStore.subscribe(() => notifications++);
  await assert.rejects(S.applyPreset(item, DEFAULT_PARTS, []), { code: "storage" });
  off();
  assert.equal(notifications, 0);
  assert.equal(loadoutStore.get(), before);
  assert.equal(skinsStore.get(), skins);
  assert.equal(storage.getItem("sp.pref.loadout"), null);
});
test("selected empty DIY version clears only its own roster and leaves other versions unchanged", async () => {
  const item = setup();
  localStorage.setItem("sp.pref.diy.act1autochess", "keep-other-version");
  const result = await S.applyPreset(item, DEFAULT_PARTS, ["act2autochess"]);
  assert.equal(result.applied, true);
  assert.deepEqual(JSON.parse(localStorage.getItem("sp.pref.diy")).picks, {});
  assert.equal(localStorage.getItem("sp.pref.diy.act1autochess"), "keep-other-version");
});
test("invalid DIY picks require explicit skip and keep the saved preset intact", async () => {
  setup();
  const bad = snapshot(); bad.diy.act2autochess = { chess_char_6_diy1_a: { charId: "char_999999_missing" } };
  const lib = put(empty(), { snapshot: bad }); S.saveLibrary(lib);
  const item = lib.items[0], before = localStorage.getItem("sp.pref.loadout");
  const preview = await S.applyPreset(item, DEFAULT_PARTS, ["act2autochess"]);
  assert.equal(preview.needsConfirmation.length, 1);
  assert.equal(localStorage.getItem("sp.pref.loadout"), before);
  await S.applyPreset(item, DEFAULT_PARTS, ["act2autochess"], { skipInvalid: true });
  assert.deepEqual(loadoutStore.get().diy, {});
  assert.equal(readLibrary().items[0].snapshot.diy.act2autochess.chess_char_6_diy1_a.charId, "char_999999_missing");
  assert.equal(readLibrary().activeId, null);
});
test("asynchronous validation checks the latest match phase and refuses a now-locked transaction", async () => {
  const item = setup();
  // inspectPreset awaits even current-version data: the match can advance while a dialog validates.
  const pending = S.applyPreset(item, DEFAULT_PARTS, ["act2autochess"]);
  store.set({ room: { inMatch: true }, match: { public: { phase: "COMBAT" }, private: {} } });
  await assert.rejects(pending, { code: "locked" });
  assert.equal(localStorage.getItem("sp.pref.loadout"), null);
});
test("other-version loading failures do not commit and selections from multiple versions stay independent", async () => {
  const item = setup(), oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try { await assert.rejects(S.applyPreset(item, DEFAULT_PARTS, ["act1autochess"]), { code: "data" }); } finally { globalThis.fetch = oldFetch; }
  assert.equal(localStorage.getItem("sp.pref.loadout"), null);
  globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith("chess.json") ? OLD : read("versions/act1autochess/backups.json") });
  try {
    const result = await S.applyPreset(item, DEFAULT_PARTS, ["act1autochess", "act2autochess"]);
    assert.equal(result.applied, true);
    assert.deepEqual(JSON.parse(localStorage.getItem("sp.pref.diy.act1autochess")).picks, {});
    assert.deepEqual(JSON.parse(localStorage.getItem("sp.pref.diy")).picks, {});
    assert.equal(readLibrary().activeId, item.id);
  } finally { globalThis.fetch = oldFetch; }
});
test("changing canonical settings flags dirty without modifying the saved snapshot", () => {
  const item = setup();
  assert.equal(S.presetDirty(item), false);
  loadoutStore.set({ byChar: { ...loadoutStore.get().byChar, char_198_blackd: { skill: 2 } } });
  assert.equal(S.presetDirty(item), true);
  assert.equal(readLibrary().items[0].snapshot.loadout.byChar.char_198_blackd.skill, 0);
});
test("uninstalled skin selections and random-policy locks survive a full preset round trip", async () => {
  setup();
  const source = { ...current, skins: { char_199_yak: "char_199_yak@winter#1" }, random: { scope: "equipped", auto: true, locked: { char_199_yak: true } } };
  const parts = { ...DEFAULT_PARTS, skinRandom: true, skinLocks: true };
  const lib = put(empty(), { snapshot: snapshotOf(source, parts) }); S.saveLibrary(lib);
  await S.applyPreset(lib.items[0], parts, []);
  assert.equal(skinsStore.get().skins.char_199_yak, "char_199_yak@winter#1");
  assert.equal(S.presetDirty(lib.items[0]), false);
});
test("DIY-only presets save, reopen and apply without an empty-loadout file import", async () => {
  setup();
  const parts = Object.fromEntries(Object.keys(DEFAULT_PARTS).map(k => [k, false]));
  const lib = put(empty(), { snapshot: snapshotOf(current, parts, ["act2autochess"]) }); S.saveLibrary(lib);
  const reopened = readLibrary();
  assert.equal(reopened.items.length, 1);
  const before = loadoutStore.get().byChar;
  assert.equal((await S.applyPreset(reopened.items[0], parts, ["act2autochess"])).applied, true);
  assert.equal(loadoutStore.get().byChar, before);
  assert.equal(S.presetDirty(reopened.items[0]), false);
});
test("version scope uses official configurable rosters and exclusive means absent from all other versions", () => {
  const rosters = Object.fromEntries(VERSIONS.map(v => [v.id, rosterOf(Object.values(read(v.dir + "chess.json"))).map(c => c.charId)]));
  const all = operatorScope("roster", ["act2autochess", "act1autochess"], rosters);
  assert.ok(all.charIds.includes("char_199_yak"));
  assert.equal(all.charIds.length, new Set([...rosters.act2autochess, ...rosters.act1autochess]).size);
  const exclusive = operatorScope("exclusive", ["act2autochess"], rosters);
  assert.equal(exclusive.charIds.length, 4);
  for (const id of exclusive.charIds) for (const v of VERSIONS.filter(v => v.id !== "act2autochess")) assert.ok(!rosters[v.id].includes(id));
  assert.deepEqual(operatorScope("exclusive", ["act1autochess"], rosters).charIds, []);
  assert.equal(operatorScope("all", [], rosters), null);
  assert.throws(() => operatorScope("exclusive", [], rosters), { code: "scope" });
  assert.throws(() => operatorScope("exclusive", ["act2autochess"], {}), { code: "loading" });
});
test("scoped snapshot restores defaults only inside its recorded roster, including skins and locks", () => {
  const scope = { mode: "roster", versions: ["act1autochess"], charIds: ["char_198_blackd"] };
  const parts = { ...DEFAULT_PARTS, skinLocks: true };
  const source = { ...current, byChar: {}, ops: {}, skins: {}, random: { scope: "all", auto: false, locked: {} } };
  const snap = snapshotOf(source, parts, [], scope);
  const now = { ...current, byChar: { ...current.byChar, char_other_mod: { skill: 2 } }, ops: { char_198_blackd: { potential: 1 }, char_199_yak: { potential: 2 } },
    skins: { char_198_blackd: "char_198_blackd@winter#1", char_199_yak: "char_199_yak@winter#1" }, random: { scope: "all", auto: false, locked: { char_198_blackd: true, char_199_yak: true } } };
  const result = mergeSnapshot(now, snap, parts);
  assert.equal(result.byChar.char_198_blackd, undefined);
  assert.equal(result.byChar.char_199_yak.skill, current.byChar.char_199_yak.skill);
  assert.deepEqual(result.byChar.char_other_mod, { skill: 2 });
  assert.deepEqual(result.ops, { char_199_yak: { potential: 2 } });
  assert.deepEqual(result.skins, { char_199_yak: "char_199_yak@winter#1" });
  assert.deepEqual(result.random.locked, { char_199_yak: true });
});
test("scoped snapshots filter all operator fields, persist scope and ignore dirty changes outside it", async () => {
  setup();
  const scope = { mode: "exclusive", versions: ["act2autochess"], charIds: ["char_199_yak"] };
  const snap = S.capturePreset(DEFAULT_PARTS, [], scope);
  assert.deepEqual(Object.keys(snap.loadout.byChar), ["char_199_yak"]);
  const lib = put(empty(), { snapshot: snap }); S.saveLibrary(lib);
  assert.equal(lib.v, 2, "old browsers refuse scope-aware libraries rather than applying them globally");
  assert.equal(readLibrary().v, 2);
  assert.deepEqual(readLibrary().items[0].snapshot.scope, scope);
  loadoutStore.set({ byChar: { ...current.byChar, char_198_blackd: { skill: 2 } } });
  assert.equal(S.presetDirty(lib.items[0]), false);
  loadoutStore.set({ byChar: { ...loadoutStore.get().byChar, char_199_yak: { skill: 0 } } });
  assert.equal(S.presetDirty(lib.items[0]), true);
  await S.applyPreset(lib.items[0], DEFAULT_PARTS, []);
  assert.equal(loadoutStore.get().byChar.char_199_yak.skill, 1);
  assert.equal(loadoutStore.get().byChar.char_198_blackd.skill, 2);
  assert.equal(S.presetDirty(lib.items[0]), false);
});
test("invalid scope metadata refuses library load without deleting or widening saved snapshots", () => {
  const storage = new MemoryStorage();
  for (const scope of [{ mode: "bad", versions: ["act2autochess"], charIds: [] }, { mode: "roster", versions: ["unknown"], charIds: [] },
    { mode: "roster", versions: ["act2autochess"], charIds: ["__proto__"] }, { mode: "roster", versions: ["act2autochess"], charIds: [] }]) {
    const lib = put(empty()); lib.items[0].snapshot.scope = scope;
    const raw = JSON.stringify(lib); storage.setItem(PRESETS_KEY, raw);
    assert.throws(() => readLibrary(storage), { code: "invalid" });
    assert.equal(storage.getItem(PRESETS_KEY), raw);
  }
});
test("version roster loading does not change shown content and fails without caching partial lists", async () => {
  setup(); const old = globalThis.fetch, content = data.contentId(); let requests = 0;
  globalThis.fetch = async _url => { requests++; return { ok: false }; };
  try { await assert.rejects(S.loadPresetRosters(), { code: "data" }); } finally { globalThis.fetch = old; }
  globalThis.fetch = async url => ({ ok: true, json: async () => read(String(url).replace("/data/", "")) });
  try { const rosters = await S.loadPresetRosters(); assert.equal(rosters.act2autochess.length, 112); assert.equal(Object.keys(rosters).length, 4); } finally { globalThis.fetch = old; }
  assert.ok(requests >= 4); assert.equal(data.contentId(), content);
});
test("version filters compose with existing search/class/tier and do not expand the displayed roster", () => {
  const rows = rosterOf(Object.values(DEF));
  const only = new Set(["char_199_yak"]);
  const found = filterRoster(rows, {}, {}, id => DEF[id], () => null, null, null, only);
  assert.equal(found.length, 1); assert.equal(found[0].charId, "char_199_yak");
  assert.deepEqual(filterRoster(rows, { query: "does-not-exist" }, {}, id => DEF[id], () => null, null, null, only), []);
  assert.deepEqual(filterRoster(rows, { tier: found[0].tier === 1 ? 2 : 1 }, {}, id => DEF[id], () => null, null, null, only), []);
  assert.deepEqual(filterRoster(rows, {}, {}, () => null, () => null, null, null, new Set()), []);
  assert.equal(filterRoster(rows).length, rows.length);
});
test("scope-aware transfer v3 preserves the roster, filters settings and is refused by old v2 importer", () => {
  const scope = { mode: "roster", versions: ["act1autochess"], charIds: ["char_198_blackd"] };
  const file = transferPayload(current, DEFAULT_PARTS, scope, { now: 0 });
  assert.equal(file.v, 3); assert.equal(file.extension.v, 2);
  assert.deepEqual(Object.keys(file.byChar), ["char_198_blackd"]);
  const parsed = parseTransfer(JSON.stringify(file));
  assert.equal(parsed.ok, true); assert.deepEqual(parsed.scope, scope);
  assert.equal(parseImport(file).ok, false);
  assert.throws(() => transferPayload(current, DEFAULT_PARTS, scope, { upstream: true }), /scope/);
});
test("unscoped native/upstream exports preserve v2 format and legacy files expose only present sections", () => {
  const native = transferPayload(current, DEFAULT_PARTS, null, { now: 0 });
  assert.equal(native.v, 2); assert.equal(parseTransfer(native).ok, true);
  const upstream = transferPayload(current, DEFAULT_PARTS, null, { upstream: true, now: 0 });
  assert.equal(upstream.extension, undefined); assert.equal(upstream.skins, undefined);
  const legacy = parseTransfer({ v: 1, entries: { chess_char_1_01_a: { skill: 0 } } });
  assert.equal(legacy.ok, true); const parts = transferParts(legacy);
  assert.equal(parts.skills, true); assert.equal(parts.modules, false); assert.equal(parts.potential, false); assert.equal(parts.skins, false);
  const potentialOnly = parseTransfer({ kind: 'stronghold.loadout', v: 2, byChar: {}, ops: { char_199_yak: { potential: 1 } } });
  assert.equal(transferParts(potentialOnly).potential, true); assert.equal(transferParts(potentialOnly).cultivate, true, 'legacy ops is one complete settings section');
});
test("import filters can only narrow file scope and selected empty snapshots reset only recorded operators", () => {
  const file = { mode: "roster", versions: ["act1autochess"], charIds: ["char_198_blackd"] };
  const ui = { mode: "roster", versions: ["act2autochess"], charIds: ["char_199_yak", "char_198_blackd"] };
  assert.deepEqual(restrictTransferScope(file, ui).charIds, ["char_198_blackd"]);
  assert.deepEqual(restrictTransferScope(file, null), file);
  assert.deepEqual(restrictTransferScope(null, ui), ui);
});
test("damaged scope files reject invalid fields instead of widening or resetting them", () => {
  const scope = { mode: "exclusive", versions: ["act2autochess"], charIds: ["char_199_yak"] };
  const file = transferPayload(current, DEFAULT_PARTS, scope, { now: 0 });
  for (const mutate of [p => { p.extension.scope.charIds = []; }, p => { p.extension.scope.versions = ["unknown"]; },
    p => { p.byChar.char_198_blackd = { skill: 0 }; }, p => { p.byChar.char_199_yak.skill = 999; }, p => { p.extension.scope.charIds = ["__proto__"]; }]) {
    const value = structuredClone(file); mutate(value); assert.equal(parseTransfer(value).ok, false);
  }
});
test("selective import applies scoped settings atomically without changing unselected fields or active preset", () => {
  const item = setup(); const parts = { ...DEFAULT_PARTS, modules: false, potential: false, cultivate: false, skins: false };
  const scope = { mode: "roster", versions: ["act1autochess"], charIds: ["char_198_blackd"] };
  const file = snapshotOf({ ...current, byChar: { char_198_blackd: { skill: 2 } } }, parts, [], scope);
  S.applyTransferredSnapshot(file, parts);
  assert.equal(loadoutStore.get().byChar.char_198_blackd.skill, 2);
  assert.equal(loadoutStore.get().byChar.char_199_yak.skill, current.byChar.char_199_yak.skill);
  assert.equal(readLibrary().activeId, item.id);
  const before = loadoutStore.get();
  store.set({ room: { inMatch: true }, match: { public: { phase: "COMBAT" }, private: {} } });
  assert.throws(() => S.applyTransferredSnapshot(file, parts), { code: "locked" });
  assert.equal(loadoutStore.get(), before);
});
test("malformed native v2 skill values never become an empty selected reset", () => {
  const native = transferPayload(current, DEFAULT_PARTS, null, { now: 0 });
  native.byChar.char_199_yak.skill = 999;
  assert.equal(parseTransfer(native).ok, false);
  assert.equal(parseTransfer({ v: 2, kind: 'stronghold.loadout', byChar: { char_199_yak: { skill: -1 } }, ops: {} }).ok, false);
});
test("semantic import validation refuses unavailable choices but accepts explicit default snapshots", async () => {
  setup(); const old = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, json: async () => read(String(url).replace('/data/', '')) });
  const parts = { skills: true, modules: true };
  try {
    const invalid = snapshotOf({ ...current, byChar: { char_199_yak: { skill: 9 } } }, parts);
    const before = loadoutStore.get();
    await assert.rejects(S.validateTransferChoices(invalid, parts), { code: 'choice' });
    assert.equal(loadoutStore.get(), before);
    const base = rosterOf(Object.values(DEF)).find(c => c.charId === 'char_199_yak');
    const defaultChoice = { skill: base.skill.index };
    await S.validateTransferChoices(snapshotOf({ ...current, byChar: { char_199_yak: defaultChoice } }, parts), parts);
    await S.validateTransferChoices(snapshotOf({ ...current, byChar: {} }, parts), parts);
  } finally { globalThis.fetch = old; }
});
test("legacy explicit empty ops restores defaults while absent ops leaves them unchanged", () => {
  setup();
  const source = { kind: 'stronghold.loadout', v: 2, byChar: { char_199_yak: { skill: 0 } }, ops: {} };
  const parsed = parseTransfer(source), parts = transferParts(parsed);
  assert.equal(parts.potential, true); assert.equal(parts.cultivate, true);
  const snapshot = snapshotOf({ ...current, byChar: parsed.byChar, ops: parsed.ops }, parts);
  S.applyTransferredSnapshot(snapshot, parts); assert.deepEqual(loadoutStore.get().ops, {});
  delete source.ops;
  const absent = transferParts(parseTransfer(source));
  assert.equal(absent.potential, false); assert.equal(absent.cultivate, false);
  const defaults = parseTransfer({ ...source, ops: { char_199_yak: { potential: 6, cultivate: 3 } } });
  assert.equal(transferParts(defaults).potential, true); assert.equal(transferParts(defaults).cultivate, true);
});
test("malformed cosmetics cannot become empty snapshot resets", () => {
  const base = transferPayload(current, { ...DEFAULT_PARTS, skinRandom: true, skinLocks: true }, null, { now: 0 });
  for (const mutate of [p => { p.skins = { char_199_yak: 999 }; }, p => { p.skins = []; },
    p => { p.extension.skinRandom = { scope: 'unknown', auto: false }; }, p => { p.extension.skinRandom = { scope: 'all', auto: 'false' }; },
    p => { p.extension.skinLocks = { char_199_yak: false }; }, p => { p.extension.skinLocks = []; }]) {
    const file = structuredClone(base); mutate(file); assert.equal(parseTransfer(file).ok, false);
  }
  assert.equal(parseTransfer(base).ok, true, 'explicit empty valid cosmetics remain supported');
});
test("default-valued unknown source operators remain visible to semantic validation", async () => {
  setup(); const old = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, json: async () => read(String(url).replace('/data/', '')) });
  try {
    const parsed = parseTransfer({ v: 2, kind: 'stronghold.loadout', byChar: { char_199_yak: { skill: 0 } }, ops: { char_999999_missing: { potential: 6, cultivate: 3 } } });
    assert.equal(parsed.ok, true); assert.deepEqual(parsed.ops, {});
    assert.deepEqual(parsed.sourceOps, ['char_999999_missing']);
    const parts = transferParts(parsed);
    const snapshot = snapshotOf({ ...current, byChar: parsed.byChar, ops: parsed.ops }, parts);
    const before = loadoutStore.get();
    await assert.rejects(S.validateTransferChoices(snapshot, parts, parsed.sourceOps), { code: 'choice' });
    assert.equal(loadoutStore.get(), before);
  } finally { globalThis.fetch = old; }
});
