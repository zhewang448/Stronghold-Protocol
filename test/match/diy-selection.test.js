import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { getVersionData } from '../../server/data.js';
import { VERSIONS, DEFAULT_VERSION } from '../../shared/versions.js';
import { diyPool, diyTierSlotIds } from '../../shared/diy.js';
import { KITTED_CHARS } from '../../server/sim/content/kits/index.js';
import { checkDiyPicks, validateC2S } from '../../shared/protocol.js';
import { capturePrep, rewindToPrep } from '../../server/match/rewind.js';
import { recoveryPayload, restoreMatch } from '../../server/recovery.js';

function preset(data, count = 4) {
  const picks = {};
  for (const tier of [5, 6]) {
    const keys = [...diyTierSlotIds(tier, data), `diyBench_${tier}_1`, `diyBench_${tier}_2`];
    diyPool(tier, { data, kitted: KITTED_CHARS }).slice(0, count).forEach((charId, i) => { picks[keys[i]] = { charId }; });
  }
  return checkDiyPicks(picks, { data, kitted: KITTED_CHARS }).picks;
}
const seat = diy => ({ seat: 0, playerId: 'p_0', name: 'Selection', isBot: false, connected: true, diy });
const apply = (m, choices, revision = m.setupRevision) => m.handle('p_0', { t: 'g.diyApply', choices, setupRevision: revision });
const count = (ps, tier) => diyTierSlotIds(tier, ps.m.gd.raw).filter(id => ps.diy[id]).length;

for (const version of VERSIONS) {
  test(`${version.id}: optional 0/1/2 choices stay atomic and preserve explicit none through reroll and recovery`, t => {
    const data = version.id === DEFAULT_VERSION ? DATA : getVersionData(version.id);
    const h = makeMatch({ data, mode: 'solo', fake: true, seats: [seat(preset(data))] }).start();
    t.after(() => h.m.dispose());
    const m = h.m, ps = m.order[0];
    const tiers = ps.privateView().diyChoice.tiers;
    const ids = Object.fromEntries(tiers.map(tier => [tier.tier, tier.candidates.map(c => c.charId)]));
    assert.deepEqual([count(ps, 5), count(ps, 6)], [5, 6].map(tier => Math.min(4, diyTierSlotIds(tier, data).length)));
    for (const n of [...new Set([0, 1, 2, Math.min(ids[5].length, diyTierSlotIds(5, data).length)])]) {
      ps.infoReady = true;
      assert.deepEqual(apply(m, { 5: ids[5].slice(0, n), 6: ids[6].slice(0, n) }), { ok: true });
      assert.deepEqual([count(ps, 5), count(ps, 6)], [n, n]);
      assert.equal(ps._diyRecords.size, n * 4);
      assert.equal(ps.infoReady, false);
      if (!n) assert.equal(ps.diyStock.entries.size, 0, 'omitted operators leave no personal shop or reward stock');
    }
    assert.deepEqual(apply(m, { 5: [], 6: ids[6].slice(0, 1) }), { ok: true });
    const revision = m.setupRevision;
    assert.deepEqual(m.completeSetupReroll(), { ok: true });
    assert.deepEqual([count(ps, 5), count(ps, 6)], [0, 1]);
    assert.deepEqual(ps.diyChoice[5], []);
    assert.equal(apply(m, { 5: ids[5].slice(0, 2) }, revision).error, 'BAD_TARGET');
    const prior = [ps.diy, ps.diyChoice, ps.diyStock, ps.gd];
    assert.equal(apply(m, { 5: ids[5].slice(0, 2), 6: ['char_missing'] }).error, 'BAD_TARGET');
    assert.deepEqual([ps.diy, ps.diyChoice, ps.diyStock, ps.gd], prior, 'one invalid tier cannot partially apply another');
    assert.deepEqual(m.handle('p_0', { t: 'g.infoReady', setupRevision: m.setupRevision }), { ok: true });
    h.sched.advance(0); h.toPrep();
    const expected = { choice: ps.diyChoice, diy: ps.diy, stock: ps.diyStock.snapshot() };
    const checkpoint = capturePrep(m), saved = recoveryPayload(m, checkpoint);
    const recovered = makeMatch({ data, mode: 'solo', seats: saved.seats, seed: m.seed, fake: true });
    t.after(() => recovered.m.dispose());
    restoreMatch(recovered.m, saved);
    const restored = recovered.m.order[0];
    assert.deepEqual({ choice: restored.diyChoice, diy: restored.diy, stock: restored.diyStock.snapshot() }, expected);
    assert.equal(apply(m, { 5: ids[5].slice(0, 2), 6: ids[6].slice(0, 2) }).error, 'WRONG_PHASE');
    ps.funds += 100;
    assert.deepEqual(rewindToPrep(m, 1), { ok: true, round: 1 });
    assert.deepEqual({ choice: ps.diyChoice, diy: ps.diy, stock: ps.diyStock.snapshot() }, expected);
    assert.equal(apply(m, { 5: [] }).error, 'WRONG_PHASE');
  });
}

test('one or two configured candidates remain editable, including omitting the entire preset', t => {
  for (const n of [1, 2]) {
    const h = makeMatch({ mode: 'solo', fake: true, seats: [seat(preset(DATA, n))] }).start();
    t.after(() => h.m.dispose());
    const ps = h.m.order[0];
    assert.equal(ps.privateView().diyChoice.tiers.length, 2);
    assert.deepEqual(apply(h.m, { 5: [], 6: [] }), { ok: true });
    assert.deepEqual(ps.diy, {}); assert.equal(ps.diyStock.entries.size, 0);
    assert.equal(ps.gd, h.m.gd);
  }
});

test('batch validation and failure paths reject malformed selections without changing either tier', t => {
  const h = makeMatch({ mode: 'coop', fake: true, spectators: ['viewer'], seats: [seat(preset(DATA)), { seat: 1, playerId: 'p_1', connected: true }] }).start();
  t.after(() => h.m.dispose());
  const m = h.m, ps = m.order[0];
  for (const choices of [{ 5: [], 6: [] }, { 5: [ps.diyPreset[diyTierSlotIds(5, DATA)[0]].charId] }]) {
    assert.equal(validateC2S({ t: 'g.diyApply', choices, setupRevision: m.setupRevision }), null);
  }
  for (const choices of [{}, { 7: [] }, { 5: ['char_609_acguad', 'char_609_acguad'] }, { 5: ['a', 'b', 'c'] }]) {
    assert.ok(validateC2S({ t: 'g.diyApply', choices, setupRevision: m.setupRevision }));
  }
  const before = [ps.diy, ps.diyChoice, ps.diyStock, ps.infoReady];
  assert.equal(m.handle('viewer', { t: 'g.diyApply', choices: { 5: [] }, setupRevision: m.setupRevision }).error, 'SPECTATOR');
  const build = ps.buildDiyStock; ps.buildDiyStock = () => { throw new Error('test stock failure'); };
  m.reportError = () => {};
  assert.equal(apply(m, { 5: [], 6: [] }).error, 'INTERNAL'); ps.buildDiyStock = build;
  assert.deepEqual([ps.diy, ps.diyChoice, ps.diyStock, ps.infoReady], before);
  m.requestSetupReroll('p_0', m.setupRevision);
  assert.equal(apply(m, { 5: [] }).error, 'WRONG_PHASE');
  assert.deepEqual([ps.diy, ps.diyChoice, ps.diyStock, ps.infoReady], before);
});

test('the older exact-count command refuses partial selections', t => {
  const h = makeMatch({ mode: 'solo', fake: true, seats: [seat(preset(DATA))] }).start();
  t.after(() => h.m.dispose());
  const ps = h.m.order[0], id = ps.privateView().diyChoice.tiers[0].candidates[0].charId;
  assert.equal(h.m.handle('p_0', { t: 'g.diyChoose', tier: 5, charIds: [id], setupRevision: h.m.setupRevision }).error, 'BAD_TARGET');
  assert.equal(count(ps, 5), 2);
});

test('batch clear cancels a queued all-ready phase transition and leaves INFO_CHECK editable', t => {
  const h = makeMatch({ mode: 'solo', fake: true, seats: [seat(preset(DATA))] }).start();
  t.after(() => h.m.dispose());
  const m = h.m, ps = m.order[0];
  ps.infoReady = true;
  m.maybeEndInfo();
  assert.ok(m._infoAdvanceTimer);
  assert.deepEqual(apply(m, { 5: [], 6: [] }), { ok: true });
  assert.equal(m._infoAdvanceTimer, null);
  h.sched.advance(0);
  assert.equal(m.phase, 'INFO_CHECK');
  assert.equal(ps.infoReady, false);
  assert.deepEqual(ps.diy, {});
});
