import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from './components.js';
import { createStore, loadPref, savePref, useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

const frames = createStore({ values: loadPref('room.cardArt', {}) || {} });
export function ensureCardArtCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-card-art]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/css/screens/card-art.css'; link.dataset.cardArt = '1'; document.head.appendChild(link);
}
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
export function normalizeCardArt(value) {
  const number = (field, fallback) => typeof value?.[field] === 'number' && Number.isFinite(value[field]) ? value[field] : fallback;
  return { zoom: clamp(number('zoom', 1), 0.8, 2), ox: clamp(number('ox', 0), -100, 100), oy: clamp(number('oy', 0), -100, 100) };
}
export function cardArtOf(key) { return normalizeCardArt(frames.get().values[key]); }
export function setCardArt(key, value) {
  const values = { ...frames.get().values, [key]: normalizeCardArt(value) };
  savePref('room.cardArt', values); frames.set({ values });
}
export function CardArtImage({ frameKey, src, class: className = '', custom = false, onError = null }) {
  ensureCardArtCss();
  const value = useStore(state => state.values[frameKey], Object.is, frames);
  const frame = normalizeCardArt(value);
  return html`<img src=${src} class=${`cardart__still ${className}`} alt="" draggable=${false} data-art=${custom ? 'custom' : 'operator'}
    style=${`object-fit:cover;transform:translate(${frame.ox}%,${frame.oy}%) scale(${frame.zoom})`} onError=${onError} />`;
}
export function CardArt({ frameKey, src, onClose }) {
  ensureCardArtCss();
  const current = useStore(state => state.values[frameKey], Object.is, frames), value = normalizeCardArt(current);
  const preview = useRef(null), latest = useRef(value);
  latest.current = value;
  const update = patch => setCardArt(frameKey, { ...latest.current, ...patch });
  const [drag, setDrag] = useState(null);
  const pointers = useRef(new Map()), pinch = useRef(null);
  useEffect(() => {
    const element = preview.current;
    const wheel = event => { event.preventDefault(); update({ zoom: latest.current.zoom - Math.sign(event.deltaY) * 0.1 }); };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, [frameKey]);
  const spread = () => { const points = [...pointers.current.values()]; return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y); };
  const down = event => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) pinch.current = { distance: spread(), zoom: latest.current.zoom };
    else setDrag({ x: event.clientX, y: event.clientY, value: latest.current });
  };
  const move = event => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && pinch.current?.distance) update({ zoom: pinch.current.zoom * spread() / pinch.current.distance });
    else if (drag) {
      const bounds = preview.current.getBoundingClientRect();
      update({ ox: drag.value.ox + (event.clientX - drag.x) / bounds.width * 100, oy: drag.value.oy + (event.clientY - drag.y) / bounds.height * 100 });
    }
  };
  const up = event => { pointers.current.delete(event.pointerId); pinch.current = null; setDrag(null); };
  return html`<${Modal} open=${true} title=${t('立绘调整')} class="cardart-dialog" width="min(430px,94vw)" onClose=${onClose}
      actions=${html`<${Button} onClick=${() => setCardArt(frameKey, {})} data-testid="card-art-reset">${t('重置')}<//><${Button} variant="primary" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="cardart-frame" ref=${preview} tabindex="0" role="region" aria-label=${t('拖拽调整位置')} data-testid="card-art-frame"
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}
      onKeyDown=${event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); update({ ox: value.ox + (event.key === 'ArrowLeft' ? -2 : event.key === 'ArrowRight' ? 2 : 0), oy: value.oy + (event.key === 'ArrowUp' ? -2 : event.key === 'ArrowDown' ? 2 : 0) });
      } }}><${CardArtImage} frameKey=${frameKey} src=${src} custom=${true} /></div>
    <label>${t('缩放')} <input type="range" min="0.8" max="2" step="0.01" value=${value.zoom} data-testid="card-art-zoom" onInput=${event => update({ zoom: Number(event.currentTarget.value) })} /></label>
    <p>${t('拖动调整位置，滑块、滚轮或双指缩放；取景仅保存在本机。')}</p>
  <//>`;
}
