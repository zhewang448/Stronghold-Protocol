// Production path: a match seat's 自选 pick, battleInput, and BattleSpec on its DataSource.
// The reference fork's ally-death layers are deliberately absent from this implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import { GEO } from '../../shared/constants.js';
import { makeMatch, legalTileFor } from '../match/harness.js';

const REAL = { skip: !hasGeneratedData() };
const wire = (msg) => JSON.parse(JSON.stringify(msg));
const OXI = 'char_4247_oxi';
const T6A = 'chess_char_6_diy1_a';

function oxiMatch(skillIndex) {
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [T6A]: { charId: OXI, skillIndex, uniEquipId: null } } }];
  return makeMatch({ mode: 'solo', seats, seed: 11 });
}
function place(m, ps, id) {
  const p = ps.acquireChess(id, { source: 'buy' });
  const tile = legalTileFor(m, ps, p.id);
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.move', uid: p.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true });
  return p;
}
function oxiBattle(skillIndex, others = ['chess_char_1_01_a']) {
  const h = oxiMatch(skillIndex).start();
  const m = h.m;
  h.toPrep(1);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values()]) ps.returnCopies(p);
  ps.board.clear(); ps.recompute();
  const oxi = place(m, ps, T6A);
  const rest = others.map((id) => place(m, ps, id));
  const input = ps.battleInput();
  const wave = m.wave;
  const spec = wire(buildBattleSpec({
    battleId: 't.1', fieldId: 'n:p_0', kind: 'normal', seed: 77, modeId: m.modeId, round: 1, stageId: m.stageId,
    rect: { ...GEO.NORMAL_RECT }, timeLimit: 60, players: [input], spawns: wave.spawns.map((x) => ({ ...x, ownerPlayerId: 'p_0' })),
    routes: wave.routes, flags: { layerGainsEnabled: true, ...m.gd.dp }, enemyOverrides: wave.overrides ?? {}, content: 'full',
  }));
  const bt = createBattleFromSpec(spec, m.ds, { quiet: true, recordEvents: false });
  return { h, m, ps, bt, oxi: bt.allyUnits.find((u) => u.uid === oxi.uid), rest: rest.map((p) => bt.allyUnits.find((u) => u.uid === p.uid)), input };
}
const gains = (bt) => { const g = bt._pp('p_0').layerGains; return [g.arcaneShip ?? 0, g.indomShip ?? 0]; };

test('production path: S3 active and an ally dies; no source-specific bond layers are added', REAL, () => {
  const { bt, oxi, rest } = oxiBattle(2);
  assert.ok(oxi, 'she is on the field');
  assert.deepEqual([...(oxi.def.bonds || [])].sort(), ['emptyShip']);
  for (let i = 0; i < 30 && !(oxi.deployed && rest[0].deployed); i++) bt.step();
  assert.ok(oxi.deployed && rest[0].deployed, 'both deployed');
  oxi.skill.sp = oxi.skill.spCost; oxi.skill.charges = oxi.skill.maxCharges;
  oxi.skill.activate('manual');
  assert.ok(oxi.skill.active, 'S3 running');
  bt.kill(rest[0], null);
  bt.step();
  assert.deepEqual(gains(bt), [0, 0]);
});

test('#120 the rule needs her skill running: S3 ready but not cast yet (the automatic cast waits for its 3 s cooldown) → a knocked-out ally gives nothing', REAL, () => {
  const { bt, oxi, rest } = oxiBattle(2);
  for (let i = 0; i < 30 && !(oxi.deployed && rest[0].deployed); i++) bt.step();
  oxi.skill.sp = oxi.skill.spCost;
  assert.ok(!oxi.skill.active);
  bt.kill(rest[0], null);
  bt.step();
  assert.deepEqual(gains(bt), [0, 0]);
});
