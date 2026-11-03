import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from './components.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';
import { ILLUST_SOURCE_MAX_BYTES, encodeIllust, uploadOwnIllust, removeOwnIllust, useOwnIllust, ownIllustSnapshot } from './customIllust.js';
import { ensureCardArtCss, cardArtOf, setCardArt, useArtGestures } from './cardArt.js';
import { illustrationCropRect } from '../../../shared/illustration.js';
import { PicturePresets } from './picturePresets.js';
import { currentAccount } from './accounts.js';

export function IllustDialog({ onClose }) {
  ensureCardArtCss();
  const own = useOwnIllust(), fileRef = useRef(null), generation = useRef(0);
  const [picture, setPicture] = useState(null), [busy, setBusy] = useState(false), [encoding, setEncoding] = useState(false);
  const [decoding, setDecoding] = useState(false), [prepared, setPrepared] = useState(null), [frame, setFrame] = useState({ zoom: 1, ox: 0, oy: 0 });
  const preview = useRef(null);
  const [error, setError] = useState('');
  const update = next => {
    const rect = illustrationCropRect({ width: picture?.width, height: picture?.height, ...next });
    const value = { zoom: rect.zoom, ox: rect.ox, oy: rect.oy }; setFrame(value); return value;
  };
  const gestures = useArtGestures(preview, frame, update, { enabled: !!picture && !busy && !decoding, minimum: 1, maximum: 3 });
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => () => { if (picture?.url) URL.revokeObjectURL(picture.url); }, [picture]);
  useEffect(() => {
    if (!picture) return;
    let active = true;
    setEncoding(true); setPrepared(null);
    const timer = setTimeout(async () => {
      const rect = illustrationCropRect({ width: picture.width, height: picture.height, ...frame });
      const encoded = await encodeIllust(picture.image, rect);
      if (!active) return;
      setPrepared(encoded); setEncoding(false);
      if (!encoded) setError(t('立绘处理失败，请选择宽高均至少 64 px、比例不超过 3:1 的图片'));
    }, 120);
    return () => { active = false; clearTimeout(timer); };
  }, [picture, frame]);
  const choose = async event => {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > ILLUST_SOURCE_MAX_BYTES) { setError(t('请选择小于 48 MB 的立绘图片')); return; }
    const current = ++generation.current, source = URL.createObjectURL(file);
    setDecoding(true); setError('');
    let retained = false;
    try {
      const image = new Image(); image.src = source; await image.decode();
      if (image.naturalWidth < 64 || image.naturalHeight < 64 || Math.max(image.naturalWidth / image.naturalHeight, image.naturalHeight / image.naturalWidth) > 3) throw new Error('dimensions');
      if (generation.current === current) {
        setPicture({ image, url: source, width: image.naturalWidth, height: image.naturalHeight });
        setFrame({ zoom: 1, ox: 0, oy: 0 }); retained = true;
      }
    } catch { if (generation.current === current) setError(t('立绘处理失败，请选择宽高均至少 64 px、比例不超过 3:1 的图片')); }
    finally { if (!retained) URL.revokeObjectURL(source); if (generation.current === current) setDecoding(false); }
  };
  const save = async remove => {
    if (busy || !remove && !picture) return;
    setBusy(true); setError('');
    try {
      if (remove) await removeOwnIllust();
      else {
        const rect = illustrationCropRect({ width: picture.width, height: picture.height, ...frame });
        const encoded = await encodeIllust(picture.image, rect);
        if (!encoded) throw new Error('encoding');
        await uploadOwnIllust(encoded.blob); setCardArt('custom', {});
      }
      toast(remove ? t('自定义立绘已移除') : t('自定义立绘已更新'), 'info'); onClose();
    } catch { setError(t('立绘保存失败，请稍后重试')); }
    finally { setBusy(false); }
  };
  const rect = picture ? illustrationCropRect({ width: picture.width, height: picture.height, ...frame }) : null;
  return html`<${Modal} open=${true} title=${t('替换立绘')} width="min(620px, 94vw)" class="illust-picker" onClose=${() => { if (!busy) onClose(); }}
      actions=${html`${own ? html`<${Button} variant="secondary" disabled=${busy || decoding} data-testid="illust-remove" onClick=${() => save(true)}>${t('移除自定义立绘')}<//>` : null}
        <${Button} disabled=${busy} onClick=${onClose}>${t('取消')}<//>
        <${Button} variant="primary" disabled=${!prepared || busy || encoding || decoding} loading=${busy} data-testid="illust-confirm" onClick=${() => save(false)}>${t('确认使用')}<//>`}>
    <p>${t('导入时可拖动取景，使用滑块、滚轮或双指缩放；确认后按 1:2 裁切并分享给同房间成员。')}</p>
    <div class=${`illust-picker__preview${picture ? ' is-editable' : ''}`} ref=${preview} data-testid="illust-crop"
      tabindex=${picture ? '0' : undefined} role="region" aria-label=${t('拖拽调整位置')} ...${gestures}>
      ${picture ? html`<img src=${picture.url} alt="" draggable=${false} style=${`position:absolute;max-width:none;width:${picture.width / rect.width * 100}%;height:${picture.height / rect.height * 100}%;left:${50 + frame.ox}%;top:${50 + frame.oy}%;transform:translate(-50%,-50%);object-fit:fill`} />`
        : own ? html`<img src=${own} alt="" />` : html`<span>${t('还没有选择立绘')}</span>`}
    </div>
    ${picture ? html`<label class="illust-picker__zoom">${t('缩放')} <input type="range" min="1" max="3" step="0.01" value=${frame.zoom}
      disabled=${busy || decoding} data-testid="illust-crop-zoom" onInput=${event => update({ ...frame, zoom: Number(event.currentTarget.value) })} /></label>
      <${Button} disabled=${busy || decoding} data-testid="illust-crop-reset" onClick=${() => update({ zoom: 1, ox: 0, oy: 0 })}>${t('重置')}<//>` : null}
    <input type="file" accept="image/*" ref=${fileRef} hidden data-testid="illust-file" onChange=${choose} />
    <${Button} disabled=${busy || decoding} data-testid="illust-choose" onClick=${() => fileRef.current.click()}>${t('选择立绘图片')}<//>
    <p role="status">${encoding || decoding ? t('正在压缩…') : prepared ? `${prepared.width} × ${prepared.height} · ${Math.ceil(prepared.blob.size / 1024)} KB` : t('长边最多 1536 px，压缩后不超过 2 MB')}</p>
    <${PicturePresets} scope=${currentAccount().id} kind="illust" disabled=${busy || decoding || encoding} canSave=${!!(picture ? prepared : own)} onBusyChange=${setBusy}
      capture=${async () => {
        if (!picture) { const current = await ownIllustSnapshot(); return current ? { ...current, frame: cardArtOf('custom') } : null; }
        const area = illustrationCropRect({ width: picture.width, height: picture.height, ...frame });
        const encoded = await encodeIllust(picture.image, area); return encoded ? { blob: encoded.blob } : null;
      }}
      onUse=${async preset => { await uploadOwnIllust(preset.blob); setCardArt('custom', preset.frame); toast(t('自定义立绘已更新'), 'info'); onClose(); }} />
    ${error ? html`<p class="illust-picker__error" role="alert">${error}</p>` : null}
  <//>`;
}
