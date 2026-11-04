import { useEffect, useRef } from '../../vendor/hooks.module.js';
import { html } from './components.js';
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
export function useCardArt(key) { return normalizeCardArt(useStore(state => state.values[key], Object.is, frames)); }
export function setCardArt(key, value) {
  const values = { ...frames.get().values, [key]: normalizeCardArt(value) };
  savePref('room.cardArt', values); frames.set({ values });
}
export function useArtGestures(elementRef, value, onChange, { enabled = true, minimum = 0.8, maximum = 2, parentBounds = false } = {}) {
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
export function CardArtImage({ frameKey, src, class: className = '', custom = false, onError = null, interactive = false }) {
  ensureCardArtCss();
  const frame = useCardArt(frameKey);
  const image = useRef(null);
  const gestures = useArtGestures(image, frame, next => setCardArt(frameKey, next), { enabled: interactive, parentBounds: true });
  return html`<img ref=${image} src=${src} class=${`cardart__still ${interactive ? 'is-interactive' : ''} ${className}`} alt="" draggable=${false} data-art=${custom ? 'custom' : 'operator'}
    tabindex=${interactive ? '0' : undefined} aria-label=${interactive ? t('拖拽调整位置') : undefined} ...${gestures}
    style=${`object-fit:cover;transform:translate(${frame.ox}%,${frame.oy}%) scale(${frame.zoom})`} onError=${onError} />`;
}
