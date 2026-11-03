import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from './components.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';
import { ILLUST_SOURCE_MAX_BYTES, encodeIllust, uploadOwnIllust, removeOwnIllust, useOwnIllust } from './customIllust.js';
import { ensureCardArtCss } from './cardArt.js';

export function IllustDialog({ onClose }) {
  ensureCardArtCss();
  const own = useOwnIllust(), fileRef = useRef(null), generation = useRef(0);
  const [picture, setPicture] = useState(null), [busy, setBusy] = useState(false), [encoding, setEncoding] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => () => { if (picture?.url) URL.revokeObjectURL(picture.url); }, [picture]);
  const choose = async event => {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > ILLUST_SOURCE_MAX_BYTES) { setError(t('请选择小于 48 MB 的立绘图片')); return; }
    const current = ++generation.current, source = URL.createObjectURL(file);
    setEncoding(true); setError('');
    try {
      const image = new Image(); image.src = source; await image.decode();
      if (image.naturalWidth < 64 || image.naturalHeight < 64 || Math.max(image.naturalWidth / image.naturalHeight, image.naturalHeight / image.naturalWidth) > 3) throw new Error('dimensions');
      const prepared = await encodeIllust(image);
      if (!prepared) throw new Error('encoding');
      if (generation.current === current) setPicture({ ...prepared, url: URL.createObjectURL(prepared.blob) });
    } catch { if (generation.current === current) setError(t('立绘处理失败，请选择宽高均至少 64 px、比例不超过 3:1 的图片')); }
    finally { URL.revokeObjectURL(source); if (generation.current === current) setEncoding(false); }
  };
  const save = async remove => {
    if (busy || !remove && !picture) return;
    setBusy(true); setError('');
    try {
      if (remove) await removeOwnIllust(); else await uploadOwnIllust(picture.blob);
      toast(remove ? t('自定义立绘已移除') : t('自定义立绘已更新'), 'info'); onClose();
    } catch { setError(t('立绘保存失败，请稍后重试')); }
    finally { setBusy(false); }
  };
  return html`<${Modal} open=${true} title=${t('替换立绘')} width="min(620px, 94vw)" class="illust-picker" onClose=${() => { if (!busy) onClose(); }}
      actions=${html`${own ? html`<${Button} variant="secondary" disabled=${busy || encoding} data-testid="illust-remove" onClick=${() => save(true)}>${t('移除自定义立绘')}<//>` : null}
        <${Button} disabled=${busy} onClick=${onClose}>${t('取消')}<//>
        <${Button} variant="primary" disabled=${!picture || busy || encoding} loading=${busy} data-testid="illust-confirm" onClick=${() => save(false)}>${t('确认使用')}<//>`}>
    <p>${t('图片会压缩后分享给同房间成员，按 1:2 竖框裁切显示，不会拉伸。')}</p>
    <div class="illust-picker__preview">${picture || own ? html`<img src=${picture?.url || own} alt="" />` : html`<span>${t('还没有选择立绘')}</span>`}</div>
    <input type="file" accept="image/*" ref=${fileRef} hidden data-testid="illust-file" onChange=${choose} />
    <${Button} disabled=${busy || encoding} data-testid="illust-choose" onClick=${() => fileRef.current.click()}>${t('选择立绘图片')}<//>
    <p role="status">${encoding ? t('正在压缩…') : picture ? `${picture.width} × ${picture.height} · ${Math.ceil(picture.blob.size / 1024)} KB` : t('长边最多 1536 px，压缩后不超过 2 MB')}</p>
    ${error ? html`<p class="illust-picker__error" role="alert">${error}</p>` : null}
  <//>`;
}
