import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOM = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
const ACCOUNT = readFileSync(path.join(ROOT, 'public/js/ui/accounts.js'), 'utf8');

test('local picture presets bound each image and decode avatar bytes without a data URL network request', async () => {
  const { PICTURE_PRESET_SLOTS, pictureBlobFromDataUrl, validPicturePreset, savePicturePreset } = await import('../../public/js/ui/picturePresets.js');
  assert.equal(PICTURE_PRESET_SLOTS, 3);
  const blob = pictureBlobFromDataUrl('data:image/jpeg;base64,AQIDBA==');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 4]);
  assert.equal(validPicturePreset({ blob }, 'avatar'), true);
  assert.equal(validPicturePreset({ blob }, 'unknown'), false);
  assert.equal(validPicturePreset({ blob: new Blob([new Uint8Array(32769)], { type: 'image/jpeg' }) }, 'avatar'), false);
  assert.equal(validPicturePreset({ blob: new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/webp' }) }, 'illust'), false);
  assert.equal(validPicturePreset({ blob: new Blob(['text'], { type: 'text/html' }) }, 'illust'), false);
  assert.throws(() => pictureBlobFromDataUrl('https://example.invalid/picture.jpg'), /Invalid/);
  await assert.rejects(savePicturePreset('local-test', 'avatar', 3, { blob }), /Invalid picture preset key/);
});

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

test('shared avatar cache survives a room-to-match code transition and honors removal', async () => {
  const { store } = await import('../../public/js/store.js');
  const { accountOf } = await import('../../public/js/ui/accounts.js');
  const avatar = 'data:image/jpeg;base64,/9j/AA==';
  try {
    store.set({ me: { playerId: 'self' }, room: { code: 'ROOM' },
      roomAvatars: { code: 'ROOM', avatars: { peer: avatar } }, avatarCache: { peer: avatar } });
    assert.equal(accountOf('peer')?.avatar, avatar);
    store.set({ room: { code: 'MATCH', inMatch: true }, roomAvatars: null });
    assert.equal(accountOf('peer')?.avatar, avatar);
    store.set({ avatarCache: {} });
    assert.equal(accountOf('peer'), null);
  } finally { store.reset(); }
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
