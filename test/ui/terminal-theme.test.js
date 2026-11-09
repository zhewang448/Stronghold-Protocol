import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTerminalTheme, terminalAsset, validTerminalManifest } from '../../shared/terminalTheme.js';
import { sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { AudioManager } from '../../public/js/audio.js';

function fixture() {
  const files = {};
  const file = path => { files[path] = { bytes: 10, sha256: 'a'.repeat(64) }; return path; };
  const sprites = Object.fromEntries(['img_char_spine_outer', 'rest_window_back', 'battle_window_back', 'boss_window_back_begin', 'bg_open', 'img_closure']
    .map(name => [name, file('sprites/' + name + '.png')]));
  const voices = {};
  for (const lang of ['cn', 'jp']) voices[lang] = Object.fromEntries(Array.from({ length: 19 }, (_, i) => {
    const id = 'CN_' + String(i + 1).padStart(3, '0');
    return [id, file('audio/' + lang + '/' + id + '.wav')];
  }));
  file('spine/mascot.png');
  return { version: 1, id: 'ac_s_closur', files, sprites, voices, animations: ['Idle'],
    spine: { skel: file('spine/mascot.json'), atlas: file('spine/mascot.atlas'), bounds: { x: -10, y: 0, width: 20, height: 40 } } };
}

test('theme settings retain explicit choices and reject unknown/ill-typed stored values', () => {
  assert.equal(sanitizeSettings({}).terminalTheme, 'default');
  assert.equal(sanitizeSettings({}).terminalVoice, false);
  assert.equal(sanitizeSettings({ terminalTheme: 'ac_s_closur', terminalVoice: true }).terminalTheme, 'ac_s_closur');
  for (const value of [null, true, {}, 'other', '../ac_s_closur']) assert.equal(normalizeTerminalTheme(value), 'default');
  assert.equal(sanitizeSettings({ terminalVoice: 'true' }).terminalVoice, false);
});

test('theme manifest is complete before activation; no URL/path can escape its local folder', () => {
  const manifest = fixture();
  assert.equal(validTerminalManifest(manifest), true);
  assert.match(terminalAsset(manifest, 'spine/mascot.json'), /^\/assets\/terminal-themes\/ac_s_closur\/spine\/mascot.json\?v=a{16}$/);
  for (const path of ['../secret.json', 'sprites/../../secret', '/sprites/a.png', 'https://example.com/a', 'sprites/a.png");color:red', 'sprites/%2e%2e/a']) {
    assert.equal(terminalAsset(manifest, path), null);
  }
  const incomplete = fixture(); delete incomplete.files['spine/mascot.png'];
  assert.equal(validTerminalManifest(incomplete), false);
  const noVoices = fixture(); noVoices.voices.jp = {};
  assert.equal(validTerminalManifest(noVoices), false);
  const invalidBounds = fixture(); invalidBounds.spine.bounds.width = NaN;
  assert.equal(validTerminalManifest(invalidBounds), false);
});

test('theme voices respect mute and operator speech; an explicit preview can take over', () => {
  const audio = new AudioManager();
  const calls = [];
  audio.ctx = {}; audio.voiceGain = {};
  audio.volumes = { muted: false, voice: 1 };
  audio._playVoice = (url, token) => calls.push({ url, token });
  const url = '/assets/terminal-themes/ac_s_closur/audio/cn/CN_001.wav?v=' + 'a'.repeat(16);
  audio.voiceGate.start('select', null, 0);
  assert.equal(audio.playTerminalVoice(url), false);
  assert.equal(audio.playTerminalVoice(url, true), true);
  assert.equal(calls.length, 1);
  assert.equal(audio.voiceGate.playing.slot, 'terminal');
  audio.stopTerminalVoice();
  assert.equal(audio.voiceGate.playing, null);
  audio.volumes.muted = true;
  assert.equal(audio.playTerminalVoice(url, true), false);
  audio.volumes.muted = false;
  assert.equal(audio.playTerminalVoice('https://example.com/voice.wav', true), false);
  assert.equal(calls.length, 1);
});
