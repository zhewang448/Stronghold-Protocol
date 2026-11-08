// Same real-simulation coverage and seed range as the former HARD case in fullmatch-coop.test.js.
import { test, after } from 'node:test';
import { SEEDS, runFull, reportSimIssues } from './fullmatchRun.js';

after(reportSimIssues);

test('co-op 2 human(s) + 1 AI (HARD): ' + SEEDS + ' seeds to RESULT with zero errors', () => {
  for (let seed = 1; seed <= SEEDS; seed++) runFull({ mode: 'coop', difficulty: 'HARD', humans: 2, bots: 1, seed: 100 + seed });
});
