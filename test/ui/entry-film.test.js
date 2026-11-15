import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdBgm } from '../../public/js/ui/entryFilm.js';

class Music {
  ctx = {};
  bgmSilent = false;
  lobbyTrack = null;
  bgmToken = 0;
  lastBgmKey = 'lobby';
  played = [];
  faded = 0;
  playBgm(key) { this.played.push(key); }
  _fadeOutBgm() { this.faded++; }
}

test('opening hands music to the latest requested screen exactly once', () => {
  const music = new Music();
  const release = holdBgm(music);
  music.playBgm('battle');
  assert.deepEqual(music.played, []);
  assert.equal(music.faded, 1);
  release();
  release();
  assert.deepEqual(music.played, ['battle']);
  assert.equal(Object.hasOwn(music, 'playBgm'), false);
});

test('opening leaves a muted or custom lobby track alone', () => {
  for (const override of [{ bgmSilent: true }, { lobbyTrack: { url: 'blob:own-music' } }]) {
    const music = Object.assign(new Music(), override);
    assert.equal(holdBgm(music), null);
    assert.equal(music.faded, 0);
    assert.equal(Object.hasOwn(music, 'playBgm'), false);
  }
});

test('custom music arriving during opening starts immediately and is not restarted', () => {
  const music = new Music();
  const release = holdBgm(music);
  music.lobbyTrack = { url: 'blob:own-music' };
  music.playBgm('lobby');
  release();
  assert.deepEqual(music.played, ['lobby']);
});
