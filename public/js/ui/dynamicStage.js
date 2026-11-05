// Shared offscreen Pixi renderer → independently animated 2D canvases.
// Adapted from Stardust-minus d03ae6e (GPL-3.0-or-later), with bounded pixels,
// scheduling and lifetime policy from the implementation plan / Misyra 146007cc.
import { ensurePixi } from '../render/app/pixi.js';
import { framingLayout, dynamicIdentity, dynamicFps } from './dynamicFraming.js';
import { settingsStore } from './settingsStore.js';

export const PAGE = 4096, MAX_STEP = 0.25, IDLE_MS = 5000, LOAD_TIMEOUT_MS = 20000;
export function packPages(sizes, side) {
  const order = sizes.map((s, index) => {
    const ratio = Math.min(1, side / Math.max(s.w, s.h));
    return { index, w: Math.max(1, Math.round(s.w * ratio)), h: Math.max(1, Math.round(s.h * ratio)) };
  }).sort((a, b) => b.h - a.h || b.w - a.w);
  const pages = [];
  let page, x = 0, y = 0, rowH = 0;
  for (const s of order) {
    if (page && x + s.w > side) { x = 0; y += rowH; rowH = 0; }
    if (!page || y + s.h > side) { page = { w: 0, h: 0, cells: [] }; pages.push(page); x = y = rowH = 0; }
    page.cells.push({ ...s, x, y });
    page.w = Math.max(page.w, x + s.w); page.h = Math.max(page.h, y + s.h);
    x += s.w; rowH = Math.max(rowH, s.h);
  }
  return pages;
}

/** Cache loading still uses the common Spine LRU, including timeout and late-result disposal. */
export async function acquireSpine(entry) {
  const { assets } = await import('../assets.js');
  let h = 2166136261;
  for (const ch of dynamicIdentity(entry)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const url = new URL(entry.skel, globalThis.location?.href || 'http://localhost');
  url.searchParams.set('dynamic', (h >>> 0).toString(16));
  const keyed = { ...entry, skel: url.pathname + url.search, dynamic: true, anims: entry.anims || {} };
  try {
    const data = await assets.spine.acquire(keyed);
    return { data, release: () => assets.spine.release(keyed) };
  } catch (e) {
    // RefLru counts failed acquisitions too; every caller must return that reference.
    assets.spine.release(keyed);
    throw e;
  }
}

// pixi-spine 4 opens a stale setup clipping attachment after Idle replaces it with a mesh.
export function fixStaleClips(data, idle) {
  const anim = data?.animations?.find(a => a.name === idle) || data?.animations?.find(a => /^idle$/i.test(a.name)) || data?.animations?.[0];
  const skin = data?.defaultSkin, changed = [];
  const isClip = a => a && (a.type === 6 || 'endSlot' in a);
  if (!anim || !skin) return changed;
  for (const tl of anim.timelines || []) {
    if (!tl.attachmentNames || tl.frames?.[0] !== 0) continue;
    const slot = data.slots?.[tl.slotIndex], first = tl.attachmentNames[0];
    if (slot && first && isClip(skin.getAttachment(tl.slotIndex, slot.attachmentName)) && !isClip(skin.getAttachment(tl.slotIndex, first))) {
      slot.attachmentName = first; changed.push(slot.name);
    }
  }
  return changed;
}

export function createDynamicStage() {
  const views = new Set();
  let P, renderer, stage, booting, raf = 0, last = 0, lost = false, idleTimer, contexts = 0, limit = PAGE;
  let listening = false, frames = 0, serial = 0, generation = 0;
  const frameTimes = [];
  const cancel = () => { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; };
  const visibility = () => { cancel(); for (const v of views) { v.advancedAt = 0; v.nextAt = 0; } if (!document.hidden) schedule(); };
  const fps = () => dynamicFps(settingsStore.get().fpsLimit, globalThis.matchMedia?.('(pointer: coarse)').matches);
  const hasWork = () => [...views].some(v => v.actor && !v.failed && (v.playing !== false || v.dirty));
  function schedule() {
    if (!raf && !lost && !globalThis.document?.hidden && hasWork()) raf = requestAnimationFrame(tick);
  }
  async function boot() {
    if (renderer) return;
    if (!booting) {
      const ticket = generation;
      booting = (async () => {
        P = await ensurePixi();
        if (ticket !== generation) throw new Error('Dynamic renderer load was disposed');
        renderer = new P.Renderer({ width: 1, height: 1, backgroundAlpha: 0, antialias: true, resolution: 1 });
        contexts++; stage = new P.Container();
        lost = false;
        const gl = renderer.gl;
        const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
        limit = Math.max(1, Math.min(PAGE, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), dims[0], dims[1]));
        const ownedRenderer = renderer;
        renderer.view.addEventListener('webglcontextlost', e => {
          if (renderer !== ownedRenderer) return;
          e.preventDefault(); lost = true; cancel();
          for (const v of views) v.onState?.('fallback');
        });
        renderer.view.addEventListener('webglcontextrestored', () => {
          if (renderer !== ownedRenderer) return;
          lost = false; last = 0;
          for (const v of views) { v.drawn = false; v.dirty = true; }
          schedule();
        });
      })().catch(e => { if (ticket === generation) booting = null; throw e; });
    }
    await booting;
  }
  function dispose() {
    generation++;
    cancel(); clearTimeout(idleTimer);
    if (listening) document.removeEventListener('visibilitychange', visibility);
    listening = false;
    if (renderer) {
      const gl = renderer.gl;
      stage?.destroy({ children: true, texture: false, baseTexture: false });
      renderer.destroy(true);
      try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already lost */ }
    }
    renderer = stage = booting = null; lost = false;
  }
  function retire() {
    if (!views.size) { cancel(); clearTimeout(idleTimer); idleTimer = setTimeout(dispose, IDLE_MS); }
  }
  function destroyView(v) {
    if (v.container) { stage?.removeChild(v.container); v.container.destroy({ children: true, texture: false, baseTexture: false }); }
    if (v.mask) { stage?.removeChild(v.mask); v.mask.destroy(); }
    v.release?.(); v.release = null; v.actor = v.container = v.mask = null;
  }
  async function load(v) {
    let actor, container, release;
    try {
      await boot();
      if (v.gone) return;
      const got = await acquireSpine(v.entry); release = got.release;
      if (v.gone) return;
      fixStaleClips(got.data, v.entry.anims?.idle);
      actor = new P.spine.Spine(got.data); actor.autoUpdate = false;
      const clips = got.data.animations.map(a => a.name);
      const idle = clips.includes(v.clip) ? v.clip : clips.includes(v.entry.anims?.idle) ? v.entry.anims.idle : clips.find(n => /^idle$/i.test(n)) || clips[0];
      if (!idle) throw new Error('No illustration animation');
      actor.state.setAnimation(0, idle, true); actor.update(0);
      for (const { trackIndex, animationName } of v.entry.extraTracks || []) {
        if (Number.isInteger(trackIndex) && trackIndex > 0 && clips.includes(animationName)) actor.state.setAnimation(trackIndex, animationName, true);
      }
      actor.update(0);
      let bounds = v.entry.bounds;
      if (!(bounds?.width > 0 && bounds?.height > 0)) {
        const b = actor.getLocalBounds();
        bounds = { x: b.x, y: -(b.y + b.height), width: b.width, height: b.height };
      }
      if (!(bounds.width > 0 && bounds.height > 0)) throw new Error('Empty illustration bounds');
      container = new P.Container(); container.addChild(actor);
      const { assets } = await import('../assets.js');
      for (const [url, front] of [[v.entry.background, false], [v.entry.foreground, true]]) {
        if (!url) continue;
        const img = await assets.image(url);
        if (v.gone) return;
        if (!img) throw new Error('Missing illustration layer');
        const sprite = new P.Sprite(P.Texture.from(img));
        Object.assign(sprite, { x: bounds.x, y: -bounds.y - bounds.height, width: bounds.width, height: bounds.height });
        if (front) container.addChild(sprite); else container.addChildAt(sprite, 0);
      }
      if (v.gone) return;
      const mask = new P.Graphics(); container.mask = mask; stage.addChild(container, mask);
      Object.assign(v, { actor, container, mask, release, bounds, dirty: true });
      release = null; actor = container = null;
      const supporting = new Set((v.entry.extraTracks || []).map(t => t.animationName));
      v.onClips?.(clips.filter(name => !supporting.has(name)), idle); schedule();
    } catch (e) {
      if (!v.gone) { v.failed = true; v.error = String(e?.message || e); v.onState?.('fallback', e); }
    } finally {
      if (container) container.destroy({ children: true, texture: false, baseTexture: false });
      else actor?.destroy({ children: true, texture: false, baseTexture: false });
      release?.(); retire();
    }
  }
  function tick(now) {
    raf = 0;
    if (globalThis.document?.hidden || lost || !renderer) { last = 0; return; }
    if (last && now - last < 1000 / fps() - 0.5) { schedule(); return; }
    const dt = last ? Math.min(MAX_STEP, (now - last) / 1000) : 0;
    last = now;
    const began = performance.now(), draw = [];
    // Measured 40 real Dusk thumbnails exceeded a frame on this machine. Keep focused
    // art at the selected cap; sample other thumbnails in groups of at most twelve.
    const secondary = [...views].filter(v => v.actor && v.playing !== false && !v.priority).length;
    const stride = Math.max(1, Math.ceil(secondary / 12));
    for (const v of views) {
      if (!v.actor || v.failed) continue;
      if (v.playing !== false && (!v.nextAt || now >= v.nextAt || v.dirty)) {
        v.actor.update(v.advancedAt ? Math.min(MAX_STEP, (now - v.advancedAt) / 1000) : dt);
        const interval = 1000 / fps() * (v.priority ? 1 : stride);
        v.advancedAt = now;
        v.nextAt = Math.floor(now / interval) * interval + (v.priority ? 0 : v.ordinal % stride) * 1000 / fps();
        if (v.nextAt <= now + 0.5) v.nextAt += interval;
        v.dirty = true;
      }
      if (v.dirty && v.canvas.width && v.canvas.height) draw.push(v);
      if (v.container) v.container.visible = false;
    }
    for (const page of packPages(draw.map(v => ({ w: v.canvas.width, h: v.canvas.height })), limit)) {
      renderer.resize(page.w, page.h);
      for (const cell of page.cells) {
        const v = draw[cell.index], l = framingLayout(cell.w, cell.h, v.bounds, v.framing);
        v.container.scale.set(l.scale); v.container.position.set(cell.x + l.x, cell.y + l.y); v.container.visible = true;
        v.mask.clear().beginFill(0xffffff).drawRect(cell.x, cell.y, cell.w, cell.h).endFill();
      }
      try {
        renderer.render(stage, { clear: true });
        for (const c of page.cells) {
          const v = draw[c.index], ctx = v.ctx ||= v.canvas.getContext('2d');
          ctx.clearRect(0, 0, v.canvas.width, v.canvas.height);
          ctx.drawImage(renderer.view, c.x, c.y, c.w, c.h, 0, 0, v.canvas.width, v.canvas.height);
          v.frames = (v.frames || 0) + 1;
          v.container.visible = false; v.dirty = false;
          if (!v.drawn) { v.drawn = true; v.onState?.('ready'); }
        }
      } catch (e) {
        for (const c of page.cells) { const v = draw[c.index]; v.failed = true; v.container.visible = false; v.onState?.('fallback', e); }
      }
    }
    if (draw.length) { frames++; frameTimes.push(performance.now() - began); if (frameTimes.length > 600) frameTimes.shift(); }
    schedule();
  }
  return {
    start(view) {
      clearTimeout(idleTimer);
      if (!listening && globalThis.document) { document.addEventListener('visibilitychange', visibility); listening = true; }
      const v = { ...view, gone: false, dirty: true, drawn: false, ordinal: serial++ };
      views.add(v); v.onState?.('loading');
      v.nextAt = performance.now() + (views.size % 4) * 8;
      v.timer = setTimeout(() => { if (!v.actor && !v.gone) { v.onState?.('fallback'); this.stop(v); } }, LOAD_TIMEOUT_MS);
      void load(v); return v;
    },
    touch(v) { if (v && !v.gone) { v.dirty = true; schedule(); } },
    stop(v) { if (!v || v.gone) return; v.gone = true; clearTimeout(v.timer); views.delete(v); destroyView(v); retire(); },
    destroy() { for (const v of [...views]) this.stop(v); dispose(); },
    get canvas() { return renderer?.view || null; },
    get stats() { return { views: views.size, drawn: [...views].filter(v => v.drawn).length, contexts: renderer ? 1 : 0,
      createdContexts: contexts, scheduled: !!raf, frames, frameTimes: [...frameTimes], page: limit,
      viewFrames: [...views].map(v => v.frames || 0), lost, failures: [...views].filter(v => v.failed).map(v => v.error) }; },
  };
}
export const sharedDynamicStage = createDynamicStage();
export const startView = view => sharedDynamicStage.start(view);
export const stopView = view => sharedDynamicStage.stop(view);
export const touchView = view => sharedDynamicStage.touch(view);
export const dynamicStage = sharedDynamicStage;
