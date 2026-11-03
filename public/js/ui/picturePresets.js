import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, confirmDialog } from './components.js';
import { normalizeCardArt } from './cardArt.js';
import { t } from '../../../shared/i18n.js';
import { ILLUST_MAX_BYTES } from '../../../shared/illustration.js';
import { MAX_AVATAR_LENGTH } from '../../../shared/avatar.js';

export const PICTURE_PRESET_SLOTS = 3;
const channel = typeof window !== 'undefined' && window === globalThis && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sp-picture-presets') : null;
const keyOf = (scope, kind, slot) => {
  if (typeof scope !== 'string' || !scope || scope.length > 80 || !['avatar', 'illust'].includes(kind)
    || !Number.isInteger(slot) || slot < 0 || slot >= PICTURE_PRESET_SLOTS) throw new Error('Invalid picture preset key');
  return scope + ':' + kind + ':' + slot;
};
export function validPicturePreset(value, kind) {
  return ['avatar', 'illust'].includes(kind) && !!value && value.blob instanceof Blob && value.blob.size > 0
    && value.blob.size <= (kind === 'avatar' ? MAX_AVATAR_LENGTH : ILLUST_MAX_BYTES)
    && ['image/jpeg', 'image/png', 'image/webp'].includes(value.blob.type);
}
function transaction(mode, makeRequests) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const opening = indexedDB.open('sp-picture-presets', 1);
    let blocked = false;
    opening.onupgradeneeded = () => { if (!opening.result.objectStoreNames.contains('pictures')) opening.result.createObjectStore('pictures'); };
    opening.onerror = () => reject(opening.error);
    opening.onblocked = () => { blocked = true; reject(new Error('Preset database blocked')); };
    opening.onsuccess = () => {
      const connection = opening.result;
      if (blocked) { connection.close(); return; }
      try {
        const operation = connection.transaction('pictures', mode);
        const requests = makeRequests(operation.objectStore('pictures'));
        operation.oncomplete = () => { connection.close(); resolve(requests.map(request => request.result)); };
        operation.onerror = operation.onabort = () => { connection.close(); reject(operation.error || new Error('Preset storage failed')); };
      } catch (error) { connection.close(); reject(error); }
    };
  });
}
export async function readPicturePresets(scope, kind) {
  const records = await transaction('readonly', table => Array.from({ length: PICTURE_PRESET_SLOTS }, (_, slot) => table.get(keyOf(scope, kind, slot))));
  return records.map(record => validPicturePreset(record, kind) ? { blob: record.blob, frame: normalizeCardArt(record.frame) } : null);
}
export async function savePicturePreset(scope, kind, slot, value) {
  const key = keyOf(scope, kind, slot);
  if (!validPicturePreset(value, kind)) throw new Error('Invalid picture preset');
  await transaction('readwrite', table => [table.put({ blob: value.blob, frame: normalizeCardArt(value.frame) }, key)]);
  channel?.postMessage({ scope, kind });
}
export async function clearPicturePreset(scope, kind, slot) {
  await transaction('readwrite', table => [table.delete(keyOf(scope, kind, slot))]);
  channel?.postMessage({ scope, kind });
}
export function pictureDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
}
export function pictureBlobFromDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value || '');
  if (!match) throw new Error('Invalid picture data URL');
  const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
}
function ensureCss() {
  if (document.querySelector('link[data-picture-presets]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/css/picture-presets.css'; link.dataset.picturePresets = '1'; document.head.appendChild(link);
}
export function PicturePresets({ scope, kind, capture, onUse, disabled = false, canSave = true, onBusyChange = null }) {
  ensureCss();
  const [records, setRecords] = useState([null, null, null]), [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const generation = useRef(0), urls = useRef([]), alive = useRef(true);
  const reload = async () => {
    const current = ++generation.current;
    try {
      const values = await readPicturePresets(scope, kind);
      if (!alive.current || current !== generation.current) return;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
      setRecords(values.map(value => {
        if (!value) return null;
        const url = URL.createObjectURL(value.blob); urls.current.push(url); return { ...value, url };
      }));
      setLoaded(true); setError('');
    } catch { if (alive.current && current === generation.current) setError(t('预设操作失败，请检查浏览器存储空间、权限或网络后重试')); }
  };
  useEffect(() => {
    alive.current = true; setLoaded(false); void reload();
    const changed = event => { if (event.data?.scope === scope && event.data?.kind === kind) void reload(); };
    channel?.addEventListener('message', changed);
    return () => { alive.current = false; generation.current++; channel?.removeEventListener('message', changed); for (const url of urls.current) URL.revokeObjectURL(url); urls.current = []; };
  }, [scope, kind]);
  const operate = async action => {
    if (busy || disabled || !loaded) return;
    const record = records[selected];
    setBusy(true); onBusyChange?.(true); setError(''); setStatus('');
    try {
      if (action === 'save' && record && !await confirmDialog({ title: t('覆盖预设'), text: t('覆盖预设 {n}？原图片和取景将被替换。', { n: selected + 1 }), danger: true })) return;
      if (action === 'clear' && !await confirmDialog({ title: t('清空预设'), text: t('清空预设 {n}？当前使用的图片不会改变。', { n: selected + 1 }), danger: true })) return;
      if (action === 'save') { const value = await capture(); await savePicturePreset(scope, kind, selected, value); await reload(); setStatus(t('预设 {n} 已保存', { n: selected + 1 })); }
      else if (action === 'clear') { await clearPicturePreset(scope, kind, selected); await reload(); setStatus(t('预设 {n} 已清空', { n: selected + 1 })); }
      else if (record) { await onUse(record); if (alive.current) setStatus(t('已使用预设 {n}', { n: selected + 1 })); }
    } catch { if (alive.current) setError(t('预设操作失败，请检查浏览器存储空间、权限或网络后重试')); }
    finally { if (alive.current) { setBusy(false); onBusyChange?.(false); } }
  };
  const locked = busy || disabled || !loaded;
  return html`<section class=${`picture-presets picture-presets--${kind}`} data-testid=${kind + '-presets'} aria-label=${t('本机预设')}>
    <h3>${t('本机预设')}</h3><p>${t('选择预设可预览，点击使用后切换；3 个槽位只保存在这台设备。')}</p>
    <div class="picture-presets__slots" role="group" aria-label=${t('本机预设')}>
      ${records.map((record, slot) => html`<button key=${slot} type="button" class=${`picture-presets__slot${selected === slot ? ' is-selected' : ''}`} disabled=${locked}
        aria-pressed=${selected === slot} data-testid=${kind + '-preset-' + slot} onClick=${() => { setSelected(slot); setStatus(''); }}>
        <span class="picture-presets__image">${record ? html`<img src=${record.url} alt="" draggable=${false}
          style=${kind === 'illust' ? `transform:translate(${record.frame.ox}%,${record.frame.oy}%) scale(${record.frame.zoom})` : undefined} />` : html`<${Icon} name="image" />`}</span>
        <span>${t('预设 {n}', { n: slot + 1 })}</span><small>${record ? t('已保存') : t('空槽位')}</small>
      </button>`)}
    </div>
    <div class="picture-presets__actions">
      <${Button} size="sm" variant="secondary" disabled=${locked || !canSave} data-testid=${kind + '-preset-save'} onClick=${() => operate('save')}>${t('保存当前到此槽')}<//>
      <${Button} size="sm" disabled=${locked || !records[selected]} data-testid=${kind + '-preset-use'} onClick=${() => operate('use')}>${t('使用此预设')}<//>
      <${Button} size="sm" variant="ghost" disabled=${locked || !records[selected]} data-testid=${kind + '-preset-clear'} onClick=${() => operate('clear')}>${t('清空')}<//>
    </div>
    ${error ? html`<p role="alert" class="picture-presets__error">${error}</p>${!loaded ? html`<${Button} size="sm" onClick=${reload}>${t('重试')}<//>` : null}` : html`<p role="status">${busy ? t('正在处理…') : status}</p>`}
  </section>`;
}
