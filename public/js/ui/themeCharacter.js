// The official funds-card character (theme.json `character`) on `.funds__char`.
// An image is a picture. A Spine of an installed official pack reuses the battle loader (Spine 3.8, pixi-spine); one
// of an imported pack is built from its bytes (themeSpine.js, §37.232). Idle loops, and a theme voice line plays the
// clip named in `anims.voice`. No character leaves today's box.

import { ensurePixi } from '../render/app/pixi.js';
import { bindThemeCharacterVoice } from '../uiTheme.js';
import { characterAnimName, characterIdleName } from '../../../shared/uiTheme.js';
import { settingsStore } from './settingsStore.js';

function clipNames(actor) {
  const list = actor?.spineData?.animations || actor?.skeleton?.data?.animations || [];
  return new Set(list.map((anim) => anim?.name).filter(Boolean));
}

function fitSpine(actor, app) {
  const viewW = Math.max(1, app.renderer.width / (app.renderer.resolution || 1));
  const viewH = Math.max(1, app.renderer.height / (app.renderer.resolution || 1));
  actor.position.set(0, 0);
  actor.scale.set(1);
  try { actor.update(0); } catch { /* the first pose can throw before a clip exists */ }
  const bounds = typeof actor.getLocalBounds === 'function' ? actor.getLocalBounds() : null;
  const bw = Math.max(1, bounds?.width || viewW);
  const bh = Math.max(1, bounds?.height || viewH);
  const scale = Math.min(viewW / bw, viewH / bh);
  actor.scale.set(scale);
  const originX = bounds ? bounds.x + bounds.width / 2 : 0;
  const originY = bounds ? bounds.y + bounds.height / 2 : 0;
  actor.x = viewW / 2 - originX * scale;
  actor.y = viewH / 2 - originY * scale;
}

/**
 * Mount into `host`. Returns a dispose function. A missing PIXI build leaves the host empty.
 * @param {HTMLElement} host
 * @param {{ imageUrl?: string, spine?: { skel: string, atlas: string, textures: string[], anims?: object }, anims?: { idle?: string, voice?: Record<string, string> } } | null} character
 * @param {{ voice?: boolean, onReady?: (controller: { animations: string[], play: (clip: string) => void }) => void }} [opts]  voice false: a second copy (a 规程 banner's window, ui/prefab/view.js) that plays
 *   idle only and leaves the funds card's voice binding alone
 */
export function mountThemeCharacter(host, character, opts = {}) {
  if (!host || !character) return () => {};
  const voice = opts.voice !== false;
  let dead = false;
  let app = null;
  let actor = null;
  let visible = true;
  let observer = null;
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const syncMotion = () => {
    if (!app || !actor) return;
    const settings = settingsStore.get();
    const play = visible && !globalThis.document?.hidden && !reduced?.matches && settings.themeMotion !== false && settings.dynamicIllustrations !== 'static';
    actor.autoUpdate = play;
    if (play) app.start();
    else { app.stop(); app.render(); }
  };
  const unsubscribe = settingsStore.subscribe(syncMotion);
  globalThis.document?.addEventListener('visibilitychange', syncMotion);
  reduced?.addEventListener?.('change', syncMotion);
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); syncMotion(); });
    observer.observe(host);
  }
  const idleName = characterIdleName(character);

  const playIdle = () => {
    if (!actor || dead) return;
    const names = clipNames(actor);
    const name = names.has(idleName) ? idleName : (names.has('Default') ? 'Default' : [...names][0]);
    if (!name) return;
    try { actor.state.setAnimation(0, name, true); } catch { /* this skeleton has no such clip */ }
  };

  const onStem = (stem) => {
    if (!actor || dead || !visible) return;
    if (!stem) { playIdle(); return; }
    const name = characterAnimName(character, stem);
    const names = clipNames(actor);
    if (!name || !names.has(name)) return;
    try {
      const track = actor.state.setAnimation(0, name, false);
      if (names.has(idleName)) actor.state.addAnimation(0, idleName, true, 0);
      if (track) {
        track.listener = {
          complete: () => { if (!dead) playIdle(); },
        };
      }
    } catch { /* keep the idle loop */ }
  };

  const unbindVoice = voice ? bindThemeCharacterVoice(onStem) : () => {};

  const dispose = () => {
    dead = true;
    unsubscribe();
    observer?.disconnect();
    globalThis.document?.removeEventListener('visibilitychange', syncMotion);
    reduced?.removeEventListener?.('change', syncMotion);
    unbindVoice();
    if (app) {
      const view = app.view;
      try { app.destroy(true, { children: true, texture: false, baseTexture: false }); }
      catch { /* already destroyed */ }
      view?.remove?.();
      app = null;
    }
    actor = null;
    host.querySelector?.('.funds__charimg')?.remove();
  };

  if (character.imageUrl) {
    const img = document.createElement('img');
    img.className = 'funds__charimg';
    img.alt = '';
    img.draggable = false;
    img.src = character.imageUrl;
    host.appendChild(img);
    return dispose;
  }

  // validSpine (the battle loader's check) wants an `anims` record on the entry itself; the character keeps its own
  // `anims` beside `spine` (the default robot of the 规程 shop had none and drew nothing).
  const blobs = character.spine?.blobs || null;
  const entry = character.spine && !blobs ? { ...character.spine, anims: character.spine.anims || { idle: idleName } } : null;
  if (!entry && !blobs) return dispose;
  (async () => {
    try {
      let data;
      let P;
      if (blobs) {
        // an imported pack (§37.232): the model is built from its bytes, no request
        P = await ensurePixi();
        if (dead || !P?.spine?.Spine) return;
        const { loadSpineFromBlobs } = await import('../themeSpine.js');
        data = await loadSpineFromBlobs(blobs, P);
      } else {
        // assets.js loads lazily: a vanilla page's start does not import the asset store (test/ui/plugins-client.test.js)
        const { loadSpineData, validSpine } = await import('../assets.js');
        if (dead || !validSpine(entry)) return;
        P = await ensurePixi();
        if (dead || !P?.spine?.Spine) return;
        data = await loadSpineData(entry);
      }
      if (dead) return;
      const width = Math.max(1, Math.round(host.clientWidth || 108));
      const height = Math.max(1, Math.round(host.clientHeight || 116));
      app = new P.Application({
        width,
        height,
        backgroundAlpha: 0,
        resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
        autoDensity: true,
      });
      const view = app.view;
      view.className = 'funds__charcanvas';
      view.style.width = '100%';
      view.style.height = '100%';
      view.style.pointerEvents = 'none';
      view.setAttribute('aria-hidden', 'true');
      host.appendChild(view);
      actor = new P.spine.Spine(data);
      actor.autoUpdate = true;
      app.stage.addChild(actor);
      playIdle();
      fitSpine(actor, app);
      syncMotion();
      opts.onReady?.({ animations: [...clipNames(actor)], play: (clip) => {
        if (!actor || dead || !clipNames(actor).has(clip)) return;
        const looping = ['Idle', 'Default', 'Sad_Idle'].includes(clip);
        actor.state.setAnimation(0, clip, looping);
        if (!looping) actor.state.addAnimation(0, clip === 'Sad_Begin' && clipNames(actor).has('Sad_Idle') ? 'Sad_Idle' : idleName, true, 0);
        actor.update(0);
        app.render();
      } });
    } catch {
      /* The funds numbers stay. A portrait that cannot load is not an error dialog. */
    }
  })();
  return dispose;
}
