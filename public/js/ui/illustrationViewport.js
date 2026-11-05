// Local preview gestures, shared by still and live artwork. Coordinates are CSS
// pixels relative to the viewport centre; changing playback never changes them.
export function illustrationViewport(element, onChange) {
  const MIN = 0.5, MAX = 5, pointers = new Map();
  let view = { zoom: 1, x: 0, y: 0 }, gesture = null;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const box = () => element.getBoundingClientRect();
  const point = event => { const r = box(); return { x: event.clientX - r.left - r.width / 2, y: event.clientY - r.top - r.height / 2 }; };
  const commit = next => {
    const r = box(), zoom = clamp(next.zoom, MIN, MAX);
    view = { zoom, x: clamp(next.x, -r.width * Math.max(0, zoom - 1) / 2, r.width * Math.max(0, zoom - 1) / 2),
      y: clamp(next.y, -r.height * Math.max(0, zoom - 1) / 2, r.height * Math.max(0, zoom - 1) / 2) };
    element.style.setProperty('--art-zoom', String(view.zoom));
    element.style.setProperty('--art-x', view.x + 'px'); element.style.setProperty('--art-y', view.y + 'px');
    element.dataset.zoomed = String(zoom > 1); onChange({ ...view });
  };
  const zoomBy = (factor, anchor = { x: 0, y: 0 }) => {
    const zoom = clamp(view.zoom * factor, MIN, MAX), ratio = zoom / view.zoom;
    commit({ zoom, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio });
  };
  const metric = () => {
    const p = [...pointers.values()];
    return p.length > 1 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2,
      distance: Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) } : p[0] ? { ...p[0], distance: 0 } : null;
  };
  const rebase = () => { const m = metric(); gesture = m ? { ...m, view: { ...view } } : null; };
  const down = e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, point(e)); element.setPointerCapture?.(e.pointerId); rebase();
    if (view.zoom > 1 || pointers.size > 1) e.preventDefault();
  };
  const move = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, point(e)); const m = metric();
    if (!gesture || !m) return;
    const zoom = gesture.distance > 0 && m.distance > 0 ? clamp(gesture.view.zoom * m.distance / gesture.distance, MIN, MAX) : gesture.view.zoom;
    if (pointers.size > 1 || zoom > 1) {
      const ratio = zoom / gesture.view.zoom;
      commit({ zoom, x: m.x - (gesture.x - gesture.view.x) * ratio, y: m.y - (gesture.y - gesture.view.y) * ratio });
      e.preventDefault();
    }
  };
  const up = e => {
    pointers.delete(e.pointerId);
    if (element.hasPointerCapture?.(e.pointerId)) element.releasePointerCapture(e.pointerId);
    rebase();
  };
  const reset = () => commit({ zoom: 1, x: 0, y: 0 });
  const clear = () => {
    const ids = [...pointers.keys()]; pointers.clear(); gesture = null;
    for (const id of ids) if (element.hasPointerCapture?.(id)) element.releasePointerCapture(id);
  };
  const touchAction = element.style.touchAction;
  element.style.touchAction = 'none';
  const wheel = e => { e.preventDefault(); e.stopPropagation(); zoomBy(Math.exp(-clamp(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box().height : 1), -600, 600) * 0.002), point(e)); };
  const key = e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-') zoomBy(0.8);
    else if (e.key === '0' || e.key === 'Home') reset();
    else if (e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 80 : 32;
      commit({ ...view, x: view.x + (e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0),
        y: view.y + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0) });
    } else return;
    e.preventDefault(); e.stopPropagation();
  };
  const listeners = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: up, lostpointercapture: up, keydown: key, wheel };
  for (const [name, listener] of Object.entries(listeners)) element.addEventListener(name, listener, { passive: false });
  globalThis.addEventListener('blur', clear);
  const ro = globalThis.ResizeObserver ? new ResizeObserver(() => { clear(); commit(view); }) : null; ro?.observe(element);
  reset();
  return { zoomBy, reset, destroy() {
    clear(); ro?.disconnect(); globalThis.removeEventListener('blur', clear);
    for (const [name, listener] of Object.entries(listeners)) element.removeEventListener(name, listener);
    element.style.touchAction = touchAction;
  } };
}
