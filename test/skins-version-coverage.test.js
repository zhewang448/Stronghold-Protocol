import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { skinCatalogue, buildSkinPlan } from '../tools/assets/skins.mjs';

const research = JSON.parse(readFileSync(new URL('../docs/research/operator-skins.json', import.meta.url), 'utf8'));
test('shared cosmetics retain first-period operators outside the default roster', () => {
  const all = skinCatalogue(research);
  for (const [id, skin] of [['char_198_blackd', 'char_198_blackd@winter#1'], ['char_2012_typhon', 'char_2012_typhon@summer#17'], ['char_377_gdglow', 'char_377_gdglow@sanrio#1']]) {
    assert.ok(all.chars[id]?.some(row => row.id === skin), skin);
    const plan = buildSkinPlan(research, [skin]);
    assert.ok(plan.template.chars[id].skins[skin].spine.front);
    assert.ok([...plan.models.values()].every(m => m.strict));
  }
  assert.deepEqual(Object.keys(skinCatalogue(research, new Set(['char_498_inside'])).chars), ['char_498_inside']);
});

test('skins-only rebuild emits the shared catalogue without rebuilding gameplay data', t => {
  const out = mkdtempSync(path.join(tmpdir(), 'sp-skin-catalogue-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, ['tools/build-data.mjs', '--skins-only', '--offline', '--out', out], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path.join(out, 'skins.json'), 'utf8')), skinCatalogue(research));
  assert.throws(() => readFileSync(path.join(out, 'chess.json')), { code: 'ENOENT' });
});
