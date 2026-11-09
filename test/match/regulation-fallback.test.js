import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { makeMatch } from './harness.js';
import { diyPickOff } from '../../shared/diy.js';

test('regulation human draft timeout uses an offered strategy when the borrowed timeout id is absent', t => {
  const h = makeMatch({ data: getVersionData('act3autochess@V3_1'), humans: 1, fake: true }).start();
  t.after(() => h.m.dispose());
  h.toPrep();
  const ps = h.ps('p_0');
  assert.ok(h.m.gd.bandAllowed(ps.bandId));
  assert.equal(h.m.phase, 'PREP');
  assert.deepEqual(h.logs.error, []);
});

test('regulation DIY availability follows a disabled core even while an addon remains active', () => {
  const data = structuredClone(getVersionData('act3autochess@V3_1'));
  const [charId, rec] = Object.entries(data.backups.diy.operators).find(([, rec]) => rec.bonds.some(id => data.bonds[id]?.isCore));
  const core = rec.bonds.find(id => data.bonds[id]?.isCore);
  const addon = Object.keys(data.bonds).find(id => !data.bonds[id].isCore);
  rec.bonds = [core, addon];
  assert.equal(diyPickOff(data, charId, new Set([core])), true);
  assert.equal(diyPickOff(data, charId, new Set()), false);
});
