// public/js/ui/illustPicker.js — 替换立绘 (with the avatar's 替换头像): the room's entry and its dialog for the seat card's
// 立绘 position. There is no cropper here on purpose: the picture is drawn by the same 立绘 position the operator's own
// illustration uses (`CardArtImage` with a `src`, ui/cardArt.js), so the existing 立绘调整 (drag / wheel / pinch / reset,
// `sp.pref.room.cardArt`) frames it. The dialog only does what cannot be done later: downscale the long side to 1536 and
// compress to WebP (JPEG fallback, dark backdrop so alpha never turns into black speckles) under 2 MB.
//
// The encoded size is shown before 确认使用 (a typical 1536-long picture is 150–400 KB), and the upload itself is
// `POST /illust` (ui/customIllust.js) — plain HTTP, nothing in the room state or the protocol.

import { Fragment, html, Button, Icon, Modal, confirmDialog } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { toast } from './toasts.js';
import { identity } from '../net.js';
import { t } from '../../../shared/i18n.js';
import {
  ILLUST_MAX_BYTES, ILLUST_SOURCE_MAX_BYTES, encodeIllust, uploadOwnIllust, removeOwnIllust, useOwnIllust,
} from './customIllust.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

const kb = (bytes) => Math.max(1, Math.round(bytes / 1024));

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
 * 自定义立绘 dialog: pick a picture, see the WebP it will upload (long side ≤ 1536), 确认使用 or 移除自定义立绘.
 * @param {{ open: boolean, onClose?: () => void }} props
 */
export function IllustDialog({ open, onClose }) {
  const ownUrl = useOwnIllust();
  const [pic, setPic] = useState(/** @type {{ img: HTMLImageElement, iw: number, ih: number, url: string, bytes: number }|null} */ (null));
  const [prep, setPrep] = useState(/** @type {{ blob: Blob, width: number, height: number }|null} */ (null));
  const [encoding, setEncoding] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  // the picked picture's object URL lives as long as it is in the dialog
  useEffect(() => () => { if (pic?.url) { try { URL.revokeObjectURL(pic.url); } catch { /* already gone */ } } }, [pic]);

  const onFile = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0] || null;
    input.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast(t('请选择图片文件'), 'warn'); return; }
    if (file.size > ILLUST_SOURCE_MAX_BYTES) {
      toast(t('立绘图片过大，请选择小于 {n} MB 的图片', { n: Math.round(ILLUST_SOURCE_MAX_BYTES / (1024 * 1024)) }), 'warn');
      return;
    }
    const url = URL.createObjectURL(file);
    let img;
    try {
      img = await loadImage(url);
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty picture');
    } catch {
      try { URL.revokeObjectURL(url); } catch { /* already gone */ }
      toast(t('无法读取这张图片'), 'error');
      return;
    }
    setPic({ img, iw: img.naturalWidth, ih: img.naturalHeight, url, bytes: file.size });
    setPrep(null);
    setEncoding(true);
    try {
      const encoded = await encodeIllust(img);
      if (encoded) setPrep(encoded);
      else toast(t('立绘处理失败，请换一张试试'), 'error');
    } finally {
      setEncoding(false);
    }
  };

  const confirm = async () => {
    if (!prep || busy) return;
    const token = identity.getToken();
    if (!token) { toast(t('尚未连接到服务器，请稍候重试'), 'warn'); return; }
    setBusy(true);
    try {
      await uploadOwnIllust(prep.blob, token);
      toast(t('自定义立绘已更新'), 'success');
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
      title: t('移除自定义立绘'),
      text: t('移除后座位卡会回到干员原立绘。'),
      okText: t('移除'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await removeOwnIllust(identity.getToken());
      toast(t('自定义立绘已移除'), 'success');
      setPic(null);
      setPrep(null);
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  return html`<${Modal} open=${open} title=${t('替换立绘')} micro="CUSTOM ILLUSTRATION" width="min(92vw, 620px)"
      onClose=${() => { if (!busy) onClose?.(); }}
      actions=${html`<${Fragment}>
        ${ownUrl ? html`<${Button} variant="danger" size="sm" disabled=${busy} onClick=${remove} data-testid="illust-remove">${t('移除自定义立绘')}<//>` : null}
        <${Button} disabled=${busy} onClick=${() => onClose?.()}>${t('取消')}<//>
        <${Button} variant="primary" loading=${busy || encoding} disabled=${!prep || busy || encoding} onClick=${confirm} data-testid="illust-confirm">${t('确认使用')}<//>
      <//>`}>
    <p class="avcrop__intro">${t('选择一张立绘图片，确认后会压成 WebP（长边最多 1536）并显示在座位卡的立绘位；位置用「立绘调整」摆。')}</p>
    <div class=${cx('illustpic', pic && 'is-ready')} data-testid="illust-stage">
      ${pic
        ? html`<img class="illustpic__img" src=${pic.url} alt="" draggable=${false} />`
        : html`<span class="illustpic__empty"><${Icon} name="image" class="avcrop__empty-icon" /><span>${t('还没有选择立绘')}</span></span>`}
    </div>
    <div class="avcrop__tools">
      <input class="avcrop__file" type="file" accept="image/png,image/jpeg,image/webp,image/*" ref=${fileRef} tabindex="-1"
        aria-hidden="true" data-testid="illust-file" onChange=${onFile} />
      <${Button} size="sm" icon="upload" disabled=${busy} onClick=${() => fileRef.current?.click()} data-testid="illust-choose">${t('选择立绘图片')}<//>
      <span class="illustpic__meta" data-testid="illust-meta">
        ${pic
          ? (encoding
            ? t('正在压缩…')
            : prep
              ? t('原始 {sw}×{sh} · 压缩后 {w}×{h} · {kb} KB', { sw: pic.iw, sh: pic.ih, w: prep.width, h: prep.height, kb: kb(prep.blob.size) })
              : t('压缩失败'))
          : t('座位卡的立绘位是竖图（1:2），超出部分按封面裁切，不会拉伸')}
      </span>
    </div>
    <p class="avcrop__hint">${t('长边最多 1536 px，WebP 压缩（约 150–400 KB），上限 {n} MB', { n: Math.round(ILLUST_MAX_BYTES / (1024 * 1024)) })}</p>
    ${ownUrl ? html`<div class="avcrop__own"><span>${t('当前立绘')}</span><span class="illustpic__own"><img src=${ownUrl} alt="" /></span></div>` : null}
  <//>`;
}

/**
 * The 替换立绘 button (beside 替换头像 in the room's tools). Its own dialog is mounted with it.
 * @param {{ class?: string, label?: boolean }} props
 */
export function IllustButton({ class: cls, label = true }) {
  const [open, setOpen] = useState(false);
  return html`<${Fragment}>
    <${Button} variant="secondary" size="sm" icon="upload" square=${!label} class=${cx('illust-entry', cls)} onClick=${() => setOpen(true)}
      title=${t('替换立绘')} aria-label=${label ? undefined : t('替换立绘')} data-testid="illust-open">
      ${label ? t('替换立绘') : null}
    <//>
    <${IllustDialog} open=${open} onClose=${() => setOpen(false)} />
  <//>`;
}
