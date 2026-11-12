import { sendJson } from './common.js';
import { trainingOptions, buildTraining } from '../training.js';
import { SCENARIO_BYTES } from '../../shared/studio/scenario.js';

/** Public, read-only scenario compilation. Simulation stays on the caller's machine. */
export async function handleTraining(req, res, path, query, versions) {
  if (!path.startsWith('/api/training/')) return false;
  try {
    if (!versions) { sendJson(req, res, 503, { code: 'TRAINING_UNAVAILABLE' }); return true; }
    if (path === '/api/training/options' && (req.method === 'GET' || req.method === 'HEAD')) {
      sendJson(req, res, 200, trainingOptions(versions, new URLSearchParams(query).get('version')));
      return true;
    }
    if (path === '/api/training/build' && req.method === 'POST') {
      if (Number(req.headers['content-length']) > SCENARIO_BYTES) { sendJson(req, res, 413, { code: 'TRAINING_SIZE' }); return true; }
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > SCENARIO_BYTES) { sendJson(req, res, 413, { code: 'TRAINING_SIZE' }); return true; }
        chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { sendJson(req, res, 400, { code: 'TRAINING_INPUT', path: 'json', reason: 'json' }); return true; }
      sendJson(req, res, 200, buildTraining(payload?.document, payload?.side, versions));
      return true;
    }
    res.setHeader('Allow', path.endsWith('/build') ? 'POST' : 'GET, HEAD');
    sendJson(req, res, 405, { code: 'TRAINING_METHOD' });
  } catch (error) {
    const params = error.params || {};
    if (error.path || params.path) sendJson(req, res, 400, { code: 'TRAINING_INPUT', path: error.path || params.path, reason: error.reason || params.reason || 'value' });
    else throw error;
  }
  return true;
}
