// public/js/ui/avatarCrop.js — 替换头像 (the maintainer's request of 2026-10-18): the 1:1 cropper every avatar entry of
// this client goes through — the room top bar's button (AvatarButton below) and the 本机账号 panel's 更换头像
// (ui/accounts.js calls `openAvatarCropper`, the dialog-only opener at the end of this file).
//
// There is no other cropper in this client (the skin picker only shows a picture), so this is the one: a square stage
// with the picked picture under it, the mouse wheel zooms around the pointer, dragging moves the picture, and the square
// cannot show an empty edge. 确认使用 renders the visible square to a 256 × 256 canvas (WebP, then PNG; downscaled until
// the picture is ≤ AVATAR_MAX_BYTES), uploads it (ui/customAvatar.js) and the avatar components redraw at once.
//
// The geometry is plain arithmetic in this module's exports (`coverScale`, `clampOffset`, `cropRect`, `zoomAt`) so the
// Node tests can pin it without a browser; the DOM part only measures the stage and draws the transform.

import { Fragment, html, Button, Icon, Modal, confirmDialog } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { render } from '../../vendor/preact.module.js';
import { toast } from './toasts.js';
import { identity } from '../net.js';
import { t } from '../../../shared/i18n.js';
import {
  AVATAR_MAX_BYTES, AVATAR_SIZE, uploadOwnAvatar, removeOwnAvatar, useOwnAvatar,
} from './customAvatar.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Zoom range, relative to "the picture covers the square" (1 = no empty edge). */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** One wheel notch. */
export const ZOOM_STEP = 1.12;
/** Largest source file the picker accepts (bytes; the server only ever sees the 256 px render). */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

const clamp = (v, lo, hi) => {
  const out = Math.min(hi, Math.max(lo, v));
  return out === 0 ? 0 : out; // no -0 in a transform / a crop rect
};

/** The scale that makes an iw × ih picture cover a `size` square. */
export function coverScale(iw, ih, size) {
  if (!(iw > 0) || !(ih > 0) || !(size > 0)) return 1;
  return Math.max(size / iw, size / ih);
}

/** Keep a zoom inside [MIN_ZOOM, MAX_ZOOM]. */
export function clampZoom(zoom) {
  const z = Number.isFinite(zoom) ? zoom : MIN_ZOOM;
  return clamp(z, MIN_ZOOM, MAX_ZOOM);
}

/** The largest translation (px) before an empty edge would show, at scale `k` (stage px per image px). */
export function maxOffset(iw, ih, size, k) {
  return { x: Math.max(0, (iw * k - size) / 2), y: Math.max(0, (ih * k - size) / 2) };
}

/** Clamp a translation into what the picture can cover. */
export function clampOffset(x, y, iw, ih, size, k) {
  const m = maxOffset(iw, ih, size, k);
  return { x: clamp(Number.isFinite(x) ? x : 0, -m.x, m.x), y: clamp(Number.isFinite(y) ? y : 0, -m.y, m.y) };
}

/**
 * The part of the picture the square shows, in image pixels — what the 256 px render draws.
 * @param {{ iw: number, ih: number, size: number, zoom: number, x: number, y: number }} view
 * @returns {{ sx: number, sy: number, sw: number, sh: number }}
 */
export function cropRect({ iw, ih, size, zoom, x, y }) {
  const k = coverScale(iw, ih, size) * clampZoom(zoom);
  const sw = Math.min(iw, size / k);
  const m = maxOffset(iw, ih, size, k);
  const cx = clamp(Number.isFinite(x) ? x : 0, -m.x, m.x);
  const cy = clamp(Number.isFinite(y) ? y : 0, -m.y, m.y);
  const sx = clamp((iw - sw) / 2 - cx / k, 0, Math.max(0, iw - sw));
  const sy = clamp((ih - sw) / 2 - cy / k, 0, Math.max(0, ih - sw));
  return { sx, sy, sw, sh: sw };
}

/**
 * Zoom around a stage point (the pointer): the picture's pixel under that point stays under it. Returns the new zoom
 * and the clamped translation.
 * @param {{ iw: number, ih: number, size: number, zoom: number, x: number, y: number }} view
 * @param {number} nextZoom @param {number} px @param {number} py stage-local px
 */
export function zoomAt(view, nextZoom, px, py) {
  const { iw, ih, size } = view;
  const z0 = clampZoom(view.zoom);
  const z1 = clampZoom(nextZoom);
  const s0 = coverScale(iw, ih, size);
  const k0 = s0 * z0;
  const k1 = s0 * z1;
  const left0 = (size - iw * k0) / 2 + (Number.isFinite(view.x) ? view.x : 0);
  const top0 = (size - ih * k0) / 2 + (Number.isFinite(view.y) ? view.y : 0);
  const ix = (px - left0) / k0;
  const iy = (py - top0) / k0;
  const x1 = px - ix * k1 - (size - iw * k1) / 2;
  const y1 = py - iy * k1 - (size - ih * k1) / 2;
  const offset = clampOffset(x1, y1, iw, ih, size, k1);
  return { zoom: z1, x: offset.x, y: offset.y };
}

// ---- the picture → blob --------------------------------------------------------------------------------------------

/** `canvas.toBlob` as a promise (null when the browser has no 2d canvas). */
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch { resolve(null); }
  });
}

/** Load an object URL as an `<img>` (rejects on a picture the browser cannot decode). */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = url;
  });
}

/**
 * Render the cropped square into a ≤ AVATAR_SIZE picture, compressed under AVATAR_MAX_BYTES: WebP at two qualities, then
 * PNG, downscaling the square when even the smallest quality is too large for the server.
 * @param {HTMLImageElement} img @param {{ sx: number, sy: number, sw: number, sh: number }} rect
 * @returns {Promise<Blob|null>}
 */
export async function encodeAvatar(img, rect) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  for (const side of [AVATAR_SIZE, 192, 160, 128]) {
    canvas.width = side;
    canvas.height = side;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, side, side);
    ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, side, side);
    for (const [type, quality] of [['image/webp', 0.9], ['image/webp', 0.72], ['image/png', undefined]]) {
      const blob = await canvasToBlob(canvas, type, quality);
      if (blob && blob.size > 0 && blob.size <= AVATAR_MAX_BYTES && /^image\/(png|webp)$/.test(blob.type)) return blob;
    }
  }
  return null;
}

// ---- the dialog ----------------------------------------------------------------------------------------------------

/**
 * 自定义头像 dialog: pick a picture, crop it to 1:1, 确认使用, or 移除自定义头像.
 * @param {{ open: boolean, onClose?: () => void }} props
 */
export function AvatarDialog({ open, onClose }) {
  const ownUrl = useOwnAvatar();
  const [pic, setPic] = useState(/** @type {{ img: HTMLImageElement, iw: number, ih: number, url: string }|null} */ (null));
  const [stage, setStage] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [busy, setBusy] = useState(false);
  const stageRef = useRef(null);
  const fileRef = useRef(null);
  const drag = useRef(/** @type {{ id: number, px: number, py: number, x: number, y: number }|null} */ (null));

  // the picture's object URL lives as long as the picture is in the cropper
  useEffect(() => () => { if (pic?.url) { try { URL.revokeObjectURL(pic.url); } catch { /* already gone */ } } }, [pic]);

  // measure the square while the dialog is open (CSS sizes it; the crop math works in stage px)
  useEffect(() => {
    if (!open) return undefined;
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => setStage(el.clientWidth);
    measure();
    let ro = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(measure); ro.observe(el); }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [open]);

  const k = pic && stage > 0 ? coverScale(pic.iw, pic.ih, stage) * zoom : 1;
  const left = pic ? (stage - pic.iw * k) / 2 + x : 0;
  const top = pic ? (stage - pic.ih * k) / 2 + y : 0;

  const resetView = () => { setZoom(MIN_ZOOM); setX(0); setY(0); };

  const onFile = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0] || null;
    input.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast(t('请选择图片文件'), 'warn'); return; }
    if (file.size > MAX_SOURCE_BYTES) {
      toast(t('图片过大，请选择小于 {n} MB 的图片', { n: Math.round(MAX_SOURCE_BYTES / (1024 * 1024)) }), 'warn');
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty picture');
      setPic({ img, iw: img.naturalWidth, ih: img.naturalHeight, url });
      resetView();
    } catch {
      try { URL.revokeObjectURL(url); } catch { /* already gone */ }
      toast(t('无法读取这张图片'), 'error');
    }
  };

  const onWheel = (event) => {
    if (!pic || !(stage > 0)) return;
    if (event.cancelable) event.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const next = zoomAt({ iw: pic.iw, ih: pic.ih, size: stage, zoom, x, y }, zoom * factor, px, py);
    setZoom(next.zoom);
    setX(next.x);
    setY(next.y);
  };

  const onPointerDown = (event) => {
    if (!pic || !(stage > 0)) return;
    if (event.button != null && event.button !== 0) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* no capture: pointerup may come from outside */ }
    drag.current = { id: event.pointerId, px: event.clientX, py: event.clientY, x, y };
  };
  const onPointerMove = (event) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId || !pic) return;
    const offset = clampOffset(d.x + (event.clientX - d.px), d.y + (event.clientY - d.py), pic.iw, pic.ih, stage, k);
    setX(offset.x);
    setY(offset.y);
  };
  const endDrag = (event) => {
    if (drag.current && drag.current.id === event.pointerId) drag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* it was not captured */ }
  };

  const zoomBy = (factor) => {
    if (!pic || !(stage > 0)) return;
    const next = zoomAt({ iw: pic.iw, ih: pic.ih, size: stage, zoom, x, y }, zoom * factor, stage / 2, stage / 2);
    setZoom(next.zoom);
    setX(next.x);
    setY(next.y);
  };

  const confirm = async () => {
    if (!pic || !(stage > 0) || busy) return;
    const token = identity.getToken();
    if (!token) { toast(t('尚未连接到服务器，请稍候重试'), 'warn'); return; }
    setBusy(true);
    try {
      const blob = await encodeAvatar(pic.img, cropRect({ iw: pic.iw, ih: pic.ih, size: stage, zoom, x, y }));
      if (!blob) { toast(t('图片处理失败，请换一张试试'), 'error'); return; }
      await uploadOwnAvatar(blob, token);
      toast(t('自定义头像已更新'), 'success');
      onClose?.();
    } catch (err) {
      toast(err?.status === 429 ? t('操作太频繁，请稍后再试') : t('上传失败，请重试'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      title: t('移除自定义头像'),
      text: t('移除后大厅、同盟等待和局内都会回到默认头像。'),
      okText: t('移除'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await removeOwnAvatar(identity.getToken());
      toast(t('已移除自定义头像'), 'success');
      setPic(null);
      resetView();
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  return html`<${Modal} open=${open} title=${t('替换头像')} micro="CUSTOM AVATAR" width="min(92vw, 560px)"
      onClose=${() => { if (!busy) onClose?.(); }}
      actions=${html`<${Fragment}>
        ${ownUrl ? html`<${Button} variant="danger" size="sm" disabled=${busy} onClick=${remove} data-testid="avatar-remove">${t('移除自定义头像')}<//>` : null}
        <${Button} disabled=${busy} onClick=${() => onClose?.()}>${t('取消')}<//>
        <${Button} variant="primary" loading=${busy} disabled=${!pic || !(stage > 0)} onClick=${confirm} data-testid="avatar-confirm">${t('确认使用')}<//>
      <//>`}>
    <p class="avcrop__intro">${t('选择一张图片，滚轮缩放、拖动调整位置，裁成 1:1 后用作头像。')}</p>
    <div class=${cx('avcrop__stage', pic && 'is-ready')} ref=${stageRef} data-testid="avatar-stage"
        data-zoom=${zoom.toFixed(3)} data-offset=${`${x.toFixed(1)},${y.toFixed(1)}`}
        onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${endDrag} onPointerCancel=${endDrag}
        onWheel=${onWheel}>
      ${pic
        ? html`<img class="avcrop__img" src=${pic.url} alt="" draggable=${false}
            style=${`width:${pic.iw * k}px;height:${pic.ih * k}px;transform:translate(${left}px,${top}px)`} />`
        : html`<span class="avcrop__empty">
            <${Icon} name="image" class="avcrop__empty-icon" />
            <span>${t('还没有选择图片')}</span>
          </span>`}
      <span class="avcrop__frame brackets" aria-hidden="true"></span>
    </div>
    <div class="avcrop__tools">
      <input class="avcrop__file" type="file" accept="image/png,image/jpeg,image/webp,image/*" ref=${fileRef} tabindex="-1"
        aria-hidden="true" data-testid="avatar-file" onChange=${onFile} />
      <${Button} size="sm" icon="image" disabled=${busy} onClick=${() => fileRef.current?.click()} data-testid="avatar-choose">${t('选择图片')}<//>
      <span class="avcrop__zoom">
        <${Button} variant="ghost" size="sm" square=${true} disabled=${!pic || zoom <= MIN_ZOOM} onClick=${() => zoomBy(1 / ZOOM_STEP)}
          aria-label=${t('缩小')} title=${t('缩小')} data-testid="avatar-zoom-out"><${Icon} name="minus" /><//>
        <${Button} variant="ghost" size="sm" square=${true} disabled=${!pic || zoom >= MAX_ZOOM} onClick=${() => zoomBy(ZOOM_STEP)}
          aria-label=${t('放大')} title=${t('放大')} data-testid="avatar-zoom-in"><${Icon} name="plus" /><//>
      </span>
    </div>
    <p class="avcrop__hint">${t('滚轮缩放 · 拖动图片调整位置')}</p>
    ${ownUrl ? html`<div class="avcrop__own"><span>${t('当前头像')}</span><span class="avcrop__own-pic"><img src=${ownUrl} alt="" /></span></div>` : null}
  <//>`;
}

/**
 * The 替换头像 button (the room's tools; ui/accounts.js's 本机账号 panel has its own 更换头像 that calls
 * `openAvatarCropper` — one cropper, two entries). Its own dialog is mounted with it.
 * @param {{ class?: string, label?: boolean }} props
 */
export function AvatarButton({ class: cls, label = true }) {
  const [open, setOpen] = useState(false);
  return html`<${Fragment}>
    <${Button} variant="secondary" size="sm" icon="image" square=${!label} class=${cx('avatar-entry', cls)} onClick=${() => setOpen(true)}
      title=${t('替换头像')} aria-label=${label ? undefined : t('替换头像')} data-testid="avatar-open">
      ${label ? t('替换头像') : null}
    <//>
    <${AvatarDialog} open=${open} onClose=${() => setOpen(false)} />
  <//>`;
}

// ---- the dialog-only opener (ui/accounts.js's 更换头像: 点原来的入口 → 选图 → 1:1 裁剪 → 确认) --------------------

/** @type {HTMLElement|null} the body-level host the imperative dialog renders into */
let cropHost = null;

/**
 * Open the 1:1 cropper as its own dialog, without any button of its own — the 本机账号 panel's 更换头像 calls this so
 * the crop step always comes before an upload. The dialog lives in a body-level host, so it is never clipped or
 * re-positioned by the panel it was opened from. Opening it again just re-renders the same dialog.
 * @param {{ onClose?: () => void }} [opts] `onClose` runs when the dialog closes (either way)
 * @returns {() => void} close it now
 */
export function openAvatarCropper({ onClose } = {}) {
  if (typeof document === 'undefined') return () => {};
  if (!cropHost) {
    cropHost = document.createElement('div');
    cropHost.className = 'avatar-crop-host';
    document.body.appendChild(cropHost);
  }
  const host = cropHost;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    render(null, host);
    host.remove?.();
    if (cropHost === host) cropHost = null;
    onClose?.();
  };
  render(html`<${AvatarDialog} open=${true} onClose=${close} />`, host);
  return close;
}
