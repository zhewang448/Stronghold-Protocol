import { useEffect, useLayoutEffect, useRef, useState, useMemo } from '../../vendor/hooks.module.js';
import { html, Button, Icon } from './components.js';
import { RadioGroup } from './radioGroup.js';
import { useStore } from '../store.js';
import { settingsStore } from './settingsStore.js';
import { dynamicOf, cropFraming, dynamicIdentity, pixelSize } from './dynamicFraming.js';
import { sharedDynamicStage, createDynamicStage } from './dynamicStage.js';
import { illustrationViewport } from './illustrationViewport.js';
import { t } from '../../../shared/i18n.js';

const PRIORITY_SELECTOR = '.rseat.is-me, .lo-drawer, .lo-detail-wrap, .detail-panel, .lo-op.is-sel, .lo-card.is-sel';

function ensureCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-dynamic-art]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/css/dynamic-art.css'; link.dataset.dynamicArt = '1'; document.head.appendChild(link);
}
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(!!query?.matches);
    query?.addEventListener('change', update);
    return () => query?.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** The static sibling stays visible until the first successful frame, and on any failure. */
export function CoverIllustration({ entry, framing = {}, playing = true, explicit = false, stage = sharedDynamicStage, clip = null, onClips = null, resolutionScale = 1 }) {
  ensureCss();
  const host = useRef(null), canvas = useRef(null), current = useRef(null);
  const latestFrame = useRef(framing), measuredFrame = useRef(framing);
  latestFrame.current = framing;
  const [visible, setVisible] = useState(false), [state, setState] = useState('idle');
  const mode = useStore(s => s.dynamicIllustrations, Object.is, settingsStore);
  const fps = useStore(s => s.fpsLimit, Object.is, settingsStore);
  const reduced = useReducedMotion();
  const enabled = explicit || (mode !== 'static' && !reduced);
  const identity = dynamicIdentity(entry), frameKey = JSON.stringify(framing);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (!globalThis.IntersectionObserver) { setVisible(true); return; }
    const io = new IntersectionObserver(entries => setVisible(entries.at(-1)?.isIntersecting === true), { rootMargin: '64px' });
    io.observe(el); return () => io.disconnect();
  }, []);
  useEffect(() => {
    const el = host.current, cv = canvas.current;
    if (!el || !cv) return;
    let query;
    const measure = () => {
      const dpr = globalThis.devicePixelRatio || 1;
      if (el.parentElement && getComputedStyle(el.parentElement).position === 'static') el.parentElement.classList.add('dyn-host');
      const still = el.previousElementSibling;
      let frame = latestFrame.current;
      if (still?.tagName === 'IMG' && frame.fit !== 'contain') {
        // Some callers place several avatars in one container or position the art
        // above a label. Match this image's box, preserving the incumbent layout.
        Object.assign(el.style, { inset: 'auto', left: still.offsetLeft + 'px', top: still.offsetTop + 'px',
          width: still.offsetWidth + 'px', height: still.offsetHeight + 'px' });
        if (frame.autoPosition) {
          const positions = getComputedStyle(still).objectPosition.split(/\s+/).map(parseFloat);
          frame = { ...frame, posX: Number.isFinite(positions[0]) ? positions[0] : 50, posY: Number.isFinite(positions[1]) ? positions[1] : 50 };
        }
      }
      measuredFrame.current = frame;
      if (current.current) current.current.framing = frame;
      const size = pixelSize(el.clientWidth * resolutionScale, el.clientHeight * resolutionScale, dpr);
      if (size.w !== cv.width || size.h !== cv.height) { cv.width = size.w; cv.height = size.h; stage.touch(current.current); }
      query?.removeEventListener('change', measure);
      query = globalThis.matchMedia?.(`(resolution: ${dpr}dppx)`); query?.addEventListener('change', measure);
    };
    measure(); const ro = globalThis.ResizeObserver ? new ResizeObserver(measure) : null; ro?.observe(el);
    if (el.previousElementSibling?.tagName === 'IMG') ro?.observe(el.previousElementSibling);
    globalThis.addEventListener?.('resize', measure);
    return () => { ro?.disconnect(); query?.removeEventListener('change', measure); globalThis.removeEventListener?.('resize', measure); };
  }, [stage, resolutionScale]);
  useEffect(() => {
    if (!entry || !visible || !enabled || !canvas.current) { setState('idle'); return; }
    let live = true;
    const priority = explicit || !!host.current?.closest(PRIORITY_SELECTOR);
    const view = stage.start({ canvas: canvas.current, entry, framing: measuredFrame.current, playing, clip, priority,
      onState: next => { if (live) setState(next); }, onClips });
    current.current = view;
    return () => { live = false; stage.stop(view); current.current = null; };
  }, [identity, visible, enabled, stage]);
  useEffect(() => {
    const v = current.current;
    if (!v) return;
    v.framing = { ...framing, ...(framing.autoPosition ? { posX: measuredFrame.current.posX, posY: measuredFrame.current.posY } : {}) };
    if (v.playing !== playing) { v.advancedAt = 0; v.nextAt = 0; }
    v.playing = playing;
    if (v.actor && clip && v.actor.spineData.animations.some(a => a.name === clip)) { v.actor.state.setAnimation(0, clip, true); v.actor.update(0); }
    stage.touch(v);
  }, [frameKey, playing, clip, fps]);
  useEffect(() => {
    const v = current.current;
    const next = explicit || !!host.current?.closest(PRIORITY_SELECTOR);
    if (v && v.priority !== next) { v.priority = next; v.nextAt = 0; stage.touch(v); }
  });
  useEffect(() => {
    const parent = host.current?.parentElement;
    if (!parent) return;
    const still = host.current.previousElementSibling;
    if (state === 'ready' && enabled) { parent.dataset.dyn = 'live'; if (still?.tagName === 'IMG') still.dataset.dynHidden = 'true'; }
    else { delete parent.dataset.dyn; if (still?.tagName === 'IMG') delete still.dataset.dynHidden; }
    return () => { delete parent.dataset.dyn; if (still?.tagName === 'IMG') delete still.dataset.dynHidden; };
  }, [state, enabled, identity, visible]);
  return html`<span class="dyn-cover" ref=${host} data-testid="dynamic-cover" data-state=${enabled && visible ? state : 'static'} aria-hidden="true">
    <canvas ref=${canvas} hidden=${state !== 'ready' || !enabled || !visible}></canvas>
  </span>`;
}

export function LiveArt({ m, charId, skin = null, kind = 'portrait', elite = true, posX = null, posY = null, frame = null, staticSrc = null }) {
  const entry = dynamicOf(m, charId, skin, kind, elite, staticSrc), crop = cropFraming(entry, kind, posX ?? 50, posY ?? 50);
  // Only a verified official crop may replace the small static picture.
  return crop ? html`<${CoverIllustration} entry=${entry} framing=${{ ...crop, autoPosition: posX == null && posY == null, ...frame }} />` : null;
}

/** One independently released renderer for the current complete preview. */
export function DynamicIllustration({ entry, staticSrc = null, name = '' }) {
  ensureCss();
  const reduced = useReducedMotion(), pref = useStore(s => s.dynamicIllustrations, Object.is, settingsStore);
  const [mode, setMode] = useState(() => pref === 'static' || reduced ? 'static' : 'dynamic');
  const [playing, setPlaying] = useState(!reduced), [clip, setClip] = useState(null), [clips, setClips] = useState([]);
  const stage = useMemo(() => createDynamicStage(), []);
  const viewport = useRef(null), navigation = useRef(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [temporary, setTemporary] = useState(false);
  useEffect(() => () => stage.destroy(), [stage]);
  useEffect(() => {
    navigation.current = illustrationViewport(viewport.current, setView);
    return () => { navigation.current?.destroy(); navigation.current = null; };
  }, []);
  useLayoutEffect(() => { navigation.current?.reset(); setTemporary(false); }, [dynamicIdentity(entry), staticSrc]);
  useLayoutEffect(() => {
    if (!temporary) setMode(pref === 'static' || reduced ? 'static' : 'dynamic');
  }, [pref, reduced, temporary]);
  const onClips = (names, idle) => { setClips(names); setClip(old => names.includes(old) ? old : idle); };
  return html`<div class="lo-dynamic" data-testid="dynamic-illustration">
    <div class="lo-dynamic__stage" ref=${viewport} tabIndex="0" role="group" aria-label=${t('立绘缩放与拖动')}
      aria-describedby="illustration-gestures" data-testid="illustration-viewport">
      <div class="lo-dynamic__art">
      ${staticSrc ? html`<img src=${staticSrc} alt=${name} draggable=${false} />` : null}
      ${entry && mode === 'dynamic' ? html`<${CoverIllustration} entry=${entry} framing=${{ fit: 'contain' }} stage=${stage}
        playing=${playing} explicit=${true} clip=${clip} onClips=${onClips} resolutionScale=${Math.max(1, view.zoom)} />` : null}
      </div>
    </div>
    <div class="lo-dynamic__controls">
      <${Button} size="sm" aria-label=${t('缩小立绘')} disabled=${view.zoom <= 0.5} onClick=${() => navigation.current?.zoomBy(0.8)}><${Icon} name="minus" /><//>
      <output class="lo-dynamic__zoom" aria-live="polite" aria-label=${t('缩放比例')} data-testid="illustration-zoom">${Math.round(view.zoom * 100)}%</output>
      <${Button} size="sm" aria-label=${t('放大立绘')} disabled=${view.zoom >= 5} onClick=${() => navigation.current?.zoomBy(1.25)}><${Icon} name="plus" /><//>
      <${Button} size="sm" onClick=${() => navigation.current?.reset()}>${t('完整适配')}<//>
      ${entry ? html`<${RadioGroup} label=${t('立绘显示')} value=${mode} options=${[{ value: 'static', label: t('静态') }, { value: 'dynamic', label: t('动态') }]} onChange=${v => { setTemporary(true); setMode(v); }} />` : null}
      ${entry && mode === 'dynamic' ? html`<${Button} size="sm" data-testid="dynamic-pause" aria-pressed=${String(!playing)} onClick=${() => setPlaying(!playing)}>${playing ? t('暂停') : t('播放')}<//>` : null}
      ${mode === 'dynamic' && clips.length > 1 ? html`<label>${t('动作')} <select aria-label=${t('动作')} value=${clip} onChange=${e => setClip(e.currentTarget.value)}>
        ${clips.map(n => html`<option value=${n}>${n}</option>`)}
      </select></label>` : null}
    </div>
    <p class="lo-dynamic__hint" id="illustration-gestures">${t('滚轮或双指缩放，放大后拖动；聚焦画面后用 + / − 缩放、方向键移动、0 恢复。')}</p>
    ${entry && mode === 'dynamic' && (pref === 'static' || reduced) ? html`<p class="lo-dynamic__hint" role="status">${t('仅在本次预览播放，不更改动态立绘设置。')}</p>` : null}
  </div>`;
}
