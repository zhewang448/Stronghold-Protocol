// Full/delta extraction and target-file hashing run off the live server's event loop.
import { parentPort, workerData } from 'node:worker_threads';
import { inspectUpdateZip, stageUpdateZip, stageZip } from './release-update.js';
import { finishSplitStage, neededAssetGroups, parseSplitIndex, stageAssetGroup } from './release-split.js';

const { zip, stage, tag, root, incremental = false, inspect = false, splitGroup, splitIndex, planSplit = false, finishSplit = false, options = {} } = workerData;
if (inspect) parentPort.postMessage(inspectUpdateZip(zip, tag));
else if (planSplit) parentPort.postMessage(neededAssetGroups(root, parseSplitIndex(splitIndex, tag), stage));
else if (splitGroup) {
  stageAssetGroup(zip, root, stage, parseSplitIndex(splitIndex, tag), splitGroup);
  parentPort.postMessage({ ok: true });
} else if (finishSplit) {
  finishSplitStage(root, stage, parseSplitIndex(splitIndex, tag));
  parentPort.postMessage({ ok: true });
}
else {
  const manifest = incremental ? stageUpdateZip(zip, stage, tag, root, options) : stageZip(zip, stage, tag, { root, ...options });
  parentPort.postMessage({ app: manifest.app });
}
