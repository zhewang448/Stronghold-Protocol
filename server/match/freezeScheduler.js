// Match-local timer wrapper: keep wall-clock epochs, but hold every timer during emergency protection.
// Stable handles allow phase/field timers to be cancelled even while held. Intervals resume their remaining
// delay without replaying missed ticks; the underlying injectable scheduler remains usable by its owner.
export class FreezeScheduler {
  constructor(source, { ownsSource = false } = {}) {
    this.source = source;
    this.ownsSource = ownsSource;
    this.virtual = !!source.virtual;
    this.instant = !!source.instant;
    this.frozen = false;
    this.frozenAt = 0;
    this.disposed = false;
    this.handles = new Set();
  }

  now() { return this.source.now(); }
  gameNow() { return this.frozen ? this.frozenAt : this.now(); }
  runUntil(predicate, options) { return this.source.runUntil(predicate, options); }

  _create(fn, ms, every = 0) {
    if (this.disposed || typeof fn !== 'function') return null;
    const value = Number(ms);
    const delay = Number.isFinite(value) ? Math.min(2 ** 31 - 1, Math.max(0, value)) : 0;
    const handle = { fn, every, remaining: delay, at: this.gameNow() + delay, source: null, cancelled: false };
    this.handles.add(handle);
    if (!this.frozen) this._arm(handle);
    return handle;
  }

  _arm(handle) {
    handle.at = this.now() + handle.remaining;
    handle.source = this.source.setTimeout(() => {
      handle.source = null;
      if (handle.cancelled || this.disposed || this.frozen) return;
      if (handle.every > 0) {
        // Re-arm before the callback: clearInterval inside it still cancels the same stable handle.
        handle.remaining = handle.every;
        this._arm(handle);
      } else this.handles.delete(handle);
      handle.fn();
    }, handle.remaining);
  }

  setTimeout(fn, ms) { return this._create(fn, ms); }
  setInterval(fn, ms) {
    const value = Number(ms);
    const every = Number.isFinite(value) ? Math.min(2 ** 31 - 1, Math.max(1, value)) : 1;
    return this._create(fn, every, every);
  }
  clearTimeout(handle) {
    if (!handle || !this.handles.has(handle)) return;
    handle.cancelled = true;
    if (handle.source) this.source.clearTimeout(handle.source);
    handle.source = null;
    this.handles.delete(handle);
  }
  clearInterval(handle) { this.clearTimeout(handle); }

  freeze() {
    if (this.disposed || this.frozen) return false;
    this.frozenAt = this.now();
    this.frozen = true;
    for (const handle of this.handles) {
      handle.remaining = Math.max(0, handle.at - this.frozenAt);
      if (handle.source) this.source.clearTimeout(handle.source);
      handle.source = null;
    }
    return true;
  }

  resume() {
    if (this.disposed || !this.frozen) return 0;
    const elapsed = Math.max(0, this.now() - this.frozenAt);
    this.frozen = false;
    this.frozenAt = 0;
    for (const handle of this.handles) this._arm(handle);
    return elapsed;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const handle of [...this.handles]) this.clearTimeout(handle);
    if (this.ownsSource) this.source.dispose();
  }
}
