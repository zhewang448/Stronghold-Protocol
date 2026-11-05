import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetReferences } from '../tools/assets/manifest.mjs';
import { orphanFiles } from '../tools/fetch-assets.mjs';
import { buildPlan } from '../tools/assets/plan.mjs';
import { indexAudio } from '../tools/assets/audio.mjs';

test('final merged manifest protects every dynamic source, derivative, layer and atlas page from prune', () => {
  const model = { skel: '/assets/dynamic/a.json', atlas: '/assets/dynamic/a.edges.atlas', textures: ['/assets/dynamic/page.edges.png', '/assets/dynamic/page2.png'],
    background: '/assets/dynamic/bg.png', foreground: '/assets/dynamic/fg.png', installationFiles: ['/assets/dynamic/a.source.atlas', '/assets/dynamic/page.png'] };
  const merged = { chars: { a: { dynamicE2: model, skins: { s: { dynamic: model, illust: '/assets/dynamic/still.png' } } } } };
  const used = assetReferences(merged), onDisk = [...used, 'dynamic/unused.png', 'local/fx/prefabs/keep.json'];
  assert.deepEqual(orphanFiles(onDisk, used), ['dynamic/unused.png']);
  assert.equal(used.size, 9);
});

test('the regular three-operator resource plan includes both full-size illustration phases', () => {
  const extraOperators = Object.fromEntries(['char_4247_oxi', 'char_4246_dminon', 'char_4244_tocka'].map(id => [id, {}]));
  const p = buildPlan({ assets07: {}, ops03: {}, enemies05: {}, maps05: {}, audio: indexAudio({}), modelsData: {}, extraOperators });
  for (const id of Object.keys(extraOperators)) for (const [field, phase] of [['illust', 1], ['illustE2', 2]]) {
    const file = p.template.chars[id][field].alts[0];
    assert.equal(file.rel, `char/illust/${id}_${phase}.png`);
    assert.match(file.urls[0], /^https:\/\/media\.prts\.wiki\//);
  }
});
