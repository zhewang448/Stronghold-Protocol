// Read-only player exercises built with the match's placement, bonds and BattleSpec rules.
import { newScenario, cloneScenario, fail } from '../shared/studio/scenario.js';
import { newTraining, validateTraining, trainingScenario } from '../shared/training.js';
import { DEFAULT_VERSION, versionById } from '../shared/versions.js';
import { GameData } from './match/gamedata.js';
import { computeBonds } from './match/bondsMeta.js';
import { buildConsoleScenario } from './studio/console.js';
import { buildDeployMap } from './match/board.js';

export function trainingOptions(versions, requested) {
  const available = versions.ids.filter(id => versions.available(id));
  const version = requested || versions.defaultId;
  if (!available.includes(version)) fail('version', 'unavailable');
  const raw = versions.data(version);
  const modes = versions.modesOf(version, 'solo');
  if (!raw || !modes.length || !Object.keys(raw.stages || {}).length) fail('version', 'unavailable');
  const initialMode = modes.find(m => m.id === 'mode_single_1') || modes.find(m => m.difficulty === 'NORMAL') || modes[0];
  const scenario = { ...newScenario(), stageId: Object.keys(raw.stages)[0], modeId: initialMode.id };
  return { versions: available.map(id => ({ id, label: versionById(id).label, cs: versions.csOf(id) })),
    version, cs: versions.csOf(version), dataBase: version === DEFAULT_VERSION ? '/data/' : `/data/${versionById(version).dir}`,
    modes: [...modes, ...versions.modesOf(version, 'coop')],
    trainingStage: dummyStage(),
    deployMaps: Object.fromEntries([...Object.entries(raw.stages), ['training_lane', dummyStage()]].map(([id, stage]) => [id,
      Object.fromEntries(['normal', 'bossL', 'bossR'].map(field => [field, [...buildDeployMap(stage, { field })]]))])),
    document: newTraining({ version, cs: versions.csOf(version), scenario }) };
}

// [ASSUMED] A synthetic low-ground test lane and motionless high-HP target are training fixtures, not official maps.
export function dummyStage() {
  const rows = Array.from({ length: 19 }, () => '#'.repeat(21));
  for (let r = 9; r <= 12; r++) rows[r] = r === 9 ? '##hhhhhhhhh##########' : '##rrrrrrrrr##########';
  return { id: 'training_lane', name: 'training_lane', rows, devices: [],
    tiles: { r: { height: 'LOW', buildable: 'ALL' }, h: { height: 'HIGH', buildable: 'RANGED' }, '#': { height: 'LOW', buildable: 'NONE' } } };
}

export function buildTraining(input, side, versions) {
  const doc = validateTraining(input);
  if (!versions.isEnabled(doc.version) || !versions.available(doc.version)) fail('version', 'unavailable');
  if (doc.cs !== versions.csOf(doc.version)) fail('cs', 'stale');
  const raw = versions.data(doc.version);
  const s = trainingScenario(doc, side);
  const bondStates = [];
  if (!s.players.some(p => p.units.some(u => u.kind === 'chess'))) fail('units', 'empty');
  for (const p of s.players) for (const u of p.units) {
    if (u.kind === 'chess' && (!Object.hasOwn(raw.chess, u.chessId) || raw.chess[u.chessId].isDiy)) fail('chessId', 'unsupported');
  }
  if (doc.mode === 'team') {
    const gd = new GameData(raw, s.modeId);
    for (const p of s.players) {
      const board = new Map(p.units.filter(u => u.kind === 'chess').map(u => [String(u.uid), {
        id: u.chessId, kind: 'chess', items: u.items.map(id => ({ id })) } ]));
      const states = computeBonds(gd, { board, hand: [], layers: Object.fromEntries(Object.entries(p.bonds).map(([id, b]) => [id, b.layers])) });
      bondStates.push(states);
      p.bonds = Object.fromEntries(Object.entries(states).map(([id, b]) => [id, { tier: b.tier, layers: b.layers }]));
    }
  }
  let data = raw, stage = null;
  if (doc.mode === 'unit') {
    stage = dummyStage();
    data = { ...raw, stages: { ...raw.stages, [stage.id]: stage } };
    s.stageId = stage.id;
    s.flags = { dpInit: 99, dpMax: 99, layerGainsEnabled: false };
  }
  const built = buildConsoleScenario(s, data);
  built.spec.version = doc.version;
  built.spec.cs = doc.cs;
  built.spec.battleId = `training-${side}`;
  built.spec.fieldId = `training-${side}`;
  if (doc.mode === 'unit') {
    const enemyKey = Object.hasOwn(raw.enemies, 'enemy_1007_slime') ? 'enemy_1007_slime' : Object.keys(raw.enemies)[0];
    const target = cloneScenario(raw.enemies[enemyKey]);
    target.key = 'training_dummy'; target.name = 'training_dummy';
    target.stats = { ...target.stats, maxHp: doc.dummy.hp, atk: 0, def: doc.dummy.def, res: doc.dummy.res, moveSpeed: 0 };
    target.skills = []; target.abilities = []; target.talents = { bb: {}, bbStr: {} }; target.summons = [];
    target.dmgType = 'none'; target.stats.dmgType = 'none'; target.stats.dmgTypes = [];
    built.extraData = { stages: { [stage.id]: stage }, enemies: { training_dummy: target } };
    built.spec.routes = [{ motion: 'WALK', start: [10, 6], end: [10, 2], checkpoints: [] }];
    built.spec.spawns = [{ time: 0, enemyKey: 'training_dummy', routeIndex: 0, count: doc.dummy.count, interval: 0, pos: [10, 6] }];
    built.spec.enemyOverrides = {};
    built.spec.timeLimit = doc.environment.seconds;
    built.cap = doc.environment.seconds;
  }
  built.bonds = s.players.map(p => p.bonds);
  built.bondStates = bondStates;
  return { ...built, version: doc.version, cs: doc.cs, side, mode: doc.mode };
}
