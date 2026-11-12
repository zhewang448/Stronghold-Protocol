import { TrainingSessionClient } from './client.js';

/** Both A/B realms take identical ticks. Additional views do not own clocks. */
export class TrainingPlayback {
  constructor({ onPacket, onState, onError, factory = () => new TrainingSessionClient() }) {
    Object.assign(this, { onPacket, onState, onError, factory });
    this.sessions = {}; this.packets = {}; this.generation = 0; this.speed = 1; this.clock = 0; this.playing = false;
  }
  notify() { this.onState?.({ playing: this.playing, seconds: this.clock / 30, speed: this.speed, busy: !!this.inflight,
    finished: Object.keys(this.packets).length > 0 && Object.values(this.packets).every(p => p.finished) }); }
  async start(compiled, raw, play = true) {
    this.stop(); const generation = this.generation;
    this.clock = 0; this.cap = Math.max(...Object.values(compiled).map(c => Math.ceil(c.cap * 30)));
    const entries = await Promise.all(Object.entries(compiled).map(async ([side, built]) => {
      const session = this.factory(); this.sessions[side] = session; return [side, await session.start(built, raw)];
    }));
    if (generation !== this.generation) return;
    for (const [side, packet] of entries) { this.packets[side] = packet; this.onPacket(side, packet); }
    this.notify(); if (play) this.play();
  }
  play() {
    if (this.playing || !Object.keys(this.sessions).length) return;
    this.playing = true; this.previous = 0; this.debt = 0; const generation = this.generation;
    const frame = now => {
      if (!this.playing || generation !== this.generation) return;
      if (this.previous) this.debt = Math.min(120, this.debt + Math.min(.2, (now - this.previous) / 1000) * 30 * this.speed);
      this.previous = now;
      if (!this.inflight && this.debt >= 1) {
        const n = Math.min(24, Math.floor(this.debt)); this.debt -= n;
        this.inflight = this.advance(n, generation).catch(error => {
          if (generation === this.generation && error.name !== 'AbortError') { this.pause(); this.onError?.(error); }
        }).finally(() => { if (generation === this.generation) { this.inflight = null; this.notify(); } });
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame); this.notify();
  }
  async advance(n, generation = this.generation) {
    const entries = await Promise.all(Object.entries(this.sessions).map(async ([side, session]) => [side,
      this.packets[side]?.finished ? this.packets[side] : await session.step(n)]));
    if (generation !== this.generation) return;
    this.clock = Math.min(this.cap, this.clock + n);
    for (const [side, packet] of entries) { this.packets[side] = packet; this.onPacket(side, packet); }
    if (entries.every(([, p]) => p.finished)) this.pause();
    this.notify();
  }
  pause() { this.playing = false; cancelAnimationFrame(this.raf); this.previous = 0; this.notify(); }
  speedTo(speed) { this.speed = speed; this.debt = 0; this.notify(); }
  async seek(seconds) {
    this.pause(); const generation = this.generation;
    if (this.inflight) await this.inflight;
    if (generation !== this.generation) return;
    this.inflight = Promise.all(Object.entries(this.sessions).map(async ([side, session]) => [side, await session.seek(Math.min(this.cap, Math.max(0, Math.round(seconds * 30))))]));
    this.notify();
    try {
      const entries = await this.inflight;
      if (generation !== this.generation) return;
      this.clock = Math.round(seconds * 30);
      for (const [side, packet] of entries) { this.packets[side] = packet; this.onPacket(side, packet); }
    } finally { if (generation === this.generation) { this.inflight = null; this.notify(); } }
  }
  stop() {
    this.generation++; this.playing = false; cancelAnimationFrame(this.raf);
    for (const session of Object.values(this.sessions)) session.stop();
    this.sessions = {}; this.packets = {}; this.inflight = null;
  }
}
