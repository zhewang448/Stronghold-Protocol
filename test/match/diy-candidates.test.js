import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { getVersionData } from '../../server/data.js';
import { VERSIONS, DEFAULT_VERSION } from '../../shared/versions.js';
import { diyPool, diyTierSlotIds, diyCandidates, resolveDiySlots, validateDiyPicks } from '../../shared/diy.js';
import { KITTED_CHARS } from '../../server/sim/content/kits/index.js';
import { checkDiyPicks, validateC2S } from '../../shared/protocol.js';
import { capturePrep, rewindToPrep } from '../../server/match/rewind.js';
import { recoveryPayload, restoreMatch } from '../../server/recovery.js';
import { exportDiy, parseDiyImport, pickOptions } from '../../public/js/ui/diyModel.js';

function candidates(data) {
  const out = {};
  for (const tier of [5, 6]) {
    const ids = diyPool(tier, { data, kitted: KITTED_CHARS }).slice(0, diyTierSlotIds(tier, data).length + 2);
    const keys = [...diyTierSlotIds(tier, data), `diyBench_${tier}_1`, `diyBench_${tier}_2`];
    ids.forEach((charId, i) => { out[keys[i]] = { charId }; });
  }
  return checkDiyPicks(out, { data, kitted: KITTED_CHARS }).picks;
}

const seat = picks => ({ seat: 0, playerId: 'p_0', name: 'Player', isBot: false, connected: true, diy: picks });
const choose = (m, ids, extra = {}) => m.handle('p_0', { t: 'g.diyChoose', tier: 5, charIds: ids, setupRevision: m.setupRevision, ...extra });

for (const version of VERSIONS.filter(v => v.id !== 'act3autochess@V3_1')) {
  test(`${version.id}: version-sized candidates, atomic selection, reroll identity and PREP lock`, t => {
    const data = version.id === DEFAULT_VERSION ? DATA : getVersionData(version.id);
    const picks = candidates(data);
    const h = makeMatch({ data, mode: 'solo', seats: [seat(picks)], fake: true }).start();
    t.after(() => h.m.dispose());
    const m = h.m, ps = m.order[0];
    assert.equal(m.phase, 'INFO_CHECK');
    assert.deepEqual(ps.diyPreset, picks);
    const tier = ps.privateView().diyChoice.tiers.find(x => x.tier === 5);
    const slots = diyTierSlotIds(5, data).length;
    assert.equal(tier.candidates.length, slots + 2);
    assert.equal(tier.chosen.length, slots);
    const next = tier.candidates.slice(2, 2 + slots).map(x => x.charId);
    const before = ps.diy, stock = ps.diyStock;
    assert.ok(choose(m, [next[0], next[0]]).error);
    assert.ok(choose(m, ['char_missing', next[1]]).error);
    assert.equal(ps.diy, before); assert.equal(ps.diyStock, stock);
    assert.ok(choose(m, next.slice(0, 1)).error, 'the legacy single-tier command still requires the full tier size');
    assert.equal(ps.diy, before); assert.equal(ps.diyStock, stock);
    ps.infoReady = true;
    assert.deepEqual(choose(m, next), { ok: true });
    assert.equal(ps.infoReady, false);
    assert.deepEqual(diyTierSlotIds(5, data).map(id => ps.diy[id].charId).sort(), [...next].sort());
    assert.ok(diyTierSlotIds(5, data).every(id => ps.gd.chess(id).charId === ps.diy[id].charId));
    assert.deepEqual(ps.privateView().diyChoice.tiers[0].chosen, next);
    const selected = ps.diy;
    assert.deepEqual(m.completeSetupReroll(), { ok: true });
    assert.deepEqual(ps.diy, selected);
    assert.ok(choose(m, next, { setupRevision: m.setupRevision - 1 }).error);
    m.handle('p_0', { t: 'g.infoReady', setupRevision: m.setupRevision }); h.sched.advance(0);
    h.toPrep();
    assert.equal(ps.privateView().diyChoice, undefined);
    assert.ok(choose(m, tier.chosen).error);
    assert.deepEqual(ps.diy, selected);
  });
}

test('default prioritises candidates with live bonds; manual banned choices get zero stock', t => {
  const data = structuredClone(DATA), picks = candidates(data);
  const ids = [...diyCandidates(picks, data).get(5)].map(x => x.pick.charId);
  data.backups.diy.operators[ids[0]].bonds = ['yanShip'];
  for (const id of ids.slice(1)) data.backups.diy.operators[id].bonds = ['emptyShip'];
  const slots = resolveDiySlots(picks, data, { off: new Set(['yanShip']) });
  assert.deepEqual(diyTierSlotIds(5, data).map(k => slots[k].charId).sort(), ids.slice(1, 3).sort());
  const h = makeMatch({ data, mode: 'solo', fake: true, seats: [seat(picks)] }).start();
  t.after(() => h.m.dispose());
  h.m.disabledBonds = ['yanShip']; h.m.staticInactiveBonds = [];
  assert.deepEqual(choose(h.m, ids.slice(0, 2)), { ok: true });
  const ps = h.m.order[0], id = Object.keys(ps.diy).find(k => ps.diy[k].charId === ids[0]);
  assert.ok(ps.diyBanned.includes(id)); assert.equal(ps.diyStock.left(id), 0);
});

test('bench-only presets with one or two candidates fill real slots; illegal duplicates retain old restrictions', () => {
  const picks = candidates(DATA), all = [...diyCandidates(picks, DATA).get(5)];
  for (const n of [1, 2]) {
    const preset = Object.fromEntries(all.slice(0, n).map((c, i) => [`diyBench_5_${i + 1}`, c.pick]));
    assert.equal(Object.keys(resolveDiySlots(preset, DATA)).length, n);
  }
  const duplicate = { ...picks, diyBench_5_1: all[0].pick };
  assert.equal(validateDiyPicks(duplicate, { data: DATA }).error, 'BAD_TARGET');
  const option = pickOptions('diyBench_5_1', picks, DATA, KITTED_CHARS).find(x => x.charId === picks.diyBench_5_1.charId);
  assert.equal(option.taken, null, 'the current bench position does not conflict with itself');
  assert.equal(validateC2S({ t: 'g.diyChoose', tier: 5, charIds: all.slice(0, 2).map(x => x.pick.charId), setupRevision: 0 }), null);
});

test('reroll vote blocks choices; spectator, departed and stale commands do not write state', t => {
  const h = makeMatch({ seats: [seat(candidates(DATA)), { seat: 1, playerId: 'p_1', name: 'Other', connected: true }], fake: true, spectators: ['viewer'] }).start();
  t.after(() => h.m.dispose());
  const m = h.m, ps = m.order[0], ids = ps.privateView().diyChoice.tiers[0].candidates.slice(2).map(x => x.charId);
  const before = ps.diy;
  assert.equal(m.handle('viewer', { t: 'g.diyChoose', tier: 5, charIds: ids, setupRevision: 0 }).error, 'SPECTATOR');
  m.requestSetupReroll('p_0', 0);
  assert.equal(choose(m, ids).error, 'WRONG_PHASE');
  assert.equal(ps.diy, before);
});

test('PREP rewind and restart recovery keep candidates, explicit choice, final mapping and personal stock', t => {
  const h = makeMatch({ mode: 'solo', seats: [seat(candidates(DATA))], fake: true }).start();
  t.after(() => h.m.dispose());
  const m = h.m, ps = m.order[0];
  const ids = ps.privateView().diyChoice.tiers[0].candidates.slice(2).map(x => x.charId);
  assert.deepEqual(choose(m, ids), { ok: true }); h.toPrep();
  const snap = capturePrep(m), record = recoveryPayload(m, snap);
  const saved = { preset: ps.diyPreset, choice: ps.diyChoice, diy: ps.diy, stock: ps.diyStock.snapshot() };
  assert.deepEqual(rewindToPrep(m, 1), { ok: true, round: 1 });
  assert.deepEqual(ps.diy, saved.diy);
  const restored = makeMatch({ mode: 'solo', seats: record.seats, seed: m.seed, fake: true });
  t.after(() => restored.m.dispose());
  restoreMatch(restored.m, record);
  const p = restored.m.order[0];
  assert.deepEqual({ preset: p.diyPreset, choice: p.diyChoice, diy: p.diy, stock: p.diyStock.snapshot() }, saved);
  const old = structuredClone(record);
  for (const s of old.seats) { delete s.diyPreset; delete s.diyChoice; }
  const legacy = makeMatch({ mode: 'solo', seats: old.seats, seed: m.seed, fake: true });
  t.after(() => legacy.m.dispose()); restoreMatch(legacy.m, old);
  assert.deepEqual(legacy.m.order[0].diy, saved.diy, 'legacy records never run a new selection');
});

test('complete export retains benches, old-format export is explicit, v1 imports stay compatible', () => {
  const picks = candidates(DATA), full = exportDiy(picks), compat = exportDiy(picks, { compatible: true });
  assert.equal(full.v, 2); assert.deepEqual(parseDiyImport(full).picks, picks);
  assert.equal(compat.v, 1); assert.equal(Object.keys(compat.picks).length, 4);
  assert.deepEqual(parseDiyImport(compat).picks, compat.picks);
  assert.equal(Object.keys(picks).length, 8);
});

test('failed stock preparation is atomic; choosing during the queued all-ready transition cancels it safely', t => {
  const h = makeMatch({ seats: [seat(candidates(DATA)), { seat: 1, playerId: 'p_1', name: 'Other', connected: true }], fake: true }).start();
  t.after(() => h.m.dispose());
  const m = h.m, ps = m.order[0], ids = ps.privateView().diyChoice.tiers[0].candidates.slice(2).map(x => x.charId);
  const before = [ps.diyChoice, ps.diy, ps.diyStock], build = ps.buildDiyStock;
  ps.buildDiyStock = () => { throw new Error('stock fixture failure'); };
  assert.equal(choose(m, ids).error, 'INTERNAL');
  assert.deepEqual([ps.diyChoice, ps.diy, ps.diyStock], before);
  ps.buildDiyStock = build;
  for (const p of m.order) m.handle(p.playerId, { t: 'g.infoReady', setupRevision: 0 });
  assert.ok(m._infoAdvanceTimer);
  assert.deepEqual(choose(m, ids), { ok: true }); h.sched.advance(0);
  assert.equal(m.phase, 'INFO_CHECK'); assert.equal(ps.infoReady, false); assert.ok(m.deadline > h.sched.now());
});
