// Explicitly requested season openings (upstream entryFilm.js, §37.59 / §37.147).
// Rendering and sound timings stay upstream's; the owner chose manual, repeatable playback.
// No boot hook: only EntryFilmButton calls this. Leaving the current screen/version cancels it.
import { store, selectRoute } from '../store.js';
import { audio, resolveBgm } from '../audio.js';
import { data } from '../data.js';
import { lobbyVersion, startupVersion, seasonOf } from '../versions.js';
import { DEFAULT_VERSION } from '../../../shared/versions.js';
import { t } from '../../../shared/i18n.js';
import { toast } from './toasts.js';

const ENTRY_SFX = '/assets/audio/sfx/customse/act1autochess/act1autochess_g_ui_load.mp3';
const SFX_GAIN = 0.54;
let active = null;

/** Preserve upstream music handoff, including a custom lobby track arriving during playback. */
export function holdBgm(a = audio) {
  if (!a.ctx || a.bgmSilent || a.lobbyTrack || Object.prototype.hasOwnProperty.call(a, 'playBgm')) return null;
  let asked, passed = false;
  const placeholder = key => {
    if (a.lobbyTrack) {
      if (a.playBgm === placeholder) delete a.playBgm;
      passed = true;
      try { a.playBgm(key); } catch { /* Audio can be unavailable. */ }
      return;
    }
    asked = key;
  };
  a.playBgm = placeholder;
  try { ++a.bgmToken; a._fadeOutBgm(null, 0.4); } catch { /* Audio can be unavailable. */ }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (a.playBgm === placeholder) delete a.playBgm;
    if (!passed) { try { a.playBgm(asked !== undefined ? asked : a.lastBgmKey ?? 'lobby'); } catch { /* Audio can be unavailable. */ } }
  };
}

async function loadFilm(version) {
  if (seasonOf(version) === 'act3autochess') {
    const m = await import('./regulationFilm.js');
    const pack = await m.loadRegulationPack();
    if (!pack) { m.clearRegulationPack(); return null; }
    return { mount: host => m.mountRegulationIntro(host, pack), preload: () => m.preloadRegulation(pack, 5000),
      span: m.REG_SPAN, cues: m.REG_AUDIO, version };
  }
  const m = await import('./allianceScene.js');
  return { mount: m.mountAllianceIntro, preload: () => m.preloadSprites(undefined, 5000),
    span: m.INTRO_SPAN, cues: m.INTRO_AUDIO, version: DEFAULT_VERSION,
    origin: t0 => m.setCycleOrigin(t0 + (3.12 - m.INTRO_SPAN.from) * 1000) };
}

async function prepareSound(version) {
  if (audio.ctx?.state !== 'running' || audio.volumes?.muted) return null;
  const manifest = data.get('assets');
  const track = !audio.bgmSilent && !audio.lobbyTrack ? resolveBgm(manifest, 'lobby', version) : null;
  const wait = promise => new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 2500);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); });
  });
  const listed = manifest?.audio?.sfx?.ui?.load;
  const [sfx] = await Promise.all([wait(audio.volumes?.sfx > 0 ? audio._buffer(typeof listed === 'string' && listed ? listed : ENTRY_SFX) : null),
    wait(track?.intro ? audio._buffer(track.intro) : null), wait(track ? audio._buffer(track.loop) : null)]);
  return sfx;
}

/**
 * Open one repeatable, user-initiated film. Resolves when it closes, including during loading.
 * [ASSUMED] Explicit playback remains available with reduced motion; nothing ever starts itself.
 * @param {string} version
 * @param {{ trigger?: Element|null }} [options]
 * @returns {Promise<boolean>}
 */
export function playEntryFilm(version, { trigger = document.activeElement } = {}) {
  if (active) return active;
  const route = selectRoute(store.get());
  if (route !== 'title' && route !== 'lobby') return Promise.resolve(false);
  const allowed = () => selectRoute(store.get()) === route
    && (route === 'title' ? startupVersion(store.get()) : lobbyVersion(store.get())) === version;
  if (!allowed()) return Promise.resolve(false);
  const previous = trigger;
  const dialog = document.createElement('dialog');
  dialog.className = 'entry-film';
  dialog.dataset.entryFilm = '';
  dialog.dataset.phase = 'loading';
  dialog.dataset.season = seasonOf(version);
  dialog.setAttribute('aria-label', t('开场动画'));
  const sceneHost = document.createElement('div');
  sceneHost.className = 'entry-film__scene';
  sceneHost.setAttribute('aria-hidden', 'true');
  const loading = document.createElement('p');
  loading.className = 'entry-film__loading';
  loading.setAttribute('role', 'status');
  loading.textContent = t('正在准备开场动画…');
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'btn btn--ghost btn--sm entry-film__skip';
  skip.dataset.testid = 'entry-film-skip';
  skip.textContent = t('跳过');
  const shortcut = document.createElement('kbd');
  shortcut.textContent = 'Esc';
  skip.append(shortcut);
  dialog.append(sceneHost, loading, skip);

  let resolveDone;
  const result = new Promise(resolve => { resolveDone = resolve; });
  active = result;
  let done = false, scene = null, frameId = 0, release = null, musicTimer = 0, cue = null;
  let unwatch = () => {};
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frameId);
    clearTimeout(musicTimer);
    unwatch();
    try { cue?.gain.disconnect(); } catch { /* Already disconnected. */ }
    try { cue?.node.stop(Math.max(audio.ctx?.currentTime ?? 0, cue.when)); } catch { /* Already stopped. */ }
    try { release?.(); } catch { /* The audio context may have closed. */ }
    try { scene?.destroy(); } catch { /* Remove the dialog even after a renderer failure. */ }
    try { dialog.close(); } catch { /* Fallback browsers use the open attribute. */ }
    dialog.remove();
    active = null;
    resolveDone(dialog.dataset.phase === 'playing');
    requestAnimationFrame(() => {
      if (previous instanceof HTMLElement && previous.isConnected && selectRoute(store.get()) === route) previous.focus({ preventScroll: true });
    });
  };
  skip.addEventListener('click', finish);
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); finish(); }
  });
  dialog.addEventListener('close', finish);
  unwatch = store.subscribe(() => { if (!allowed()) finish(); });
  document.body.append(dialog);
  try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
  skip.focus({ preventScroll: true });

  const missing = () => {
    if (done) return;
    const show = allowed();
    finish();
    if (show) toast(t('开场动画素材未就绪，请在「素材与资源」中下载或导入后重试。'), 'warn');
  };
  (async () => {
    await data.load('assets');
    if (done) return;
    const film = await loadFilm(version);
    if (done) return;
    if (!film) { missing(); return; }
    const [pictures, sound] = await Promise.all([film.preload(), prepareSound(film.version)]);
    if (done) return;
    if (!pictures || !allowed()) { missing(); return; }
    scene = film.mount(sceneHost);
    loading.remove();
    dialog.dataset.phase = 'playing';
    const { from, fadeAt, to } = film.span;
    const lead = 0.04;
    const t0 = performance.now() + lead * 1000;
    film.origin?.(t0);
    if (audio.ctx?.state === 'running') {
      const context = audio.ctx;
      if (sound && audio.sfxGain) {
        const node = context.createBufferSource(), gain = context.createGain();
        node.buffer = sound;
        gain.gain.value = SFX_GAIN;
        node.connect(gain); gain.connect(audio.sfxGain);
        const when = context.currentTime + lead + Math.max(0, film.cues.sfxAt - from);
        node.start(when);
        cue = { node, gain, when };
      }
      release = holdBgm();
      if (release) musicTimer = setTimeout(() => release?.(), Math.max(0, (lead + film.cues.bgmAt - from - 0.05) * 1000));
    }
    const draw = () => {
      if (done) return;
      const time = from + (performance.now() - t0) / 1000;
      if (time >= to) { finish(); return; }
      if (time < 3.2) scene.grain();
      scene.render(Math.max(from, time));
      sceneHost.style.opacity = String(1 - Math.min(1, Math.max(0, (time - fadeAt) / (to - fadeAt))));
      frameId = requestAnimationFrame(draw);
    };
    scene.render(from);
    frameId = requestAnimationFrame(draw);
  })().catch(missing);
  return result;
}
