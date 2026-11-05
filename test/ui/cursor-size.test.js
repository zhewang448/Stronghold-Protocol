import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURSOR_SIZES, DEFAULT_CURSOR_SIZE, normalizeCursorSize, cursorHotspot } from '../../shared/cursor.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { normalizeClientPreferencePolicy } from '../../shared/clientPreferences.js';
import { cursorPng } from '../../tools/install-cursors.mjs';
import { encodeRgbaPng, decodeRgbaPng } from '../../tools/assets/alpha-edges.mjs';
import { crc32 } from '../../server/plugins/zip.js';

function sourceImage() {
  const header = Buffer.alloc(25); header.writeUInt32BE(13); header.write('IHDR', 4);
  header.writeUInt32BE(96, 8); header.writeUInt32BE(96, 12); header[16] = 8; header[17] = 6;
  header.writeUInt32BE(crc32(header.subarray(4, -4)) >>> 0, 21);
  const end = Buffer.from('0000000049454e44ae426082', 'hex'), pixels = Buffer.alloc(96 * 96 * 4);
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
    const i = (y * 96 + x) * 4;
    pixels[i] = 255; // invisible red must never tint the resized opaque white edge
    if (x === 0) pixels.fill(255, i, i + 4);
  }
  return encodeRgbaPng({ width: 96, height: 96, pixels, chunks: [{ type: 'IHDR', bytes: header }, { type: 'IDAT', bytes: Buffer.alloc(0) }, { type: 'IEND', bytes: end }] });
}
test('old saved themes adopt 96 px; allowed sizes persist and policy rejects unsupported dimensions', () => {
  assert.equal(DEFAULT_CURSOR_SIZE, 96); assert.equal(DEFAULT_SETTINGS.cursorSize, 96);
  assert.equal(sanitizeSettings({ cursorTheme: 'arknights' }).cursorSize, 96);
  for (const size of CURSOR_SIZES) {
    assert.equal(sanitizeSettings({ cursorSize: size }).cursorSize, size);
    assert.equal(normalizeClientPreferencePolicy({ defaults: { 'settings.cursorSize': size } }).error, undefined);
  }
  for (const value of [null, '128', 0, 33, 256, NaN, true]) {
    assert.equal(normalizeCursorSize(value), 96);
    assert.ok(normalizeClientPreferencePolicy({ defaults: { 'settings.cursorSize': value } }).error);
  }
  assert.deepEqual(cursorHotspot(32), [9, 7]); assert.deepEqual(cursorHotspot(96), [28, 20]);
  assert.deepEqual(cursorHotspot(128), [37, 27]); assert.deepEqual(cursorHotspot(128, 'text'), [64, 64]);
  for (const size of CURSOR_SIZES) {
    const normal = cursorHotspot(size), grab = cursorHotspot(size, 'grab'), gripping = cursorHotspot(size, 'grabbing');
    assert.deepEqual(grab, gripping, `${size}: hover and drag keep the same visual anchor`);
    assert.equal(grab[0], normal[0], `${size}: horizontal position stays fixed`);
    assert.ok(grab[1] > normal[1] && grab[1] < size, `${size}: claw moves up within the image bounds`);
  }
  assert.deepEqual(cursorHotspot(96, 'grabbing'), [28, 68]);
  assert.deepEqual(cursorHotspot(128, 'grabbing'), [37, 91]);
});
test('real-size output preserves the master and resampling does not bleed hidden RGB into alpha edges', () => {
  const bytes = sourceImage(); assert.equal(cursorPng(bytes), bytes);
  for (const size of CURSOR_SIZES) {
    const image = decodeRgbaPng(cursorPng(bytes, size));
    assert.equal(image.width, size); assert.equal(image.height, size);
    assert.deepEqual([...image.pixels.subarray(0, 3)], [255, 255, 255], `${size}: edge stays white`);
  }
  assert.deepEqual([...decodeRgbaPng(cursorPng(bytes, 32)).pixels.subarray(0, 4)], [255, 255, 255, 85]);
  assert.throws(() => cursorPng(bytes, 144), /Unsupported/);
});
