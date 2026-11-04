// ui/gameLogic/barrage.js — 表情弹幕 (emote barrage, host console): pure helpers, no DOM / Preact imports so Node tests
// can import them. The falling layer itself lives in ui/emoteBarrage.js.
//
// The fall follows the official barrage's shape (Cloudnyco/Duel-Channel web/src/emote.js, docs/ARCHITECTURE.md
// "飘落弹幕": a fixed lane count, a random point inside the chosen lane, one eased fall from above the top edge to
// below the bottom edge, a growing / shrinking scale). Here: 9 lanes, a 2.7–3.7 s fall, a small sway + spin, and the
// fade-out is done by CSS keyframes, not per-frame DOM writes.
//
//   rainBurst    the particle parameters of one pulse (pure for a given RNG; tests pass a stub)
//   barrageSide  which screen a received pulse belongs to (sender / target / any watcher, or none)
//   rememberBarrage / takeBarrageReplay  the last second of pulses per target, replayed when a watcher switches to it

import { EMOTE_BARRAGE_REPLAY_MS } from '../../../../shared/constants.js';

export const BARRAGE_RAIN = Object.freeze({
  LANES: 9,
  LEFT_MIN: 0.04, LEFT_MAX: 0.96,
  DELAY_MAX_MS: 620,
  DURATION_MIN_MS: 2700, DURATION_MAX_MS: 3700,
  SWAY_MIN_REM: 0.1, SWAY_MAX_REM: 0.42,
  SPIN_MIN_DEG: -12, SPIN_MAX_DEG: 12,
  SIZE_MIN_REM: 0.46, SIZE_MAX_REM: 0.66,
});

const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
const round2 = (v) => Math.round(v * 100) / 100;

/** Pictures one pulse asks for (the client's merged click count, bounded). */
export function barrageCount(e) {
  return Math.max(1, Math.min(1000, Math.trunc(Number(e?.count) || 1)));
}

/**
 * Particle parameters of one pulse: exactly `count` drops (one per click — 5 clicks, 5 falls), each with its own lane /
 * position / delay / speed.
 * @param {() => number} [rand] a `[0,1)` source (a stub makes it testable)
 * @param {number} [count]
 * @returns {Array<{ lane:number, left:number, delay:number, duration:number, sway:number, spin:number, size:number }>}
 */
export function rainBurst(rand = Math.random, count = 1) {
  const r = typeof rand === 'function' ? rand : Math.random;
  const n = Math.max(1, Math.trunc(Number(count) || 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const lane = Math.min(BARRAGE_RAIN.LANES - 1, Math.floor(num(r(), 0, 0.999999) * BARRAGE_RAIN.LANES));
    const across = num((lane + 0.15 + 0.7 * num(r(), 0, 1)) / BARRAGE_RAIN.LANES, BARRAGE_RAIN.LEFT_MIN, BARRAGE_RAIN.LEFT_MAX);
    out.push({
      lane,
      left: round2(across * 100),
      delay: Math.round(num(r(), 0, 1) * BARRAGE_RAIN.DELAY_MAX_MS),
      duration: Math.round(BARRAGE_RAIN.DURATION_MIN_MS + num(r(), 0, 1) * (BARRAGE_RAIN.DURATION_MAX_MS - BARRAGE_RAIN.DURATION_MIN_MS)),
      sway: round2(BARRAGE_RAIN.SWAY_MIN_REM + num(r(), 0, 1) * (BARRAGE_RAIN.SWAY_MAX_REM - BARRAGE_RAIN.SWAY_MIN_REM)),
      spin: Math.round(BARRAGE_RAIN.SPIN_MIN_DEG + num(r(), 0, 1) * (BARRAGE_RAIN.SPIN_MAX_DEG - BARRAGE_RAIN.SPIN_MIN_DEG)),
      size: round2(BARRAGE_RAIN.SIZE_MIN_REM + num(r(), 0, 1) * (BARRAGE_RAIN.SIZE_MAX_REM - BARRAGE_RAIN.SIZE_MIN_REM)),
    });
  }
  return out;
}

/** Milliseconds a particle lives: its delay + fall + a small margin for the fade / removal. */
export const particleLife = (p) => Math.max(0, Math.round(p.delay + p.duration + 80));

/**
 * Which screen a received barrage pulse belongs to.
 *   'sender'  the player who sent it (always sees its own falls — instant feedback)
 *   'all'     the server marked a 联防 broadcast: every screen plays it
 *   'target'  the player whose board it falls on
 *   'watcher' a client currently watching that board
 *   null      nothing changes on this screen
 * @param {{ watch?: string|null, playerId?: string, all?: boolean }} e an `m.emote` record
 * @param {{ myId?: string, watchingOther?: boolean, watchedPid?: string|null }} o
 */
export function barrageSide(e, { myId = '', watchingOther = false, watchedPid = null } = {}) {
  if (!e || typeof e.watch !== 'string' || !e.watch) return null;
  if (e.playerId === myId) return 'sender';
  if (e.all === true) return 'all';
  if (e.watch === myId) return 'target';
  if (watchingOther && watchedPid && e.watch === watchedPid) return 'watcher';
  return null;
}

/** Per-client, in-memory: target playerId → its recent pulses (the 观战脉冲 replay). Not persisted. */
const replayCache = new Map();

/** Remember a received pulse for its target (call for every event, whichever screen it belongs to). */
export function rememberBarrage(e, now = Date.now()) {
  if (!e || typeof e.watch !== 'string' || !e.watch) return;
  const at = Number.isFinite(Number(e.at)) ? Number(e.at) : now;
  const list = (replayCache.get(e.watch) || []).filter((x) => now - x.at < EMOTE_BARRAGE_REPLAY_MS);
  list.push({ at, seq: Number(e.seq) || 0, watch: e.watch, playerId: e.playerId, id: e.id, count: barrageCount(e), all: e.all === true });
  replayCache.set(e.watch, list);
}

/** The last-second pulses cached for a target (expired ones dropped), oldest first. */
export function takeBarrageReplay(target, now = Date.now()) {
  const list = (replayCache.get(target) || []).filter((x) => now - x.at < EMOTE_BARRAGE_REPLAY_MS);
  if (list.length) replayCache.set(target, list);
  else replayCache.delete(target);
  return list;
}

/** Test / session helper: forget every cached replay. */
export function clearBarrageReplay() { replayCache.clear(); }
