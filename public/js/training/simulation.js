import { createTrainingReport } from './report.js';

/** Same fixed ticks and effective-damage meter as actual battles; no rendering or room messages. */
export async function simulateTraining(compiled, sim, { replay = false, progress = () => {}, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const battle = sim.spec.createBattleFromSpec(compiled.spec, sim.ds, { quiet: true, recordEvents: false });
  const report = createTrainingReport(battle, compiled);
  const frames = [];
  const cap = Math.ceil(compiled.cap * 30);
  const stride = Math.max(3, Math.ceil(cap / 1200));
  const capture = () => frames.push({ time: battle.time,
    units: battle.units.filter(u => u.alive && !u.removed).slice(0, 240).map(u => ({ id: u.id, uid: u.uid, ownerId: u.ownerId,
      name: u.name, side: u.side, kind: u.kind, x: u.x, y: u.y, hp: u.hp, maxHp: u.s.maxHp })) });
  try {
    battle.start(); report.sample();
    if (replay) capture();
    for (let tick = 0; tick < cap && !battle.finished; tick++) {
      battle.step();
      report.sample();
      if (replay && (tick % stride === stride - 1 || battle.finished)) capture();
      if (tick % 240 === 239) { progress(Math.min(1, (tick + 1) / cap)); await yieldTask(); }
    }
    if (!battle.finished) battle.forceEnd('timeout');
    if (battle.errorCount) throw new Error('TRAINING_SIMULATION');
    return { ...report.read(),
      ...(replay ? { frames } : {}) };
  } finally { report.stop(); }
}
