import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readStudioData } from '../server/studio/gameData.js';
import { buildTraining } from '../server/training.js';
import { parseTraining, newTraining, trainingFingerprint, copyTrainingPlan, metricDelta } from '../shared/training.js';
import { emptyPlayer } from '../shared/studio/scenario.js';
import { VERSIONS } from '../shared/versions.js';
import { loadBrowserSim } from '../public/js/battle/simLoader.js';
import { simulateTraining } from '../public/js/training/simulation.js';
import { TrainingClient } from '../public/js/training/client.js';
import { personalUnit, readLibrary, writeLibrary } from '../public/js/training/model.js';
import { buildConsoleScenario } from '../server/studio/console.js';
import { trainingScenario } from '../shared/training.js';
import { GameData } from '../server/match/gamedata.js';
import { computeBonds } from '../server/match/bondsMeta.js';
import { startServer } from '../server/index.js';

const root = path.resolve(import.meta.dirname, '..');
const raw = readStudioData(path.join(root, 'data'));
const cs = 'a'.repeat(64);
const service = data => ({ ids: [data.config?.version?.id || 'act2autochess'], defaultId: data.config?.version?.id || 'act2autochess',
  available: () => true, isEnabled: () => true, csOf: () => cs, data: () => data,
  modesOf: (_, type) => Object.entries(data.config.modes).filter(([, m]) => m.type === (type === 'solo' ? 'SINGLE' : 'MULTI')).map(([id, m]) => ({ ...m, id })) });
function documentOf(data = raw, version = 'act2autochess') {
  const modeId = Object.keys(data.config.modes).find(id => data.config.modes[id].type === 'SINGLE');
  return newTraining({ version, cs, scenario: { modeId, stageId: Object.keys(data.stages)[0] } });
}
const operator = (data = raw, char = 'char_103_angel') => Object.values(data.chess).find(r => r.charId === char && !r.isGolden && !r.isDiy);
const unit = (r, uid = 1, row = 10, col = 5) => ({ kind: 'chess', chessId: r.chessId, uid, row, col, dir: 'RIGHT', items: [] });
function exercise(data = raw, version = 'act2autochess') {
  const doc = documentOf(data, version);
  doc.plans.A[0].units.push(unit(operator(data) || Object.values(data.chess).find(r => !r.isGolden && !r.isDiy)));
  return doc;
}
async function simulate(built, data = raw, replay = false) {
  const values = { ...data };
  for (const [file, records] of Object.entries(built.extraData || {})) values[file] = { ...values[file], ...records };
  const sim = await loadBrowserSim({ base: pathToFileURL(path.join(root, 'server/sim/')).href, data: values, cs });
  return simulateTraining(built, sim, { replay, yieldTask: async () => {} });
}

test('A/B common conditions invalidate both results; copies, export and personal settings are independent', () => {
  const doc = exercise(), before = trainingFingerprint(doc, 'A');
  const copy = copyTrainingPlan(doc, 'A', 'B');
  assert.deepEqual(copy.plans.A, copy.plans.B);
  copy.plans.B[0].units[0].potential = 1;
  assert.equal(doc.plans.A[0].units[0].potential, undefined);
  assert.equal(trainingFingerprint(copy, 'A'), before);
  const b = trainingFingerprint(copy, 'B');
  copy.environment.seed++;
  assert.notEqual(trainingFingerprint(copy, 'A'), before);
  assert.notEqual(trainingFingerprint(copy, 'B'), b);
  assert.deepEqual(parseTraining(JSON.stringify(copy)), copy);
  const rec = operator();
  const preference = { v: 2, byChar: { [rec.charId]: { skill: 0 } }, ops: { [rec.charId]: { potential: 2, cultivate: 1 } } };
  const preferenceText = JSON.stringify(preference);
  const picked = personalUnit(rec, raw, preference); picked.skillIndex = 1;
  assert.equal(JSON.stringify(preference), preferenceText);
  assert.equal(picked.potential, 2);
  assert.deepEqual(metricDelta(0, 10), { delta: 10, percent: null });
  const blockedStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(readLibrary(blockedStorage), { drafts: {}, saved: [] });
  assert.equal(writeLibrary(copy, blockedStorage), false);
});

test('bad documents, stale content and illegal placement never compile a partial exercise', () => {
  assert.throws(() => parseTraining('{'));
  assert.throws(() => parseTraining('炎'.repeat(200000)));
  const doc = exercise();
  assert.throws(() => parseTraining(JSON.stringify({ ...doc, script: 'bad' })));
  assert.throws(() => buildTraining({ ...doc, cs: 'b'.repeat(64) }, 'A', service(raw)), /stale/);
  const invalid = structuredClone(doc); invalid.plans.A[0].units[0].row = 1;
  assert.throws(() => buildTraining(invalid, 'A', service(raw)));
  const tooMany = structuredClone(doc); tooMany.plans.A[0].units.push(unit(operator(), 2));
  assert.throws(() => buildTraining(tooMany, 'A', service(raw)));
  assert.throws(() => buildTraining(doc, 'C', service(raw)));
});

test('all five official versions build and run deterministic unit exercises without changing their data', async () => {
  for (const version of VERSIONS) {
    const data = version.dir ? readStudioData(path.join(root, 'data', version.dir)) : raw;
    const doc = exercise(data, version.id); doc.environment.seconds = 30;
    const before = JSON.stringify(doc), hp = data.enemies.enemy_1007_slime?.stats.maxHp;
    const built = buildTraining(doc, 'A', service(data));
    const one = await simulate(built, data), two = await simulate(built, data);
    assert.deepEqual(one, two, version.id);
    assert.equal(one.version, version.id); assert.ok(one.seconds > 0);
    assert.equal(JSON.stringify(doc), before); assert.equal(data.enemies.enemy_1007_slime?.stats.maxHp, hp);
  }
});

test('dummy HP caps damage, timeout includes deployment and replay reproduces the same accounting', async () => {
  const doc = exercise();
  const built = buildTraining(doc, 'A', service(raw));
  const normal = await simulate(built), replay = await simulate(built, raw, true);
  const { frames, ...withoutFrames } = replay;
  assert.deepEqual(normal, withoutFrames); assert.ok(frames.length > 10);
  assert.equal(normal.seconds, 60); assert.ok(normal.damage > 0);
  assert.equal(normal.dps, normal.damage / normal.seconds);
  doc.dummy.hp = 10;
  const killed = await simulate(buildTraining(doc, 'A', service(raw)));
  assert.equal(killed.damage, 10); assert.ok(killed.seconds < 60); assert.equal(killed.reason, 'cleared');
});

test('team bonds and official wave use match logic and preserve persistent layer input', () => {
  const doc = exercise(); doc.mode = 'team'; doc.environment.seconds = 20;
  doc.environment.modeId = 'mode_single_hard';
  // This official stage accepts the same tile used by the console regression tests.
  doc.plans.A[0].units[0].row = 12; doc.plans.A[0].units[0].col = 4;
  const bond = operator().bonds[0]; doc.plans.A[0].bonds[bond] = { tier: 10, layers: 50 };
  const built = buildTraining(doc, 'A', service(raw));
  const gd = new GameData(raw, doc.environment.modeId);
  const expected = computeBonds(gd, { board: new Map([['1', { kind: 'chess', id: operator().chessId, items: [] }]]), hand: [], layers: { [bond]: 50 } });
  assert.equal(built.bonds[0][bond]?.tier || 0, expected[bond]?.tier || 0);
  const plain = trainingScenario(doc, 'A'); plain.players[0].bonds = built.bonds[0];
  const consoleBuilt = buildConsoleScenario(plain, raw);
  assert.deepEqual(built.spec.spawns, consoleBuilt.spec.spawns);
  assert.deepEqual(built.spec.routes, consoleBuilt.spec.routes);
});

test('leaders support either one or two fields and preserve the official shared HP pool', () => {
  const doc = exercise(); doc.mode = 'team'; doc.environment.kind = 'boss'; doc.environment.round = 14; doc.environment.bossId = 'boss_1';
  doc.environment.modeId = 'mode_multi_hard';
  doc.plans.A[0].units[0].row = 12; doc.plans.A[0].units[0].col = 4;
  const one = buildTraining(doc, 'A', service(raw));
  doc.environment.fields = 2; doc.plans.A.push(emptyPlayer()); doc.plans.B.push(emptyPlayer());
  const two = buildTraining(doc, 'A', service(raw));
  const gd = new GameData(raw, doc.environment.modeId);
  assert.equal(one.spec.boss.poolHp, gd.bossPoolHp('boss_1', 1));
  assert.equal(two.spec.boss.poolHp, gd.bossPoolHp('boss_1', 2));
});

test('cancelled workers cannot deliver stale results and a fresh run can finish', async () => {
  const workers = [];
  const client = new TrainingClient(() => {
    const worker = { terminate() { this.terminated = true; }, postMessage(msg) { this.request = msg; } };
    workers.push(worker); return worker;
  });
  const first = client.run({}, {}); const rejection = assert.rejects(first, { name: 'AbortError' });
  const second = client.run({}, {}); await rejection;
  assert.equal(workers[0].terminated, true);
  workers[0].onmessage({ data: { t: 'done', id: workers[0].request.id, result: 'stale' } });
  workers[1].onmessage({ data: { t: 'done', id: workers[1].request.id, result: 'fresh' } });
  assert.equal(await second, 'fresh'); assert.equal(workers[1].terminated, true);
});

test('player HTTP API works without a studio key and rejects invalid documents and stale content', async t => {
  const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true, studio: false, assetIndex: false, recovery: false });
  t.after(() => server.close());
  const options = await fetch(server.url + '/api/training/options?version=act2autochess', { headers: { 'X-Forwarded-For': '8.8.8.8' } });
  assert.equal(options.status, 200);
  const value = await options.json(); assert.ok(value.versions.length >= 1);
  const post = body => fetch(server.url + '/api/training/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post(null)).status, 400);
  const doc = value.document; doc.plans.A[0].units = [unit(operator())];
  assert.equal((await post({ document: doc, side: 'A' })).status, 200);
  doc.cs = 'b'.repeat(64);
  const stale = await post({ document: doc, side: 'A' }); assert.equal(stale.status, 400);
  assert.equal((await stale.json()).path, 'cs');
  assert.equal((await fetch(server.url + '/training/')).status, 200);
  assert.equal((await fetch(server.url + '/studio/console.html')).status, 404);
});

test('summon damage remains attributed to its owner in unit exercises', async () => {
  const doc = exercise(); const owner = operator(raw, 'char_427_vigil'); assert.ok(owner);
  doc.plans.A[0].units = [unit(owner)];
  const built = buildTraining(doc, 'A', service(raw));
  const slot = built.tokens[0][0]; assert.ok(slot);
  doc.plans.A[0].units.push({ uid: 2, kind: 'token', tokenId: slot.tokenId, ownerUid: 1, row: 10, col: 6, dir: 'RIGHT' });
  const result = await simulate(buildTraining(doc, 'A', service(raw)));
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].uid, 1); assert.ok(result.damage > 0);
});

test('changing initial covenant layers changes real output while shared test conditions stay fixed', async () => {
  const doc = exercise(); doc.environment.modeId = 'mode_single_hard';
  const owner = operator(raw, 'char_306_leizi'); assert.ok(owner);
  doc.plans.A[0].units = [unit(owner)]; doc.plans.A[0].bonds.yanShip = { tier: 1, layers: 0 };
  const before = await simulate(buildTraining(doc, 'A', service(raw)));
  const copy = copyTrainingPlan(doc, 'A', 'B'); copy.plans.B[0].bonds.yanShip.layers = 100;
  const after = await simulate(buildTraining(copy, 'B', service(raw)));
  assert.ok(after.damage > before.damage); assert.equal(after.seconds, before.seconds);
  assert.deepEqual(copy.environment, doc.environment);
});
