import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dynamicOf, cropFraming } from '../../public/js/ui/dynamicFraming.js';

const registry = JSON.parse(readFileSync(new URL('../../docs/research/dynamic-illustrations.json', import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL('../../data/assets.json', import.meta.url)));
const catalogue = JSON.parse(readFileSync(new URL('../../data/skins.json', import.meta.url)));

test('elite avatars use their elite illustration while explicit ordinary seat art stays static', () => {
  const elite = { skel: '/elite.skel', atlas: '/elite.atlas', frames: { avatar: { x: 0, y: 0, width: 1, height: 1 } },
    staticArt: { avatarE2: '/elite-avatar.png', portraitE2: '/elite-portrait.png' } };
  const m = { chars: { char_x: { avatar: '/ordinary.png', avatarE2: '/elite-avatar.png', portraitE2: '/elite-portrait.png', dynamicE2: elite } } };
  assert.equal(dynamicOf(m, 'char_x', null, 'avatar', true), elite);
  assert.equal(dynamicOf(m, 'char_x', 'char_x#2', 'avatar'), elite);
  assert.equal(dynamicOf(m, 'char_x', 'char_x#1', 'portrait'), null);
  assert.equal(dynamicOf(m, 'char_x', null, 'avatar', false), null);
  assert.equal(dynamicOf(m, 'char_x', null, 'avatar', true, '/ordinary.png'), null, 'ordinary pixels keep their own identity');
});

test('every registered elite original has an installed portrait and avatar crop', () => {
  const originals = Object.entries(registry.skins).filter(([, row]) => row.field === 'dynamicE2');
  assert.ok(originals.length >= 27);
  for (const [id, row] of originals) {
    const entry = manifest.chars[row.charId]?.dynamicE2;
    assert.ok(cropFraming(entry, 'portrait'), id + ' portrait');
    assert.ok(cropFraming(entry, 'avatar'), id + ' avatar');
    assert.equal(dynamicOf(manifest, row.charId, id, 'avatar'), entry, id + ' elite avatar');
  }
});

test('official dynamic outfits are present in both the selectable and installed catalogues', () => {
  assert.deepEqual(registry.official.outsideCatalogue, []);
  for (const [id, row] of Object.entries(registry.skins)) {
    if (row.field) continue;
    assert.ok(catalogue.chars[row.charId]?.some(skin => skin.id === id), id + ' selectable');
    const skin = manifest.chars[row.charId]?.skins?.[id];
    assert.ok(skin?.dynamic, id + ' installed');
    assert.ok(cropFraming(skin.dynamic, 'portrait'), id + ' portrait crop');
    assert.ok(cropFraming(skin.dynamic, 'avatar'), id + ' avatar crop');
  }
});
