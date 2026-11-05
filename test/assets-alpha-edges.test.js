import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { decodeRgbaPng, encodeRgbaPng, extendAlphaEdges, atlasEdgeRectangles } from '../tools/assets/alpha-edges.mjs';

test('alpha edge correction preserves transparency, opaque line art and neighbouring attachments', () => {
  const skin = [240, 210, 190, 255], ink = [12, 15, 18, 255], darkEdge = [30, 25, 20, 100];
  const data = Uint8Array.from([...skin, ...darkEdge, ...skin, ...ink, ...darkEdge, ...ink]);
  const before = new Uint8Array(data);
  extendAlphaEdges(data, 6, 1, [{ x: 0, y: 0, width: 3, height: 1 }]);
  assert.deepEqual([...data.slice(4, 8)], [240, 210, 190, 100]);
  for (let i = 3; i < data.length; i += 4) assert.equal(data[i], before[i], 'alpha bytes are exact');
  assert.deepEqual(data.slice(12), before.slice(12), 'an unselected attachment is exact');
  assert.deepEqual(data.slice(0, 4), before.slice(0, 4), 'opaque artwork is exact');
});

test('alpha extension leaves soft effects without an opaque neighbour unchanged and rejects invalid rectangles', () => {
  const data = Uint8Array.from([90, 120, 180, 64, 120, 150, 210, 128]), before = new Uint8Array(data);
  assert.equal(extendAlphaEdges(data, 2, 1, [{ x: 0, y: 0, width: 2, height: 1 }]), 0);
  assert.deepEqual(data, before);
  assert.throws(() => extendAlphaEdges(data, 2, 1, [{ x: 1, y: 0, width: 2, height: 1 }]), /outside/);
});

test('atlas edge rectangles use the named page and rotated pixel dimensions', () => {
  const atlas = 'one.png\nsize: 32,32\nface\n  rotate: false\n  xy: 2,3\n  size: 5,7\n\ntwo.png\nsize: 32,32\nface\n  rotate: 270\n  xy: 4,6\n  size: 8,9\n';
  assert.deepEqual(atlasEdgeRectangles(atlas, ['face'], 'one.png'), [{ x: 2, y: 3, width: 5, height: 7 }]);
  assert.deepEqual(atlasEdgeRectangles(atlas, ['face'], 'two.png'), [{ x: 4, y: 6, width: 9, height: 8 }]);
  assert.deepEqual(atlasEdgeRectangles(atlas, ['missing'], 'one.png'), []);
});

const source = new URL('../public/assets/dynamic/char_472_pasngr_epoque_17/dyn_illust_char_472_pasngr_epoque__17.png', import.meta.url);
test('real Passenger texture: PNG round-trip is exact; the corrected copy keeps every alpha and opaque pixel', { skip: !existsSync(source) }, () => {
  const image = decodeRgbaPng(readFileSync(source));
  assert.deepEqual(decodeRgbaPng(encodeRgbaPng(image)).pixels, image.pixels);
  const corrected = decodeRgbaPng(readFileSync(new URL('../public/assets/dynamic/char_472_pasngr_epoque_17/dyn_illust_char_472_pasngr_epoque__17.edges.png', import.meta.url)));
  let changed = 0;
  for (let i = 0; i < image.pixels.length; i += 4) {
    assert.equal(corrected.pixels[i + 3], image.pixels[i + 3]);
    if (image.pixels[i + 3] >= 250) assert.deepEqual(corrected.pixels.subarray(i, i + 4), image.pixels.subarray(i, i + 4));
    if (corrected.pixels[i] !== image.pixels[i] || corrected.pixels[i + 1] !== image.pixels[i + 1] || corrected.pixels[i + 2] !== image.pixels[i + 2]) changed++;
  }
  assert.ok(changed > 0 && changed < 5000, 'correction is limited to verified face edges');
});
