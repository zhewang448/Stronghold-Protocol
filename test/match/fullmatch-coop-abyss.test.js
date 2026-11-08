// ABYSS seeds are partitioned across four files. Together they retain the original 101..100+SEEDS range.
import { test, after } from 'node:test';
import { SEEDS, runFull, reportSimIssues } from './fullmatchRun.js';

after(reportSimIssues);

test('co-op 1 human(s) + 3 AI (ABYSS): seed partition 1/4 to RESULT with zero errors', () => {
  for (let seed = 1; seed <= SEEDS; seed += 4) runFull({ mode: 'coop', difficulty: 'ABYSS', humans: 1, bots: 3, seed: 100 + seed });
});
