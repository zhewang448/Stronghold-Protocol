import { createStore, store } from '../store.js';
import { settingsStore } from './settingsStore.js';
import { audio } from '../audio.js';
import { TERMINAL_THEME, TERMINAL_THEME_BASE, normalizeTerminalTheme, terminalAsset, terminalSprite, validTerminalManifest } from '../../../shared/terminalTheme.js';

export const terminalThemeState = createStore({ active: 'default', status: 'idle', manifest: null, clip: 'Idle' });
const images = {
  'rest-window': 'rest_window_back', 'battle-window': 'battle_window_back', 'boss-window': 'boss_window_back_begin',
  character: 'img_char_spine_outer', 'shop-art': 'bg_open', logo: 'img_closure',
  'shop-board': 'board_main', 'shop-frame': 'frame_outline_triple_closure',
};
let sequence = 0, cached = null, installed = false, animationTimer = null;
let requestController = null;

function paint(manifest) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (manifest) root.dataset.terminalTheme = TERMINAL_THEME;
  else delete root.dataset.terminalTheme;
  for (const [key, name] of Object.entries(images)) {
    const url = terminalSprite(manifest, name);
    if (url) root.style.setProperty('--terminal-' + key, `url("${url}")`);
    else root.style.removeProperty('--terminal-' + key);
  }
}

async function activate(value) {
  const id = normalizeTerminalTheme(value), ticket = ++sequence;
  requestController?.abort();
  requestController = null;
  clearTimeout(animationTimer);
  audio.stopTerminalVoice();
  if (id === 'default') {
    paint(null);
    terminalThemeState.set({ active: 'default', status: 'ready', manifest: cached, clip: 'Idle' });
    return;
  }
  terminalThemeState.set({ status: 'loading' });
  try {
    const controller = new AbortController();
    requestController = controller;
    let manifest = cached;
    if (!manifest) {
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(TERMINAL_THEME_BASE + 'manifest.json', { signal: controller.signal });
        if (!response.ok) throw new Error('Theme unavailable');
        manifest = await response.json();
        if (!validTerminalManifest(manifest)) throw new Error('Invalid theme manifest');
      } finally { clearTimeout(timeout); }
    }
    if (ticket !== sequence) return;
    cached = manifest;
    paint(manifest);
    terminalThemeState.set({ active: id, status: 'ready', manifest, clip: 'Idle' });
  } catch {
    if (ticket !== sequence) return;
    paint(null);
    terminalThemeState.set({ active: 'default', status: 'error', manifest: null, clip: 'Idle' });
  }
}

export function selectTerminalTheme(id) {
  const before = settingsStore.get().terminalTheme;
  settingsStore.set({ terminalTheme: normalizeTerminalTheme(id) });
  // A failed install may be retried without changing the saved choice. Respect host policy.
  if (before === settingsStore.get().terminalTheme) activate(before);
}

export function animateTerminal(clip) {
  const state = terminalThemeState.get();
  if (state.active !== TERMINAL_THEME || !state.manifest?.animations.includes(clip)) return;
  clearTimeout(animationTimer);
  terminalThemeState.set({ clip });
  // [ASSUMED] A browser preview returns to Idle after four seconds; native Unity timelines are not replayed.
  if (clip !== 'Idle') animationTimer = setTimeout(() => terminalThemeState.set({ clip: 'Idle' }), 4000);
}

export function playTerminalVoice(id = 'CN_001', preview = false) {
  const state = terminalThemeState.get(), settings = settingsStore.get();
  if (state.active !== TERMINAL_THEME || (!preview && !settings.terminalVoice) || globalThis.document?.hidden) return false;
  const language = settings.voiceLang === 'jp' ? 'jp' : 'cn';
  const url = terminalAsset(state.manifest, state.manifest?.voices?.[language]?.[id]);
  if (!url) return false;
  return audio.playTerminalVoice(url, preview);
}

export function installTerminalTheme() {
  if (installed) return;
  installed = true;
  let previous = settingsStore.get().terminalTheme;
  activate(previous);
  settingsStore.subscribe(settings => {
    if (settings.terminalTheme !== previous) { previous = settings.terminalTheme; activate(previous); }
    if (!settings.terminalVoice) audio.stopTerminalVoice();
  });
  let phaseKey = null;
  store.subscribe(state => {
    const pub = state.match?.public;
    if (!pub) { phaseKey = null; return; }
    const next = `${pub.round}:${pub.phase}`;
    if (next === phaseKey) return;
    const first = phaseKey === null;
    phaseKey = next;
    if (first) return; // Reloading or joining mid-match must not replay a cue.
    // Official skinVoiceAnimDict. Only these directly observable triggers are mapped.
    if (pub.phase === 'ROUND_START' && pub.round === 1) { animateTerminal('Happy'); playTerminalVoice('CN_001'); }
    if (pub.phase === 'FINAL_ASSAULT') { animateTerminal('Talk'); playTerminalVoice('CN_008'); }
    if (pub.phase === 'HIDDEN_CORE') { animateTerminal('Special_B'); playTerminalVoice('CN_009'); }
  });
}
