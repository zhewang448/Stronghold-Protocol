import { useEffect, useRef } from '../../vendor/hooks.module.js';
import { html, Button, Icon, Modal } from './components.js';
import { savePref, useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';
import { LiveArt } from './dynamicIllustration.js';
import { cardArtStore as frames, retryCardArtSync } from './cardArtModel.js';
import { normalizeCardArt, CARD_ART_MIN_ZOOM, CARD_ART_MAX_ZOOM } from '../../../shared/cardArt.js';
export { normalizeCardArt, cardArtKey, CARD_ART_MIN_ZOOM, CARD_ART_MAX_ZOOM } from '../../../shared/cardArt.js';
export { setCardArtScope } from './cardArtModel.js';

export function ensureCardArtCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-card-art]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/css/screens/card-art.css'; link.dataset.cardArt = '1'; document.head.appendChild(link);
}
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
export function cardArtOf(key) { return normalizeCardArt(frames.get().values[key]); }
/** Keep each operator appearance's local framing independent; preserve the original default key. */
export function useCardArt(key) { return normalizeCardArt(useStore(state => state.values[key], Object.is, frames)); }
export function setCardArt(key, value) {
  const values = { ...frames.get().values, [key]: normalizeCardArt(value) };
  savePref('room.cardArt', values); frames.set({ values });
}
export function useArtGestures(elementRef, value, onChange, { enabled = true, minimum = CARD_ART_MIN_ZOOM, maximum = CARD_ART_MAX_ZOOM, parentBounds = false } = {}) {
  const latest = useRef(null), pointers = useRef(new Map()), gesture = useRef(null), moved = useRef(false);
  latest.current = { value, onChange };
  const update = patch => {
    const next = { ...latest.current.value, ...patch };
    next.zoom = clamp(next.zoom, minimum, maximum);
    latest.current.value = latest.current.onChange(next) || next;
  };
  useEffect(() => {
    const element = elementRef.current;
    if (!enabled || !element) return;
    const wheel = event => {
      if (!event.deltaY) return;
      event.preventDefault(); update({ zoom: latest.current.value.zoom - Math.sign(event.deltaY) * 0.1 });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [enabled, minimum, maximum]);
  const resetGesture = () => {
    const points = [...pointers.current.values()];
    gesture.current = { points, value: { ...latest.current.value } };
  };
  const down = event => {
    if (!enabled || event.button > 0) return;
    if (!pointers.current.size) moved.current = false;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId); resetGesture();
  };
  const move = event => {
    if (!enabled || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()], start = gesture.current;
    if (!start?.points.length) return;
    const distance = items => Math.hypot(items[0].x - items[1].x, items[0].y - items[1].y);
    if (points.length === 2 && start.points.length === 2 && distance(start.points) > 0) {
      moved.current = true; update({ zoom: start.value.zoom * distance(points) / distance(start.points) });
    } else if (points.length === 1) {
      const dx = points[0].x - start.points[0].x, dy = points[0].y - start.points[0].y;
      if (Math.hypot(dx, dy) < 3 && !moved.current) return;
      const element = parentBounds ? elementRef.current.parentElement : elementRef.current;
      const bounds = element.getBoundingClientRect();
      moved.current = true; update({ ox: start.value.ox + dx / bounds.width * 100, oy: start.value.oy + dy / bounds.height * 100 });
    }
  };
  const up = event => { pointers.current.delete(event.pointerId); resetGesture(); };
  return { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up, onLostPointerCapture: up,
    onClickCapture: event => { if (enabled && moved.current) { event.preventDefault(); event.stopPropagation(); moved.current = false; } },
    onKeyDown: event => {
      if (!enabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); const frame = latest.current.value;
      update({ ox: frame.ox + (event.key === 'ArrowLeft' ? -2 : event.key === 'ArrowRight' ? 2 : 0),
        oy: frame.oy + (event.key === 'ArrowUp' ? -2 : event.key === 'ArrowDown' ? 2 : 0) });
    } };
}
export function CardArtImage({ frameKey, frame: sharedFrame = undefined, src, class: className = '', custom = false, onError = null, interactive = false, m = null, charId = null, skin = null }) {
  ensureCardArtCss();
  const localFrame = useCardArt(frameKey);
  const frame = sharedFrame === undefined ? localFrame : normalizeCardArt(sharedFrame);
  const surface = useRef(null);
  const gestures = useArtGestures(surface, frame, next => setCardArt(frameKey, next), { enabled: interactive });
  return html`<span ref=${surface} class=${`cardart__surface${interactive ? ' is-interactive' : ''}`}
    tabindex=${interactive ? '0' : undefined} role=${interactive ? 'region' : undefined} aria-label=${interactive ? t('拖拽调整位置') : undefined} ...${gestures}>
    <img src=${src} class=${`cardart__still ${className}`} alt="" draggable=${false} data-art=${custom ? 'custom' : 'operator'}
      style=${`object-fit:cover;transform:translate(${frame.ox}%,${frame.oy}%) scale(${frame.zoom})`} onError=${onError} />
    ${!custom ? html`<${LiveArt} m=${m} charId=${charId} skin=${skin} frame=${frame} staticSrc=${src} />` : null}
  </span>`;
}

export function CardArtSyncStatus() {
  const sync = useStore(state => state.sync, Object.is, frames);
  const text = sync === 'synced' ? t('取景已同步') : sync === 'pending' || sync === 'sending' ? t('正在同步取景…')
    : sync === 'error' ? t('取景同步失败') : t('取景已保存在本机');
  return html`<span role="status">${text}
    ${sync === 'error' ? html`<${Button} size="sm" variant="ghost" onClick=${retryCardArtSync}>${t('重试')}<//>` : null}</span>`;
}

export function CardArtDialog({ frameKey, src, m, charId, skin, name, onClose }) {
  ensureCardArtCss();
  const frame = useCardArt(frameKey), preview = useRef(null);
  const update = next => setCardArt(frameKey, next);
  const gestures = useArtGestures(preview, frame, update);
  return html`<${Modal} open=${true} title=${t('立绘调整')} width="min(720px, 94vw)" class="illust-picker operator-art-editor" onClose=${onClose}
      actions=${html`<${Button} variant="primary" data-testid="operator-art-done" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="illust-picker__workspace">
      <div class="illust-picker__preview is-editable cardart-frame" ref=${preview} tabindex="0" role="region" aria-label=${t('拖拽调整位置')}
        data-testid="operator-art-frame" ...${gestures}>
        <${CardArtImage} frameKey=${frameKey} src=${src} m=${m} charId=${charId} skin=${skin} />
      </div>
      <div class="illust-picker__controls">
        <h3><${Icon} name="edit" />${name || t('名片干员')}</h3>
        <p class="illust-picker__hint">${t('拖动调整位置，滑块、滚轮或双指缩放；位置和大小会同步给同房间成员。')} <${CardArtSyncStatus} /></p>
        <div class="illust-picker__adjust">
          <label class="illust-picker__zoom" for="operator-art-zoom"><span>${t('缩放')}</span><output for="operator-art-zoom">${Math.round(frame.zoom * 100)}%</output>
            <input id="operator-art-zoom" type="range" min=${CARD_ART_MIN_ZOOM} max=${CARD_ART_MAX_ZOOM} step="0.01" value=${frame.zoom} data-testid="operator-art-zoom"
              onInput=${event => update({ ...frame, zoom: Number(event.currentTarget.value) })} /></label>
          <label class="illust-picker__zoom" for="operator-art-x"><span>${t('水平位置')}</span><output for="operator-art-x">${Math.round(frame.ox)}%</output>
            <input id="operator-art-x" type="range" min="-100" max="100" step="1" value=${frame.ox} data-testid="operator-art-x"
              onInput=${event => update({ ...frame, ox: Number(event.currentTarget.value) })} /></label>
          <label class="illust-picker__zoom" for="operator-art-y"><span>${t('垂直位置')}</span><output for="operator-art-y">${Math.round(frame.oy)}%</output>
            <input id="operator-art-y" type="range" min="-100" max="100" step="1" value=${frame.oy} data-testid="operator-art-y"
              onInput=${event => update({ ...frame, oy: Number(event.currentTarget.value) })} /></label>
          <${Button} size="sm" icon="refresh" data-testid="operator-art-reset" onClick=${() => update({ zoom: 1, ox: 0, oy: 0 })}>${t('重置')}<//>
        </div>
      </div>
    </div>
  <//>`;
}
