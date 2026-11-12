// One worker per active request: termination cancels immediately, including synchronous engine work.
export class TrainingClient {
  constructor(factory = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })) {
    this.factory = factory; this.active = null; this.sequence = 0;
  }
  cancel() {
    this.sequence++;
    if (!this.active) return;
    const active = this.active; this.active = null;
    clearTimeout(active.timer); active.worker.terminate();
    active.reject(Object.assign(new Error('TRAINING_CANCELLED'), { name: 'AbortError' }));
  }
  run(compiled, raw, { replay = false, progress = () => {} } = {}) {
    this.cancel();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let worker;
      try { worker = this.factory(); } catch (e) { reject(e); return; }
      const finish = (error, result) => {
        if (this.active?.id !== id) return;
        clearTimeout(this.active.timer); this.active = null; worker.terminate();
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('TRAINING_TIMEOUT')), 90000);
      this.active = { worker, reject, id, timer };
      worker.onmessage = ({ data: msg }) => {
        if (msg?.id !== id || this.active?.id !== id) return;
        if (msg.t === 'progress') progress(msg.value);
        else if (msg.t === 'done') finish(null, msg.result);
        else if (msg.t === 'error') finish(new Error(msg.message));
      };
      worker.onerror = () => finish(new Error('TRAINING_WORKER'));
      worker.onmessageerror = () => finish(new Error('TRAINING_WORKER'));
      try { worker.postMessage({ t: 'run', id, compiled, raw, replay }); } catch (e) { finish(e); }
    });
  }
}

export async function trainingRequest(path, { body, signal } = {}) {
  const response = await fetch(`/api/training/${path}`, { signal, cache: 'no-store',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.code || 'TRAINING_UNAVAILABLE'), value);
  return value;
}

export class TrainingSessionClient {
  constructor(factory = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })) {
    this.worker = factory(); this.seq = 0; this.pending = new Map(); this.stopped = false;
    this.worker.onmessage = ({ data: msg }) => {
      const job = this.pending.get(msg?.id); if (!job) return;
      clearTimeout(job.timer); this.pending.delete(msg.id);
      if (msg.error) job.reject(new Error(msg.error)); else job.resolve(msg.value);
    };
    this.worker.onerror = () => this.stop(new Error('TRAINING_WORKER'));
    this.worker.onmessageerror = () => this.stop(new Error('TRAINING_WORKER'));
  }
  rpc(method, extra = {}) {
    if (this.stopped) return Promise.reject(Object.assign(new Error('TRAINING_CANCELLED'), { name: 'AbortError' }));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop(new Error('TRAINING_TIMEOUT')), method === 'seek' ? 90000 : 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ id, method, ...extra }); } catch (e) { this.stop(e); }
    });
  }
  start(compiled, raw) { return this.rpc('start', { compiled, raw }); }
  step(ticks) { return this.rpc('step', { ticks }); }
  seek(ticks) { return this.rpc('seek', { ticks }); }
  stop(error = Object.assign(new Error('TRAINING_CANCELLED'), { name: 'AbortError' })) {
    if (this.stopped) return;
    this.stopped = true; this.worker.terminate();
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear();
  }
}
