import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOM = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
const ACCOUNT = readFileSync(path.join(ROOT, 'public/js/ui/accounts.js'), 'utf8');

test('avatar crop geometry keeps a square source window and responds to zoom/offset', async () => {
  const { avatarCropRect } = await import(pathToFileURL(path.join(ROOT, 'public/js/ui/accounts.js')).href);
  const centered = avatarCropRect({ width: 1600, height: 900 });
  assert.equal(centered.size, 900);
  assert.equal(centered.x, 350);
  assert.equal(centered.y, 0);
  const zoomed = avatarCropRect({ width: 1600, height: 900, zoom: 2 });
  assert.equal(zoomed.size, 450);
  assert.ok(zoomed.x > centered.x);
  const moved = avatarCropRect({ width: 1600, height: 900, offsetX: 40 });
  assert.ok(moved.x < centered.x, 'dragging right moves the source window left');
});

test('issue #21 uses an interactive crop and accessible bond tooltip', () => {
  assert.match(ACCOUNT, /data-testid='avatar-crop'/);
  assert.match(ACCOUNT, /onPointerMove=\$\{pointerMove\}/);
  assert.match(ACCOUNT, /data-testid='avatar-crop-zoom'/);
  assert.match(ACCOUNT, /ArrowLeft.*ArrowRight.*ArrowUp.*ArrowDown/s);
  assert.match(ROOM, /data\.lookup\('bonds', bondId\)/);
  assert.match(ROOM, /bond\.effectDescRaw \|\| bond\.effectDesc/);
  assert.match(ROOM, /<\$\{Tooltip\} text=\$\{bondTip\.text\} aside=\$\{bondTip\.aside\} tap=\$\{true\}/);
  assert.match(ROOM, /room\.seatAvatars === true \? \(seat\.isBot \? undefined : seatAccount\?\.avatar \|\| undefined\)/);
});
