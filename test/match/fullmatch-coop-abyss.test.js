// Same real-simulation coverage and seed range as the former ABYSS case in fullmatch-coop.test.js.
import { test, after } from 'node:test';
import { SEEDS, runFull, reportSimIssues } from './fullmatchRun.js';

after(reportSimIssues);

test('co-op 1 human(s) + 3 AI (ABYSS): ' + SEEDS + ' seeds to RESULT with zero errors', () => {
  for (let seed = 1; seed <= SEEDS; seed++) runFull({ mode: 'coop', difficulty: 'ABYSS', humans: 1, bots: 3, seed: 100 + seed });
});
