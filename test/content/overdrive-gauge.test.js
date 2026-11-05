// test/content/overdrive-gauge.test.js — 过载 (term ba.overdrive "技能持续拥有两段计量槽，技能进行到一半时触发额外效果"): the timed
// skills that carry it mark `overdrive: true` and b.snap lists them in `overdrive` [[id, on]] (server/sim/snapshot.js
// overdriveView) — on 0 over the first half, 1 over the second, gone with the skill; the nine-field tuple keeps the whole
// fraction (the client cuts it in two: test/render/overdrive.test.js). And 塔露拉's 簇火 keep their time while she is
// controlled (feedback #143, planned by the owner on 2026-11-05; PRTS 备注 "不受塔露拉的当前状态影响").
// Run: node --test test/content/overdrive-gauge.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, atk: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy') };
const SLOT5 = 'chess_char_5_diy1_a';
const fillSp = (u) => { u.skill.sp = u.skill.spCost; u.skill.charges = u.skill.maxCharges; };
const row = (h, u) => h.b.snapshot().overdrive?.find((r) => r[0] === u.id) ?? null;
const tuple = (h, u) => h.b.snapshot().units.find((r) => r[0] === u.id);

function field(unit, { enemies = [{ key: 'enemy_dummy', pos: [10, 6] }] } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed: 5, enemies,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['skillStart', 'skillEnd'], captureNoisy: true,
    units: [{ uid: 1, row: 10, col: 5, ...unit }],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const oxi = () => field({ diy: { slot: SLOT5, charId: 'char_4247_oxi', skillIndex: 2, uniEquipId: null }, elite: true });
const wisdel = () => field({ diy: { slot: SLOT5, charId: 'char_1035_wisdel', skillIndex: 1, uniEquipId: null }, elite: true, col: 4 });

/** Run a cast skill through: the `overdrive` row before / after half time and after the end, the tuple's fraction. */
function gauge(h, u) {
  const sk = u.skill, D = sk.duration;
  assert.ok(D > 0 && sk.kind === 'duration', `${sk.id}: a timed skill`);
  assert.equal(row(h, u), null, 'no row before the cast');
  fillSp(u);
  assert.ok(sk.activate('manual'), `${sk.id} cast`);
  h.run(D / 4);
  assert.deepEqual(row(h, u), [u.id, 0], `${sk.id}: first gauge`);
  const t = tuple(h, u);
  assert.ok(Math.abs(t[5] / t[6] - sk.timeLeft / D) < 0.01, 'the tuple keeps the whole fraction');
  h.run(D / 2);
  assert.deepEqual(row(h, u), [u.id, 1], `${sk.id}: second gauge`);
  h.run(sk.timeLeft + 0.1);
  assert.equal(sk.active, false);
  assert.equal(row(h, u), null, `${sk.id}: gone with the skill`);
  checkInvariants(h.b);
}

test('过载 skills list their gauge in b.snap `overdrive`: 塔露拉 S3, 维什戴尔 S2', () => {
  { const { h, u } = oxi(); assert.equal(u.skill.id, 'skchr_oxi_3'); gauge(h, u); }
  { const { h, u } = wisdel(); assert.equal(u.skill.id, 'skchr_wisdel_2'); gauge(h, u); }
});

test('过载 skills: 号角 S3 (24 s, 过载 the last 12) lists its gauge too; a skill without 过载 never does', () => {
  const { h, u } = field({ chessId: 'chess_char_5_08_a' });
  assert.equal(u.skill.id, 'skchr_horn_3');
  gauge(h, u);
  const s3 = field({ diy: { slot: SLOT5, charId: 'char_1035_wisdel', skillIndex: 0, uniEquipId: null }, elite: true, col: 4 });
  fillSp(s3.u);
  s3.u.skill.activate('manual');
  s3.h.run(0.5);
  assert.equal(s3.h.b.snapshot().overdrive, undefined, 'S1: no list at all');
});


test('洛洛 S2 reports its actual stage; 号角 S2 keeps ammunition and no overload row', () => {
  const rock = field({ chessId: 'chess_char_2_10_a' });
  assert.equal(rock.u.skill.id, 'skchr_rockr_2'); gauge(rock.h, rock.u);
  const horn = field({ chessId: 'chess_char_5_08_a', skillIndex: 1 });
  assert.equal(horn.u.skill.id, 'skchr_horn_2'); fillSp(horn.u); horn.u.skill.activate('manual');
  assert.equal(row(horn.h, horn.u), null); assert.ok(horn.h.b.snapshot().ammo?.length);
});
