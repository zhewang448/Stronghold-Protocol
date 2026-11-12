import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readStudioData } from '../server/studio/gameData.js';
import { buildTraining } from '../server/training.js';
import { newTraining } from '../shared/training.js';
import { loadBrowserSim } from '../public/js/battle/simLoader.js';
import { simulateTraining } from '../public/js/training/simulation.js';
import { TrainingSimulation } from '../public/js/training/session.js';
import { autoTrainingPlacement, rangeAt } from '../public/js/training/placement.js';
import { buildDeployMap } from '../server/match/board.js';
import { dummyStage } from '../server/training.js';
import { TrainingPlayback } from '../public/js/training/playback.js';
import { trainingModeLabel } from '../public/js/training/model.js';
import { createTrainingReport } from '../public/js/training/report.js';
import { damageComposition, rankedResultRows, resultCurve, formatResultNumber } from '../public/js/training/resultModel.js';

const root = path.resolve(import.meta.dirname, '..');
const raw = readStudioData(path.join(root, 'data')), cs = 'a'.repeat(64);
test('training difficulty labels distinguish solo and co-op while preserving mode identities and level names', () => {
  const modes = Object.entries(raw.config.modes).filter(([, m]) => ['SINGLE', 'MULTI'].includes(m.type));
  const options = modes.map(([id, mode]) => [id, trainingModeLabel(mode)]);
  assert.equal(options.length, 8);
  assert.equal(new Set(options.map(([, label]) => label)).size, 8);
  assert.equal(options.find(([id]) => id === 'mode_single_normal')[1], '独立模拟 · 险境模拟');
  assert.equal(options.find(([id]) => id === 'mode_multi_normal')[1], '同盟模拟 · 险境模拟');
  assert.equal(trainingModeLabel({ type: 'SINGLE', name: '规程等级20' }), '独立模拟 · 规程等级20');
  assert.equal(trainingModeLabel({ type: 'MULTI', name: '险境模拟' }, 'Localized difficulty'), '同盟模拟 · Localized difficulty');
});
function scene(hp = 1e7) {
  const document = newTraining({ version: 'act2autochess', cs });
  document.dummy.hp = hp;
  document.plans.A[0].units = [{ kind: 'chess', uid: 1, chessId: 'chess_char_3_01_a', row: 10, col: 5, dir: 'RIGHT', items: [] }];
  const built = buildTraining(document, 'A', { isEnabled: () => true, available: () => true, csOf: () => cs, data: () => raw });
  return built;
}
async function engine(built) {
  const data = { ...raw };
  for (const [file, values] of Object.entries(built.extraData)) data[file] = { ...data[file], ...values };
  return loadBrowserSim({ data, cs, base: pathToFileURL(path.join(root, 'server/sim/')).href });
}
test('native preview starts at zero; live tick batches and fast comparison have identical effective results', async () => {
  const built = scene(), sim = await engine(built), session = new TrainingSimulation(built, sim);
  assert.equal(session.packet().snap.t, 0);
  let packet;
  while (!session.battle.finished) packet = session.step(7);
  const fast = await simulateTraining(built, sim, { yieldTask: async () => {} });
  assert.deepEqual(packet.metrics, fast);
  assert.ok(packet.meta.units.every(u => u.spine && u.defId));
  session.stop();
});
test('seeking reconstructs engine state and clears old events without changing final damage', async () => {
  const built = scene(), sim = await engine(built), session = new TrainingSimulation(built, sim);
  const at = session.step(300); assert.ok(at.frames.some(frame => frame.ev.length));
  const seek = await session.seek(300);
  assert.equal(seek.reset, true); assert.deepEqual(seek.snap, at.snap); assert.equal(seek.ev.length, 0);
  while (!session.battle.finished) session.step(600);
  const summary = session.summary();
  const reset = await session.seek(0); assert.equal(reset.snap.t, 0); assert.equal(reset.metrics.damage, 0);
  while (!session.battle.finished) session.step(30);
  assert.deepEqual(session.summary(), summary); session.stop();
});
test('automatic placement aims at the dummy using the selected skill/module range', () => {
  const map = [...buildDeployMap(dummyStage())];
  for (const r of Object.values(raw.chess).filter(r => !r.isGolden && !r.isDiy && r.rangeGrid?.length)) {
    const chosen = autoTrainingPlacement(r, { chessId: r.chessId, kind: 'chess' }, map);
    assert.ok(chosen, r.name);
    const canHit = map.some(([key, type]) => { const [row, col] = key.split(',').map(Number); if (row === 10 && col === 6 || type === 'ranged' && r.position === 'MELEE') return false; return ['UP', 'DOWN', 'LEFT', 'RIGHT'].some(dir => rangeAt(r, { row, col, dir }).some(([rr, cc]) => rr === 10 && cc === 6)); });
    if (canHit) assert.ok(rangeAt(r, chosen).some(([row, col]) => row === 10 && col === 6), r.name);
  }
});
test('two exercises share one playback tick schedule and early completion holds its final packet', async () => {
  const savedCancel = globalThis.cancelAnimationFrame; globalThis.cancelAnimationFrame = () => {};
  const outputs = {}, clients = [];
  const playback = new TrainingPlayback({ onPacket: (s, p) => { outputs[s] = p; }, factory: () => {
    const index = clients.length;
    const client = { ticks: 0, stop() {}, async start() { return { ticks: 0, finished: false }; },
      async step(n) { this.ticks += n; return { ticks: this.ticks, finished: index === 0 && this.ticks >= 10 }; },
      async seek(n) { this.ticks = n; return { ticks: n, finished: false, reset: true }; } };
    clients.push(client); return client;
  } });
  try {
    await playback.start({ A: { cap: 60 }, B: { cap: 60 } }, {}, false);
    await playback.advance(10); await playback.advance(20);
    assert.equal(outputs.A.ticks, 10); assert.equal(outputs.B.ticks, 30);
    await playback.seek(0); assert.equal(outputs.A.ticks, 0); assert.equal(outputs.B.ticks, 0);
    playback.stop();
  } finally { globalThis.cancelAnimationFrame = savedCancel; }
});

test('native packets retain attack, death and redeployment events across the full rehearsal', async () => {
  const built = scene(); built.cap = 120; built.spec.timeLimit = 120;
  const target = built.extraData.enemies.training_dummy;
  target.dmgType = 'phys'; target.stats.dmgType = 'phys'; target.stats.dmgTypes = ['phys'];
  target.stats.atk = 100000; target.stats.bat = .3;
  target.applyWay = 'RANGED'; target.stats.rangeRadius = 3;
  const sim = await engine(built), session = new TrainingSimulation(built, sim), counts = {};
  for (const e of session.packet().ev) counts[e[0]] = (counts[e[0]] || 0) + 1;
  while (!session.battle.finished) for (const frame of session.step(30).frames) for (const e of frame.ev) counts[e[0]] = (counts[e[0]] || 0) + 1;
  assert.ok(counts.atk > 0, JSON.stringify(counts)); assert.ok(counts.die > 0, JSON.stringify(counts)); assert.ok(counts.deploy >= 2, JSON.stringify(counts));
  session.stop();
});

test('detailed report conserves damage types, timeline totals and early-final-interval DPS', async () => {
  const built = scene(10), sim = await engine(built), session = new TrainingSimulation(built, sim);
  while (!session.battle.finished) session.step(30);
  const report = session.summary();
  assert.equal(report.damage, 10); assert.equal(report.targetHpLeft, 0); assert.equal(report.targetHpMax, 10);
  assert.equal(damageComposition(report).reduce((n, type) => n + type.value, 0), report.damage);
  assert.equal(report.series.at(-1).damage, report.damage);
  assert.equal(report.series.at(-1).seconds, report.seconds);
  assert.equal(resultCurve(report.series, 'dps').at(-1).value, report.damage / report.seconds);
  assert.equal(report.rows.reduce((n, row) => n + row.attacks, 0), report.attacks);
  assert.ok(report.attacks > 0); session.stop();
});

test('effective healing is capped, taken damage and attack counters include owned summons', async () => {
  const built = scene(), owner = Object.values(raw.chess).find(r => r.charId === 'char_427_vigil' && !r.isGolden);
  built.spec.players[0].units = [{ uid: 1, kind: 'chess', chessId: owner.chessId, row: 10, col: 5, dir: 'RIGHT', items: [] },
    { uid: 2, kind: 'token', tokenId: 'token_10028_vigil_wolf', ownerUid: 1, row: 10, col: 6, dir: 'RIGHT' }];
  const sim = await engine(built), battle = sim.spec.createBattleFromSpec(built.spec, sim.ds, { quiet: true });
  const meter = createTrainingReport(battle, built); battle.start();
  for (let i = 0; i < 30; i++) battle.step();
  const op = battle.allyUnits.find(u => u.kind === 'op'), token = battle.allyUnits.find(u => u.kind === 'token');
  assert.ok(op && token);
  battle.dealHPLose({ source: null, target: op, amount: 100 });
  const healed = battle.heal(token, op, 500);
  const report = meter.read();
  assert.equal(healed, 100); assert.equal(report.healing, 100); assert.equal(report.taken, 100);
  assert.equal(report.rows.length, 1); assert.equal(report.rows[0].uid, 1);
  assert.equal(report.rows[0].taken, 100); assert.equal(report.rows[0].healing, 100);
  assert.equal(report.hps, report.healing / report.seconds); meter.stop();
});

test('ranking, percentages and exact number display handle zero-output and mixed contribution reports', () => {
  const report = { damage: 100, rows: [
    { key: 'a', damage: 25, healing: 100, taken: 30, types: { phys: 25, arts: 0, true: 0, elemental: 0 } },
    { key: 'b', damage: 75, healing: 0, taken: 90, types: { phys: 0, arts: 75, true: 0, elemental: 0 } }] };
  assert.deepEqual(rankedResultRows(report, 'healing').map(row => row.key), ['a', 'b']);
  assert.equal(rankedResultRows(report, 'damage')[0].share, 75);
  assert.equal(damageComposition(report).find(type => type.type === 'arts').share, 75);
  assert.ok(damageComposition({ damage: 0, rows: [] }).every(type => type.share === 0));
  assert.equal(formatResultNumber(12345.67, { compact: false }), '12,345.7');
  assert.notEqual(formatResultNumber(12345.67), formatResultNumber(12345.67, { compact: false }));
  assert.equal(formatResultNumber(NaN), '—');
});
