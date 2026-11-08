// Third exact partition of the original ABYSS seed range; no seed or assertion is omitted.
import { test, after } from 'node:test';
import { SEEDS, runFull, reportSimIssues } from './fullmatchRun.js';

after(reportSimIssues);

test('co-op 1 human(s) + 3 AI (ABYSS): seed partition 3/4 to RESULT with zero errors', () => {
  for (let seed = 3; seed <= SEEDS; seed += 4) runFull({ mode: 'coop', difficulty: 'ABYSS', humans: 1, bots: 3, seed: 100 + seed });
});
