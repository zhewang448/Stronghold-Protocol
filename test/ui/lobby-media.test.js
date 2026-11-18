// Lobby audio decoding, buffer budget, and the CSP used by custom backgrounds.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { AudioManager, LOCAL_BGM } = await import('../../public/js/audio.js');
const { mediaUrl } = await import('../../public/js/media.js');
const { siteCsp } = await import('../../server/http/csp.js');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8').replace(/\r\n/g, '\n'));
const MB = 1024 * 1024;
// ---- the audio manager with a fake Web Audio ---------------------------------------------------------------------------
/** `bufFor(ab)`: the AudioBuffer a decode makes (default 10 frames); `hold(ab)`: a decode to finish later (made.release). */
function fakeWindow({ decodeFails = () => false, bufFor = () => ({ duration: 2, length: 10, numberOfChannels: 2 }), hold = () => false } = {}) {
  const made = { started: 0, decoded: [], held: [] };
  made.release = () => { for (const fn of made.held.splice(0)) fn(); };
  class Param { constructor() { this.value = 1; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
  class Node { connect() {} disconnect() {} }
  class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
  class Src extends Node { constructor() { super(); this.playbackRate = new Param(); } start() { made.started++; } stop() {} }
  class Ctx {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = new Node(); }
    createGain() { return new Gain(); }
    createBufferSource() { return new Src(); }
    decodeAudioData(ab, ok, bad) {
      made.decoded.push(ab.byteLength);
      const finish = () => { if (decodeFails(ab)) bad(new Error('codec')); else ok(bufFor(ab)); };
      if (hold(ab)) made.held.push(finish); else finish();
    }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  const listeners = new Map();
  return {
    made,
    win: { AudioContext: Ctx, document: { hidden: false, addEventListener() {} }, addEventListener(t, fn) { listeners.set(t, fn); }, removeEventListener(t) { listeners.delete(t); } },
    fire(t) { listeners.get(t)?.(); },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 15));

describe('the player\'s own lobby music (audio.js setLobbyTrack)', () => {
  test('plays from its bytes for the lobby key only; off → the manifest\'s track', async () => {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new ArrayBuffer(8) }; };
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.install();
      fw.fire('pointerdown');
      let reads = 0;
      a.setLobbyTrack({ id: '42', read: async () => { reads++; return new ArrayBuffer(1234); } });
      a.playBgm('lobby');
      await tick();
      assert.equal(a.bgm?.loopUrl, `${LOCAL_BGM}42`);
      assert.equal(reads, 1);
      assert.ok(fw.made.decoded.includes(1234), 'decoded from the bytes');
      const lobby = manifest.audio.bgm.lobby;
      assert.ok(!urls.some((u) => u === mediaUrl(lobby.loop) || u === lobby.loop), 'the official lobby track is not fetched');
      assert.ok(!urls.some((u) => String(u).startsWith(LOCAL_BGM)), 'the own track is never a request');
      // another screen's music is the manifest's
      a.playBgm('prep');
      await tick();
      assert.equal(a.bgm?.loopUrl, manifest.audio.bgm.prep.loop);
      // back in the lobby: the cached own track, not read again
      a.playBgm('lobby');
      await tick();
      assert.equal(a.bgm?.loopUrl, `${LOCAL_BGM}42`);
      assert.equal(reads, 1);
      // switched off: the screen's track changes at once to the official one
      a.setLobbyTrack(null);
      await tick();
      assert.equal(a.bgm?.loopUrl, lobby.loop);
      // a new file: a new id, read again
      a.setLobbyTrack({ id: '43', read: async () => { reads++; return new ArrayBuffer(99); } });
      await tick();
      assert.equal(a.bgm?.loopUrl, `${LOCAL_BGM}43`);
      assert.equal(reads, 2);
      assert.ok(!a.buffers.has(`${LOCAL_BGM}42`), 'the old file\'s buffer is dropped');
    } finally { globalThis.fetch = origFetch; }
  });
  test('silent while muted (nothing read); a file that will not decode → the official track and onLobbyTrackFailed', async () => {
    const fw = fakeWindow({ decodeFails: (ab) => ab.byteLength === 7 });
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new ArrayBuffer(8) });
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.install();
      fw.fire('pointerdown');
      let reads = 0;
      a.setVolumes({ muted: true });
      a.setLobbyTrack({ id: 'm', read: async () => { reads++; return new ArrayBuffer(5); } });
      a.playBgm('lobby');
      await tick();
      assert.equal(reads, 0, 'muted: the file is not even read');
      a.setVolumes({ muted: false });
      await tick();
      assert.equal(a.bgm?.loopUrl, `${LOCAL_BGM}m`);
      let failed = 0;
      a.onLobbyTrackFailed = () => { failed++; };
      a.setLobbyTrack({ id: 'bad', read: async () => new ArrayBuffer(7) });
      await tick();
      assert.equal(failed, 1);
      assert.equal(a.lobbyTrack, null);
      assert.equal(a.bgm?.loopUrl, manifest.audio.bgm.lobby.loop, 'the official track plays instead');
    } finally { globalThis.fetch = origFetch; }
  });
});

// ---- the buffer cache around the own track (#814 review) --------------------------------------------------------------
const SMALL = { duration: 2, length: 10, numberOfChannels: 2 };
/** A fake AudioBuffer holding `mib` MiB of PCM (stereo float32). */
const pcm = (mib) => ({ duration: 200, length: Math.round((mib * MB) / 8), numberOfChannels: 2 });
const bytesOf = (a) => [...a.bufBytes.values()].reduce((x, y) => x + y, 0);
/** fetch answering every URL with audio bytes of `sizeOf(url)` (default 8). */
function stubFetch(sizeOf = () => 8) {
  const orig = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(u); return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new ArrayBuffer(sizeOf(u)) }; };
  return { urls, restore: () => { globalThis.fetch = orig; } };
}
const unlocked = (fw) => {
  const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
  a.install();
  fw.fire('pointerdown');
  return a;
};
const SFX = ['/assets/audio/sfx/t1.mp3', '/assets/audio/sfx/t2.mp3', '/assets/audio/sfx/t3.mp3'];

describe('the buffer cache around the own track (audio.js _buffer / _trimBuffers)', () => {
  test('an own track switched off, deleted or replaced while its file is read or decoded records nothing: the budget never leaks', async () => {
    // 9001 / 9003 bytes decode to 88 MiB of PCM (a 4 min song), over the whole 64 MiB budget; 9003 decodes when released
    const fw = fakeWindow({ bufFor: (ab) => (ab.byteLength >= 9000 ? pcm(88) : SMALL), hold: (ab) => ab.byteLength === 9003 });
    const f = stubFetch();
    try {
      const a = unlocked(fw);
      // switched off (setMediaOn, or 删除 → keepMusic(null)) while the file is still being read
      let finishRead = null;
      a.setLobbyTrack({ id: 'reading', read: () => new Promise((r) => { finishRead = () => r(new ArrayBuffer(9001)); }) });
      a.playBgm('lobby');
      await tick();
      assert.equal(typeof finishRead, 'function', 'the file is being read');
      a.setLobbyTrack(null);
      finishRead();
      await tick();
      // another file chosen while the previous one is still decoding
      a.setLobbyTrack({ id: 'decoding', read: async () => new ArrayBuffer(9003) });
      await tick();
      assert.equal(fw.made.held.length, 1, 'its decode is pending');
      a.setLobbyTrack({ id: 'next', read: async () => new ArrayBuffer(16) });
      fw.made.release();
      await tick();
      assert.equal(a.bgm?.loopUrl, `${LOCAL_BGM}next`);
      for (const id of ['reading', 'decoding']) {
        assert.ok(!a.bufBytes.has(LOCAL_BGM + id), `no size kept for ${id}`);
        assert.ok(!a.buffers.has(LOCAL_BGM + id), `no entry for ${id}`);
      }
      for (const url of a.bufBytes.keys()) assert.ok(a.buffers.has(url), `${url}: a size only beside its entry`);
      assert.ok(bytesOf(a) < 1 * MB, `the budget holds (${bytesOf(a)} bytes)`);
      // so a sound effect stays cached: added, then another sound decoded (a trim) — it is not evicted, nor fetched again
      a.preload([SFX[0]]);
      await tick();
      a.preload([SFX[1]]);
      await tick();
      assert.ok(a.buffers.has(SFX[0]) && a.buffers.has(SFX[1]));
      const fetched = f.urls.length;
      a.preload([SFX[0]]);
      await tick();
      assert.equal(f.urls.length, fetched, 'played again from the cache');
    } finally { f.restore(); }
  });

  test('a track larger than the whole budget: the sounds stay cached and so does the track while it plays; idle, it leaves first', async () => {
    const lobby = manifest.audio.bgm.lobby;
    // the official lobby loop as 70 MiB of PCM, the player's own track as 92 MiB, everything else small
    const fw = fakeWindow({ bufFor: (ab) => (ab.byteLength === 9001 ? pcm(92) : ab.byteLength === 9002 ? pcm(70) : SMALL) });
    const f = stubFetch((u) => (u === lobby.loop || u === mediaUrl(lobby.loop) ? 9002 : 8));
    try {
      const a = unlocked(fw);
      a.preload(SFX);
      await tick();
      // (before: `bgm` is still null while a track loads, so it flushed every sound and then itself)
      a.playBgm('lobby');
      await tick();
      assert.equal(a.bgm?.loopUrl, lobby.loop);
      assert.ok(a.buffers.has(lobby.loop), 'the playing loop stays cached');
      for (const u of SFX) assert.ok(a.buffers.has(u), u);
      let reads = 0;
      a.setLobbyTrack({ id: 'big', read: async () => { reads++; return new ArrayBuffer(9001); } });
      await tick();
      assert.equal(a.bgm?.loopUrl, `${LOCAL_BGM}big`);
      assert.ok(a.buffers.has(`${LOCAL_BGM}big`), 'the own track stays cached while it plays');
      assert.ok(!a.buffers.has(lobby.loop), 'the official loop, idle now, left first');
      for (const u of SFX) assert.ok(a.buffers.has(u), u);
      // the cache still works while the big track plays
      a.preload(['/assets/audio/sfx/t4.mp3']);
      await tick();
      for (const u of [...SFX, '/assets/audio/sfx/t4.mp3']) assert.ok(a.buffers.has(u), u);
      assert.ok(bytesOf(a) - a.bufBytes.get(`${LOCAL_BGM}big`) <= 64 * MB);
      // another lobby screen: the same track, not read again
      a.playBgm('lobby');
      await tick();
      assert.equal(reads, 1);
      // another screen's music: the idle own track leaves first, the sounds stay
      a.playBgm('prep');
      await tick();
      assert.equal(a.bgm?.loopUrl, manifest.audio.bgm.prep.loop);
      assert.ok(!a.buffers.has(`${LOCAL_BGM}big`));
      for (const u of SFX) assert.ok(a.buffers.has(u), u);
    } finally { f.restore(); }
  });

  test('a track the file check already decoded (decodeBytes) is cached as it is: not read, not decoded again', async () => {
    const fw = fakeWindow();
    const f = stubFetch();
    try {
      assert.equal(await new AudioManager({ win: fw.win }).decodeBytes(new ArrayBuffer(4)), null, 'no context before a gesture');
      const a = unlocked(fw);
      assert.deepEqual(await a.decodeBytes(new ArrayBuffer(4)), SMALL);
      a.playBgm('lobby');
      await tick();
      const decodes = fw.made.decoded.length;
      let reads = 0;
      a.setLobbyTrack({ id: 'checked', read: async () => { reads++; return new ArrayBuffer(5); }, decoded: { duration: 3, length: 100, numberOfChannels: 2 } });
      await tick();
      assert.equal(a.bgm?.loopUrl, `${LOCAL_BGM}checked`);
      assert.equal(reads, 0);
      assert.equal(fw.made.decoded.length, decodes);
      assert.equal(a.bufBytes.get(`${LOCAL_BGM}checked`), 800);
    } finally { f.restore(); }
  });
});

test('the site CSP: blob: media for the own video, no remote media origin', () => {
  const csp = siteCsp(path.join(ROOT, 'public'));
  const media = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('media-src'));
  assert.equal(media, "media-src 'self' blob:");
  assert.ok(!/script-src[^;]*blob:/.test(csp));
});

test('retained local backdrop exposes motion controls and IndexedDB-only custom media', () => {
 const css=readFileSync(path.join(ROOT,'public/css/screens/lobby.css'),'utf8');
 const src=readFileSync(path.join(ROOT,'public/js/ui/hubBackdrop.js'),'utf8');
 assert.match(css,/\.hub-bg/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/data-motion="off"/);
 assert.match(src,/IndexedDB/);assert.match(src,/export function BackdropSettings/);assert.match(src,/MAX_VIDEO_BYTES/);
});
