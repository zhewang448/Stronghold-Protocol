import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIllustStore } from '../server/http/illustStore.js';
import { readImageInfo } from '../server/http/imageInfo.js';
import { ILLUST_MAX_BYTES, illustrationCropRect } from '../shared/illustration.js';
import { png } from './helpers/pluginFixtures.js';

test('illustration import keeps a 1:2 source crop, pans toward the drag and never reveals outside pixels', () => {
  const centered = illustrationCropRect({ width: 4000, height: 6000 });
  assert.deepEqual({ x: centered.x, y: centered.y, width: centered.width, height: centered.height }, { x: 500, y: 0, width: 3000, height: 6000 });
  const zoomed = illustrationCropRect({ width: 4000, height: 6000, zoom: 2, ox: 60, oy: 20 });
  assert.equal(zoomed.width, 1500); assert.equal(zoomed.height, 3000);
  assert.equal(zoomed.x, 350); assert.equal(zoomed.y, 900);
  for (const source of [{ width: 3000, height: 1000 }, { width: 1000, height: 3000 }, { width: 64, height: 64 }]) {
    for (const sign of [-1, 1]) {
      const rect = illustrationCropRect({ ...source, zoom: 3, ox: sign * 1e6, oy: sign * 1e6 });
      assert.equal(rect.height / rect.width, 2);
      assert.ok(rect.x >= 0 && rect.y >= 0);
      assert.ok(rect.x + rect.width <= source.width + 1e-9 && rect.y + rect.height <= source.height + 1e-9);
    }
  }
});

test('illustration store validates containers, bounds, rate, total capacity and atomic persistence', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-illust-'));
  testContext.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = 10000;
  const bytes = png(128, 256), playerId = 'p_0123456789';
  assert.deepEqual(readImageInfo(bytes), { type: 'image/png', width: 128, height: 256 });
  assert.equal(readImageInfo(Buffer.from('<svg></svg>')), null);
  const store = createIllustStore({ dir: directory, now: () => now });
  for (const [picture, error] of [[Buffer.from('text'), 'BAD_TYPE'], [png(16, 32), 'BAD_DIMENSIONS'],
    [png(64, 300), 'BAD_DIMENSIONS'], [Buffer.alloc(ILLUST_MAX_BYTES + 1), 'TOO_LARGE']]) {
    assert.equal((await store.put(playerId, picture)).error, error);
  }
  assert.equal((await store.put('../escape', bytes)).error, 'BAD_ID');
  const result = await store.put(playerId, bytes);
  assert.equal(result.ok, true); assert.equal(result.entry.width, 128); assert.equal(result.entry.height, 256);
  assert.deepEqual(fs.readFileSync(path.join(directory, playerId + '.png')), bytes);
  assert.equal((await store.put(playerId, bytes)).error, 'RATE');
  now += 2000;
  const changed = png(128, 256, [20, 40, 80, 255]);
  assert.equal((await store.put(playerId, changed)).ok, true);
  assert.notEqual(store.get(playerId).etag, result.entry.etag);
  assert.equal(createIllustStore({ dir: directory }).get(playerId).etag, store.get(playerId).etag);
  assert.equal((await store.remove(playerId)).ok, true); assert.equal(store.get(playerId), null);
  assert.equal(fs.existsSync(path.join(directory, playerId + '.png')), false);
  const limited = createIllustStore({ dir: directory, minIntervalMs: 0, maxTotalBytes: bytes.length });
  const results = await Promise.all([limited.put(playerId, bytes), limited.put('p_1234567890', bytes)]);
  assert.equal(results.filter(entry => entry.ok).length, 1);
  assert.equal(results.filter(entry => entry.error === 'STORAGE_FULL').length, 1);
  assert.equal(limited.bytes, bytes.length);
});
