import { loadBrowserSim } from '../battle/simLoader.js';
import { simulateTraining } from './simulation.js';
import { TrainingSimulation } from './session.js';

let session, queue = Promise.resolve();
async function dispatch(msg) {
  if (msg.method === 'start') {
    session?.stop();
    const raw = { ...msg.raw };
    for (const [file, records] of Object.entries(msg.compiled.extraData || {})) raw[file] = { ...raw[file], ...records };
    const sim = await loadBrowserSim({ data: raw, cs: msg.compiled.cs });
    session = new TrainingSimulation(msg.compiled, sim);
    return session.packet([], true);
  }
  if (!session) throw new Error('TRAINING_NOT_STARTED');
  if (msg.method === 'step') return session.step(msg.ticks);
  if (msg.method === 'seek') return session.seek(msg.ticks);
  if (msg.method === 'pause') return session.packet();
  throw new Error('TRAINING_COMMAND');
}

self.onmessage = async ({ data: msg }) => {
  if (msg?.method) {
    queue = queue.then(async () => {
      try { self.postMessage({ id: msg.id, value: await dispatch(msg) }); }
      catch (e) { self.postMessage({ id: msg.id, error: String(e.message || e) }); }
    });
    return;
  }
  if (msg?.t !== 'run') return;
  try {
    const raw = { ...msg.raw };
    for (const [file, records] of Object.entries(msg.compiled.extraData || {})) raw[file] = { ...raw[file], ...records };
    const sim = await loadBrowserSim({ data: raw, cs: msg.compiled.cs });
    const result = await simulateTraining(msg.compiled, sim, { replay: !!msg.replay,
      progress: value => self.postMessage({ t: 'progress', id: msg.id, value }) });
    self.postMessage({ t: 'done', id: msg.id, result });
  } catch (error) { self.postMessage({ t: 'error', id: msg.id, message: String(error?.message || error) }); }
};
