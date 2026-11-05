import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packPages } from '../../public/js/ui/dynamicStage.js';
import { pixelSize, dynamicFps, framingLayout, rectLayout, dynamicOf, dynamicIdentity } from '../../public/js/ui/dynamicFraming.js';
import { sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';

test('dynamic page packing downsamples an oversized view without changing its aspect ratio', () => {
  const pages = packPages([{ w: 8192, h: 4096 }, ...Array.from({ length: 40 }, () => ({ w: 210, h: 350 }))], 2048);
  const cells = pages.flatMap(p => p.cells);
  assert.equal(cells.length, 41);
  assert.deepEqual([cells[0].w, cells[0].h], [2048, 1024]);
  for (const p of pages) for (const c of p.cells) assert.ok(c.x + c.w <= 2048 && c.y + c.h <= 2048);
});
test('dynamic display budgets honor lower FPS, coarse input, DPR and large aspect ratios', () => {
  assert.equal(dynamicFps(0, false), 30); assert.equal(dynamicFps(0, true), 24);
  assert.equal(dynamicFps(15, true), 15); assert.equal(dynamicFps(60, false), 30);
  assert.deepEqual(pixelSize(300, 200, 3), { w: 450, h: 300 });
  assert.deepEqual(pixelSize(10000, 5000, 3), { w: 4096, h: 2048 });
});
test('static crop and live framing use the same center, translation and zoom', () => {
  const b = { x: -70, y: 20, width: 180, height: 360 }, l = rectLayout(210, 350, b, 50, 0);
  const f = framingLayout(210, 350, b, { rect: b, posY: 0, zoom: 1.5, ox: 10, oy: -15 });
  assert.equal(f.scale, l.scale * 1.5);
  assert.equal(f.x, 105 + (l.x - 105) * 1.5 + 21);
  assert.equal(f.y, 175 + (l.y - 175) * 1.5 - 52.5);
});
test('dynamic identity changes on texture/appearance overlays, and a skin never uses another skin', () => {
  const d = { skel: '/x.skel', atlas: '/x.atlas', textures: ['/x.png'] };
  const m = { chars: { c: { dynamic: d, skins: { s: { portrait: '/s.png' } } } } };
  assert.equal(dynamicOf(m, 'c'), d); assert.equal(dynamicOf(m, 'c', 's'), null);
  assert.notEqual(dynamicIdentity(d), dynamicIdentity({ ...d, textures: ['/new.png'] }));
  m.chars.c.dynamic = { ...d, staticArt: { portrait: '/original.png' } };
  m.chars.c.portrait = '/plugin.png';
  assert.equal(dynamicOf(m, 'c'), null, 'a picture-only plugin keeps its own portrait');
});
test('dynamic preference preserves explicit old and new off values', () => {
  for (const raw of [{ dynamicIllustrations: false }, { dynamicIllustrations: 'static' }, { dynamicIllust: false }, { dynamicIllustration: false }]) assert.equal(sanitizeSettings(raw).dynamicIllustrations, 'static');
  assert.equal(sanitizeSettings(null).dynamicIllustrations, 'auto');
  assert.equal(sanitizeSettings({ dynamicIllustrations: 'auto', dynamicIllust: false }).dynamicIllustrations, 'auto', 'the saved current field wins over a stale alias');
});
