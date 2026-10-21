// Full/delta extraction and target-file hashing run off the live server's event loop.
import { parentPort, workerData } from 'node:worker_threads';
import { stageUpdateZip, stageZip } from './release-update.js';

const { zip, stage, tag, root, incremental = false } = workerData;
const manifest = incremental ? stageUpdateZip(zip, stage, tag, root) : stageZip(zip, stage, tag, { root });
parentPort.postMessage({ app: manifest.app });
