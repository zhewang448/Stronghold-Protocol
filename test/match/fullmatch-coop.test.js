// Full NORMAL co-op matches with the REAL simulation. HARD/ABYSS keep their full seed ranges in separate files
// so the upgraded AI's aggregate runtime does not exceed the unchanged per-file CI timeout.
import { test, after } from 'node:test';
import { SEEDS, runFull, reportSimIssues } from './fullmatchRun.js';

after(reportSimIssues);

for (const [humans, bots, difficulty] of [[1, 1, 'NORMAL']]) {
  test(`co-op ${humans} human(s) + ${bots} AI (${difficulty}): ${SEEDS} seeds to RESULT with zero errors`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) runFull({ mode: 'coop', difficulty, humans, bots, seed: 100 + seed });
  });
}
