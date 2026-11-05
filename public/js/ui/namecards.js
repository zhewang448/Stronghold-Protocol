// Waiting-room nameplates; other existing account surfaces stay opt-out.
import { useState, useRef, useEffect, useMemo } from '../../vendor/hooks.module.js';
import { html, Modal, Button } from './components.js';
import { createStore, loadPref, savePref, useStore } from '../store.js';
import { data, useData } from '../data.js';
import { bondPlanStore } from './bondPlan.js';
import { NAMECARD_BONDS, NAMECARD_CAMPS, normalizeNamecard, namecardSource, resolveNamecard, dragNamecard } from '../../../shared/namecards.js';
import { t } from '../../../shared/i18n.js';
import { NAMECARD_LABELS } from './namecardLabels.js';

export const namecardStore = createStore({ value: normalizeNamecard(loadPref('room.namecard', null)), open: false, supported: false, sync: 'idle' });
export const openNamecardPicker = () => namecardStore.set({ open: true });
export const cardUrl = () => null;
export const nameCardLayer = () => null;
export const loadNamecards = () => Promise.resolve([]);
export function setNamecard(value) {
  const next = normalizeNamecard(value);
  savePref('room.namecard', next);
  namecardStore.set({ value: next });
}
export function NameCardLayer({ card, waitingRoom = false }) {
  useData('assets');
  const [bad, setBad] = useState(null);
  if (!waitingRoom || !card?.resolved) return null;
  const src = namecardSource(data.get('assets'), card.resolved);
  if (!src || bad === src) return null;
  const emblem = card.resolved.startsWith('camp:');
  return html`<span class=${`room-nc${emblem ? ' room-nc--emblem' : ''}`} aria-hidden="true"><img src=${src} alt="" onError=${() => setBad(src)}
    style=${emblem ? undefined : { objectPosition: `${card.x}% ${card.y}%`, transformOrigin: `${card.x}% ${card.y}%`, transform: `scale(${card.zoom / 100})` }} /></span>`;
}
function entries(manifest, skinNames) {
  const list = NAMECARD_CAMPS.filter(key => namecardSource(manifest, 'camp:' + key)).map(key => ({ id: 'camp:' + key, name: key, src: namecardSource(manifest, 'camp:' + key), group: 'camp' }));
  for (const key of ['prototype', 'core', 'hard', 'abyss']) if (namecardSource(manifest, 'loading:' + key)) list.push({ id: 'loading:' + key, name: key, src: namecardSource(manifest, 'loading:' + key), group: 'loading' });
  for (const entry of Object.values(manifest?.chars || {})) for (const [id, skin] of Object.entries(entry.skins || {})) {
    const src = namecardSource(manifest, 'skin:' + id);
    if (src) list.push({ id: 'skin:' + id, name: skin.name || skinNames[id] || id, src, group: 'skin' });
  }
  return list;
}
export function NameCardPickerHost() {
  useData('assets', 'bonds', 'skins');
  const state = useStore(s => s, Object.is, namecardStore);
  const bond = useStore(s => s.bondId, Object.is, bondPlanStore);
  const [tab, setTab] = useState('loading');
  const drag = useRef(null), aspect = useRef(1);
  const manifest = data.get('assets'), value = state.value, skinCatalogue = data.get('skins');
  const list = useMemo(() => entries(manifest, Object.fromEntries(Object.values(skinCatalogue?.chars || {}).flat().map(s => [s.id, s.name]))), [manifest, skinCatalogue]);
  const selected = resolveNamecard(value, bond, manifest);
  const src = namecardSource(manifest, selected.resolved);
  useEffect(() => {
    aspect.current = 1;
    if (!src) return;
    const img = new Image();
    img.onload = () => { if (img.naturalWidth) aspect.current = img.naturalHeight / img.naturalWidth; };
    img.src = src;
    return () => { img.onload = null; };
  }, [src]);
  const caption = entry => {
    if (NAMECARD_LABELS[entry.id]) return t(NAMECARD_LABELS[entry.id]);
    if (entry.group !== 'camp') return entry.name;
    const found = Object.entries(NAMECARD_BONDS).find(([, key]) => key === entry.id.slice(5));
    return found ? data.lookup('bonds', found[0])?.name || entry.name : entry.name;
  };
  const change = patch => setNamecard({ ...value, ...patch });
  const adjustable = selected.resolved && !selected.resolved.startsWith('camp:');
  return html`<${Modal} open=${state.open} title=${t('名片底图')} class="room-namecard-picker" onClose=${() => namecardStore.set({ open: false })}
    actions=${html`<${Button} onClick=${() => namecardStore.set({ open: false })}>${t('完成')}<//>`}>
    <div class="room-nc-modes"><${Button} active=${value.mode === 'auto'} onClick=${() => change({ mode: 'auto', id: '' })}>${t('跟随预选盟约')}<//>
      <${Button} active=${value.mode === 'none'} onClick=${() => change({ mode: 'none', id: '' })}>${t('无底图')}<//></div>
    ${!state.supported ? html`<p role="status">${t('当前服务器不支持名片底图；选择会保存在本机。')}</p>` : null}
    ${value.mode === 'auto' ? html`<p>${selected.resolved ? t('底图随预选盟约变化，仅显示在等待室名牌。') : !bond ? t('尚未预选盟约，当前不显示底图。') : t('当前盟约没有可用底图，暂不显示。')}</p>` : null}
    <div class="room-nc-preview rseat__plate" tabindex=${adjustable ? 0 : -1}
      aria-label=${adjustable ? t('拖动调整位置') : t('名片底图预览')}
      onKeyDown=${e => { if (!adjustable) return; const step = e.shiftKey ? 5 : 1; const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }; if (moves[e.key]) { e.preventDefault(); change({ x: Math.max(0, Math.min(100, value.x + moves[e.key][0])), y: Math.max(0, Math.min(100, value.y + moves[e.key][1])) }); } }}
      onPointerDown=${e => { if (adjustable && e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, frame: value }; } }}
      onPointerMove=${e => { if (drag.current) { const box = e.currentTarget.getBoundingClientRect(); change(dragNamecard(drag.current.frame, e.clientX - drag.current.px, e.clientY - drag.current.py, { width: box.width, height: box.height, aspect: aspect.current })); } }}
      onPointerUp=${() => { drag.current = null; }} onPointerCancel=${() => { drag.current = null; }}>
      <${NameCardLayer} waitingRoom=${true} card=${selected} /><strong>${t('名片底图预览')}</strong></div>
    ${adjustable ? html`<label class="room-nc-zoom">${t('缩放')} <input type="range" min="100" max="300" value=${value.zoom} onInput=${e => change({ zoom: +e.currentTarget.value })} /><span>${value.zoom}%</span>
      <${Button} size="sm" onClick=${() => change({ x: 50, y: 50, zoom: 100 })}>${t('重置')}<//></label>` : null}
    <div class="room-nc-tabs">${[['loading', t('载入图')], ['camp', t('阵营与组织')], ['skin', t('皮肤底图')]].map(([key, label]) => html`<${Button} size="sm" active=${tab === key} onClick=${() => setTab(key)}>${label}<//>`)}</div>
    <div class="room-nc-grid">${list.filter(e => e.group === tab).map(entry => html`<button type="button" class=${value.mode === 'manual' && value.id === entry.id ? 'is-on' : ''} onClick=${() => change({ mode: 'manual', id: entry.id, x: 50, y: 50, zoom: 100 })}>
      <img src=${entry.src} alt="" loading="lazy" /><span>${caption(entry)}</span></button>`)}</div>
    ${!list.some(e => e.group === tab) ? html`<p>${t('此分类暂无已安装底图。')}</p>` : null}
  <//>`;
}
export function installNamecardSync({ net }) {
  let supported = false, last = '', timer, disposed = false, inFlight = false, generation = 0;
  const flush = async () => {
    if (!supported || disposed || inFlight || net.status !== 'online') return;
    const value = namecardStore.get().value, key = JSON.stringify(value);
    if (key === last) return;
    const sentGeneration = generation;
    let retry = false;
    inFlight = true;
    try { await net.request('room.namecard', { selection: value }); if (sentGeneration === generation) { last = key; namecardStore.set({ sync: 'synced' }); } }
    catch (e) { namecardStore.set({ sync: 'error' }); retry = ['RATE', 'OFFLINE', 'TIMEOUT'].includes(e.code); }
    finally { inFlight = false; if (retry) schedule(1500); else if (key !== JSON.stringify(namecardStore.get().value) || sentGeneration !== generation) schedule(); }
  };
  const schedule = (ms = 200) => { clearTimeout(timer); timer = setTimeout(flush, ms); };
  const offWelcome = net.on('welcome', msg => { generation++; supported = msg?.uiMigration?.namecards === true; namecardStore.set({ supported }); last = ''; schedule(50); });
  const offStore = namecardStore.subscribe((s, prev) => { if (s.value !== prev.value) schedule(); });
  return { flush, dispose() { disposed = true; clearTimeout(timer); offWelcome(); offStore(); } };
}
