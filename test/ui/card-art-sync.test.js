import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../public/js/store.js';
import { installCardArtSync, SYNC_DEBOUNCE_MS, RETRY_MS } from '../../public/js/ui/loadoutSync.js';

const ticks = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function harness() {
  const listeners = new Map(), pending = new Map();
  let now = 0, nextId = 0;
  const timers = {
    setTimeout(fn, ms) { const id = ++nextId; pending.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    async advance(ms) {
      now += ms;
      for (const [id, task] of [...pending]) if (task.at <= now) { pending.delete(id); task.fn(); await ticks(); }
      await ticks();
    },
  };
  const net = {
    status: 'online', sent: [], failures: [],
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn); return () => listeners.get(name).delete(fn);
    },
    emit(name, message) { for (const listener of listeners.get(name) || []) listener(message); },
    async request(t, body) {
      this.sent.push({ t, ...body }); const code = this.failures.shift();
      if (code) throw Object.assign(new Error(code), { code });
    },
  };
  const target = createStore({ values: { custom: { zoom: 1.8, ox: 23, oy: -19 } },
    scope: { roomCode: 'ABCD', playerId: 'p1', key: 'custom', frameKey: 'custom' }, sync: 'idle', supported: false, retry: 0 });
  const app = createStore({ room: { code: 'ABCD' }, me: { playerId: 'p1' } });
  const sync = installCardArtSync({ net, timers, target, app });
  const welcome = () => net.emit('welcome', { uiMigration: { cardArt: true } });
  return { net, timers, target, app, welcome, ...sync };
}

test('artwork sync sends the active appearance, preserves inactive frames and resends on reconnect', async t => {
  const h = harness(); t.after(h.dispose);
  h.welcome(); await h.timers.advance(50);
  assert.deepEqual(h.net.sent, [{ t: 'room.cardArt', code: 'ABCD', key: 'custom', frame: { zoom: 1.8, ox: 23, oy: -19 } }]);
  h.target.set({ values: { ...h.target.get().values, char_113_cqbw: { zoom: 0.6, ox: -17, oy: 30 } } });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  assert.equal(h.net.sent.length, 1, 'an inactive appearance spends no message budget');
  h.target.set({ scope: { ...h.target.get().scope, key: 'char_113_cqbw', frameKey: 'char_113_cqbw' } });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  assert.deepEqual(h.net.sent.at(-1).frame, { zoom: 0.6, ox: -17, oy: 30 });
  h.net.status = 'offline';
  h.target.set({ values: { ...h.target.get().values, char_113_cqbw: { zoom: 2, ox: 12, oy: -7 } } });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  assert.equal(h.net.sent.length, 2);
  h.net.status = 'online'; h.welcome(); await h.timers.advance(50);
  assert.deepEqual(h.net.sent.at(-1).frame, { zoom: 2, ox: 12, oy: -7 });
  assert.equal(h.target.get().sync, 'synced');
});

test('transient refusals retry the newest framing; unsupported servers keep local preferences', async t => {
  const h = harness(); t.after(h.dispose);
  h.net.failures.push('RATE', 'TIMEOUT', 'OFFLINE'); h.welcome();
  await h.timers.advance(50);
  h.target.set({ values: { custom: { zoom: 2.1, ox: -10, oy: 11 } } });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  await h.timers.advance(RETRY_MS); await h.timers.advance(RETRY_MS);
  assert.deepEqual(h.net.sent.at(-1).frame, { zoom: 2.1, ox: -10, oy: 11 });
  assert.equal(h.target.get().sync, 'synced');
  const legacy = harness(); t.after(legacy.dispose);
  legacy.net.emit('welcome', {}); await legacy.timers.advance(SYNC_DEBOUNCE_MS);
  assert.equal(legacy.net.sent.length, 0);
  assert.deepEqual(legacy.target.get().values.custom, { zoom: 1.8, ox: 23, oy: -19 });
});

test('leaving a room stops sends and a new room receives its own scoped frame', async t => {
  const h = harness(); t.after(h.dispose); h.welcome(); await h.timers.advance(50);
  h.app.set({ room: null });
  h.target.set({ values: { custom: { zoom: 1, ox: 5, oy: 6 } } }); await h.timers.advance(SYNC_DEBOUNCE_MS);
  assert.equal(h.net.sent.length, 1);
  h.app.set({ room: { code: 'EFGH' } });
  h.target.set({ scope: { ...h.target.get().scope, roomCode: 'EFGH' } });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  assert.equal(h.net.sent.at(-1).code, 'EFGH');
  assert.deepEqual(h.net.sent.at(-1).frame, { zoom: 1, ox: 5, oy: 6 });
});
