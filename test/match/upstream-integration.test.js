import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { diySlot, diySlotIds } from '../../shared/diy.js';
import { makeMatch } from './harness.js';
import { capturePrep, rewindToPrep } from '../../server/match/rewind.js';
import { recoveryPayload, restoreMatch } from '../../server/recovery.js';

const data = getVersionData('act3autochess@V3_1');
function preset() {
  const picks = {};
  for (const tier of [5, 6]) {
    const ids = diySlotIds(data).filter(id => diySlot(id, data).tier === tier);
    data.backups.diy.prototypes[tier].slice(0, 3).forEach((charId, i) => { picks[ids[i]] = { charId }; });
  }
  // A legacy bench remains saved but cannot replace a formal Regulation roster slot.
  picks.diyBench_5_1 = { charId: data.backups.diy.prototypes[5][3] };
  return picks;
}

for (const count of [0, 1, 2]) test(`Regulation ${count} picks per tier persist through rewind and recovery with independent pools`, t => {
  const seats = Array.from({ length: 8 }, (_, seat) => ({ seat, playerId: `p_${seat}`, name: `P${seat}`, isBot: false,
    connected: true, diy: preset() }));
  const h = makeMatch({ data, mode: 'coop', difficulty: 'FUNNY', seats, independentPools: true, fake: true, seed: 71 }).start();
  t.after(() => h.m.dispose());
  assert.equal(h.m.order[0].hasDiyChoice(), false);
  assert.equal(h.m.handle('p_0', { t: 'g.diyApply', choices: { 5: [] }, setupRevision: h.m.setupRevision }).error, 'WRONG_PHASE');
  h.m.enterBandDraft();
  h.m.finishBandDraft(true);
  assert.equal(h.m.phase, 'CUSTOM_CHECK');
  assert.equal(h.m.draft.groups.length, 2);
  const selected = diySlotIds(data).filter(id => h.m.order[0].diy[id])
    .filter(id => diySlotIds(data).filter(other => diySlot(other, data).tier === diySlot(id, data).tier).indexOf(id) < count);
  for (const ps of h.m.order) {
    assert.deepEqual(ps.diyStock.snapshot(), {});
    assert.equal(h.m.confirmDiyBring(ps, selected).ok, true);
    assert.equal(ps.diy.diyBench_5_1, undefined);
  }
  h.toPrep();
  const before = h.m.order.map(ps => ({ bring: ps.diyBring, stock: ps.diyStock.snapshot() }));
  const snap = capturePrep(h.m);
  assert.equal(rewindToPrep(h.m, 1).ok, true);
  assert.deepEqual(h.m.order.map(ps => ({ bring: ps.diyBring, stock: ps.diyStock.snapshot() })), before);
  const record = recoveryPayload(h.m, snap || h.m.prepSnapshots.get(1));
  const restored = makeMatch({ data, mode: 'coop', difficulty: 'FUNNY', seats: record.seats, independentPools: true, fake: true, seed: 71 });
  t.after(() => restored.m.dispose());
  restoreMatch(restored.m, record);
  assert.deepEqual(restored.m.order.map(ps => ({ bring: ps.diyBring, stock: ps.diyStock.snapshot() })), before);
  assert.equal(restored.m.poolGroups.length, 8);
});
