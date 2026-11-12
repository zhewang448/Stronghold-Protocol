import { createTrainingReport } from './report.js';

/** One deterministic exercise. The UI owns playback speed; the engine only receives integer tick counts. */
export class TrainingSimulation {
  constructor(compiled, sim) {
    this.compiled = compiled; this.sim = sim; this.cap = Math.ceil(compiled.cap * 30);
    this.reset();
  }
  reset() {
    this.report?.stop();
    this.battle = this.sim.spec.createBattleFromSpec(this.compiled.spec, this.sim.ds, { quiet: true, recordEvents: true });
    this.report = createTrainingReport(this.battle, this.compiled); this.ticks = 0;
    this.battle.start(); this.report.sample();
  }
  summary() {
    return this.report.read();
  }
  packet(frames = [], reset = false) {
    const b = this.battle;
    return { reset, ticks: this.ticks, finished: b.finished, meta: b.fieldMeta(), snap: b.snapshot(), ev: b.drainEvents(), frames,
      metrics: this.summary(),
      stats: b.units.filter(u => u.alive).map(u => ({ id: u.id, uid: u.uid, ownerId: u.ownerId, defId: u.defId,
        hp: u.hp, maxHp: u.s.maxHp, atk: u.s.atk, def: u.s.def, res: u.s.res, interval: u.s.interval,
        sp: u.skill?.spTotal || 0, spMax: u.skill?.spCost || 0, range: u.rangeKeys ? [...u.rangeKeys].map(k => [Math.floor(k / 21), k % 21]) : [] })) };
  }
  step(count, capture = true) {
    if (!Number.isInteger(count) || count < 0 || count > 600) throw new RangeError('invalid training ticks');
    const frames = [], b = this.battle;
    for (let n = 0; n < count && !b.finished; n++) {
      b.step(); this.ticks++;
      if (this.ticks >= this.cap && !b.finished) b.forceEnd('timeout');
      this.report.sample();
      if (capture && (n % 3 === 2 || n === count - 1 || b.finished)) frames.push({ snap: b.snapshot(), ev: b.drainEvents() });
      else if (!capture) b.drainEvents();
    }
    if (b.errorCount) throw new Error('TRAINING_SIMULATION');
    return this.packet(frames);
  }
  async seek(ticks) {
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > this.cap) throw new RangeError('invalid training position');
    this.reset(); this.battle.drainEvents();
    while (this.ticks < ticks && !this.battle.finished) {
      this.step(Math.min(600, ticks - this.ticks), false);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return this.packet([], true);
  }
  stop() { this.report?.stop(); }
}
