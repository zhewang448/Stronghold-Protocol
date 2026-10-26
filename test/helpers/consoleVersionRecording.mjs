// Record real battles with the same isolated data bootstrap as a version match host.
import fs from 'node:fs';
import { getVersionData, setData } from '../../server/data.js';
import { installOfficialBounds, officialBoundsOf } from '../../shared/plugins/officialBounds.js';
const [version, cs, identity, out] = process.argv.slice(2);
if (!out) process.exit(0);
const data = setData(getVersionData(version, { log: { info() {}, warn() {}, error() {} } }));
installOfficialBounds(officialBoundsOf(data));
const { makeMatch } = await import('../match/harness.js');
const { setReplayConfig, replayRecord } = await import('../../server/match/replay.js');
setReplayConfig({ enabled: true, identity });
const h = makeMatch({ data, humans: 1, bots: 3, cs, seed: 4242, clientCombat: true, captureFrames: false });
h.m.version = version === 'act2autochess' ? null : version;
try {
  h.start().toPrep(3);
  const replay = replayRecord(h.m, { room: 'TEST', savedAt: Date.now() });
  fs.writeFileSync(out, JSON.stringify(replay));
  console.log(JSON.stringify({ version, errors: h.m.errorCount, fields: Object.fromEntries(['normal','unite','boss','hidden'].map(kind => [kind, replay.rounds.flatMap(r => r.fields).filter(f => f.kind === kind).length])) }));
} finally { h.m.dispose(); }
