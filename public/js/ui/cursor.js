// Native CSS cursors: pointer movement never waits for JavaScript or a render tick.
// Optional third-party artwork is installed by tools/install-cursors.mjs; missing
// images keep the system cursor. [ASSUMED] A 75 ms press samples the source pack's
// squeeze pose; the Windows spring/idle animation and global hooks are not used.
import { createStore } from '../store.js';
import { normalizeCursorSize, cursorHotspot } from '../../../shared/cursor.js';

export const CURSOR_PATH = '/assets/cursor/arknights-e1249037/';
export const CURSOR_FILES = Object.freeze(['normal', 'pointer', 'pressed', 'pointer-pressed', 'grab', 'grabbing', 'text', 'disabled']);
export const cursorState = createStore({ status: 'system', size: null });
export const cursorImage = (name, size) => `${CURSOR_PATH}${normalizeCursorSize(size)}/${name}.png`;
const FALLBACKS = { normal: 'default', pointer: 'pointer', pressed: 'default', 'pointer-pressed': 'pointer', grab: 'grab', grabbing: 'grabbing', text: 'text', disabled: 'not-allowed' };

/** Called only after the board accepts an actual piece drag, not a mouse press. */
export function setCursorDragging(active, doc = globalThis.document) {
  if (!doc?.documentElement) return;
  if (active) doc.documentElement.dataset.cursorDragging = 'true';
  else delete doc.documentElement.dataset.cursorDragging;
}

export function installCursor({ settings, doc = globalThis.document, win = globalThis.window, state = cursorState } = {}) {
  if (!doc || !win || !settings) return () => {};
  const root = doc.documentElement;
  const fine = win.matchMedia('(any-pointer: fine)');
  const colors = win.matchMedia('(forced-colors: active)');
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false, mouse = true, displayedSize = null, pressTimer = 0, pressedAt = 0;
  const sizes = new Map();
  const images = new Set();
  const on = (target, name, fn) => { target.addEventListener(name, fn, { capture: true, passive: true }); return () => target.removeEventListener(name, fn, true); };
  const reset = () => {
    win.clearTimeout(pressTimer); pressTimer = 0;
    delete root.dataset.cursorPressed;
    setCursorDragging(false, doc);
  };
  const selected = () => settings.get().cursorTheme === 'arknights';
  const wantedSize = () => normalizeCursorSize(settings.get().cursorSize);
  const apply = () => {
    if (disposed) return;
    const supported = fine.matches && !colors.matches;
    const size = wantedSize(), status = sizes.get(size);
    if (status === 'ready' && displayedSize !== size) {
      for (const name of CURSOR_FILES) {
        const [x, y] = cursorHotspot(size, name);
        root.style.setProperty(`--cursor-image-${name}`, `url("${cursorImage(name, size)}") ${x} ${y}, ${FALLBACKS[name]}`);
      }
      displayedSize = size;
    }
    // Keep the loaded size during a new-size download; publish only a complete set.
    const active = selected() && supported && mouse && (status === 'ready' || (status === 'loading' && displayedSize !== null));
    if (active) { root.dataset.cursorTheme = 'arknights'; root.dataset.cursorSize = String(displayedSize); }
    else { delete root.dataset.cursorTheme; delete root.dataset.cursorSize; reset(); }
    state.set({ status: !selected() ? 'system' : !supported ? 'unsupported' : status === 'failed' ? 'unavailable' : status === 'ready' ? 'ready' : 'loading',
      size: selected() && supported && (status === 'ready' || status === 'loading') ? displayedSize : null });
  };
  const preload = size => {
    if (sizes.get(size) === 'ready' || sizes.get(size) === 'loading') return;
    sizes.set(size, 'loading');
    apply();
    Promise.all(CURSOR_FILES.map(name => new Promise(resolve => {
      const image = new win.Image(); images.add(image);
      image.onload = () => { images.delete(image); resolve(image.naturalWidth === size && image.naturalHeight === size); };
      image.onerror = () => { images.delete(image); resolve(false); };
      image.src = cursorImage(name, size);
    }))).then(results => {
      sizes.set(size, results.every(Boolean) ? 'ready' : 'failed'); apply();
    });
  };
  const refresh = () => {
    if (selected() && fine.matches && !colors.matches) preload(wantedSize());
    apply();
  };
  const pointer = e => {
    const next = e.pointerType === 'mouse';
    if (next !== mouse) { mouse = next; apply(); }
  };
  const down = e => {
    pointer(e);
    if (e.button !== 0 || !root.dataset.cursorTheme || reduce.matches) return;
    win.clearTimeout(pressTimer); pressedAt = win.performance.now();
    root.dataset.cursorPressed = 'true';
  };
  const up = e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    setCursorDragging(false, doc);
    win.clearTimeout(pressTimer);
    pressTimer = win.setTimeout(() => { delete root.dataset.cursorPressed; }, Math.max(0, 75 - (win.performance.now() - pressedAt)));
  };
  const move = e => { pointer(e); if (!e.buttons && (root.dataset.cursorPressed || root.dataset.cursorDragging)) reset(); };
  const leave = e => { if (!e.relatedTarget) { mouse = false; apply(); } };
  const hidden = () => { if (doc.hidden) { mouse = false; apply(); } };
  const offs = [settings.subscribe(refresh), on(doc, 'pointerover', pointer), on(doc, 'pointermove', move),
    on(doc, 'pointerdown', down), on(win, 'pointerup', up), on(win, 'pointercancel', reset), on(win, 'blur', e => { if (e.target === win) reset(); }),
    on(doc, 'pointerout', leave), on(doc, 'visibilitychange', hidden), on(doc, 'lostpointercapture', reset)];
  for (const query of [fine, colors, reduce]) {
    const changed = () => { reset(); refresh(); };
    query.addEventListener('change', changed);
    offs.push(() => query.removeEventListener('change', changed));
  }
  refresh();
  return () => {
    disposed = true; offs.forEach(off => off()); reset(); delete root.dataset.cursorTheme;
    delete root.dataset.cursorSize;
    for (const name of CURSOR_FILES) root.style.removeProperty(`--cursor-image-${name}`);
    for (const image of images) { image.onload = null; image.onerror = null; image.src = ''; }
    images.clear();
  };
}
