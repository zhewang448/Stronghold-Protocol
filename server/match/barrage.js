// server/match/barrage.js — the host console's 表情弹幕 per-player rate cap (server/match/hostSettings.js
// emoteBarrageRate; the admin console keeps it in logs/admin-settings.json).
//
// A barrage pulse carries `count` falling pictures (the client merges a burst of clicks into one message). The host may
// allow at most `rate` pictures per player per rolling second; 0 / blank means no cap. This module owns only the
// accounting: the match calls takeBarrageBudget() before it broadcasts, so a pulse over the cap is truncated (or
// dropped) instead of reaching the screens. `state` is the PlayerState (its `barrageWindow` survives between pulses);
// `now` is the match scheduler's clock, so tests replay a minute of traffic without waiting.

/**
 * How many of `want` pictures may be broadcast now, consuming that much of the player's budget.
 * @param {{ barrageWindow?: { t: number, n: number } }} state the sender's PlayerState (mutated)
 * @param {number} now match clock (ms)
 * @param {number} want pictures this pulse asks for (>= 1)
 * @param {number|null|undefined} rate pictures per rolling second (0 / null / undefined = unlimited)
 * @returns {number} 0 … want — 0 means the pulse is dropped
 */
export function takeBarrageBudget(state, now, want, rate) {
  const n = Math.max(1, Math.trunc(Number(want) || 1));
  const cap = Number(rate);
  if (!Number.isFinite(cap) || cap <= 0) return n; // the host set no cap
  const window = state && state.barrageWindow;
  if (!window || !(now - window.t < 1000) || now < window.t) {
    if (!state) return Math.min(n, Math.floor(cap));
    state.barrageWindow = { t: now, n: Math.min(n, Math.floor(cap)) };
    return state.barrageWindow.n;
  }
  const left = Math.max(0, Math.floor(cap) - window.n);
  const take = Math.min(n, left);
  window.n += take;
  return take;
}
