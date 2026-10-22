import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipUnpackedSize, readZip } from '../server/release-zip.js';
import { storedZip } from './helpers/release-fixture.js';

test('ZIP staging preflight totals expanded entries without writing them', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-zip-size-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const zip = path.join(root, 'test.zip'); fs.writeFileSync(zip, storedZip([['a.txt', 'abc'], ['dir/b.txt', Buffer.alloc(1024)]]));
  const before = fs.readdirSync(root);
  assert.equal(zipUnpackedSize(zip), 1027);
  const got = []; readZip(zip, (name, body) => got.push([name, body.length]));
  assert.deepEqual(got, [['a.txt', 3], ['dir/b.txt', 1024]]); assert.deepEqual(fs.readdirSync(root), before);
});

test('ZIP staging preflight rejects damaged central directories', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-zip-damage-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const zip = path.join(root, 'bad.zip'); fs.writeFileSync(zip, 'not a zip');
  assert.throws(() => zipUnpackedSize(zip), /zip/i);
});
