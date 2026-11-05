// Compat module (stronghold-ui package) — install ONLY when the target has no public/js/ui/accounts.js.
// The original deployment has player accounts kept by its own accounts service (login, avatar, #tag, name cards, the
// same records on every device). This module is the LOCAL stand-in: one "本机账号" per browser, everything in
// localStorage — the profile (avatar, #tag) under `sp.pref.localAccount`, the match records in the game's own
// `sp.pref.stats` (ui/stats.js). Avatars are shared with room members; numbers and records stay local,
// and teammates show no #tag. To connect a real account system later, replace this file with a module that has the same
// exports (AGENTS.md §3.2 lists them and what each must return).
import { html, AvatarFrame, MicroLabel, Icon, Modal, Button } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { render } from '../../vendor/preact.module.js';
import { store, useStore } from '../store.js';
import { data, useData } from '../data.js';
import { cardStore, cardAvatarUrl } from './seatArt.js';
import { t } from '../../../shared/i18n.js';
import { isSharedAvatar, MAX_AVATAR_LENGTH } from '../../../shared/avatar.js';
import { PicturePresets, pictureDataUrl, pictureBlobFromDataUrl } from './picturePresets.js';

/** This module keeps the account in the browser (other modules may check it to word their notes). */
export const LOCAL_ACCOUNT = true;

const KEY = 'sp.pref.localAccount';
const AVATAR_MAX = 160_000; // the stored data: URL (a 128×128 JPEG is ~10 kB)
const listeners = new Set();
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode / quota: kept for this page only */ } };

let profile = null;
function load() {
  if (profile) return profile;
  profile = read() || {};
  if (!/^\d{4}$/.test(profile.tag || '')) { profile.tag = String(1000 + Math.floor(Math.random() * 9000)); write(profile); }
  return profile;
}
function emit() { for (const fn of listeners) { try { fn(); } catch { /* a listener's own problem */ } } }
// (guarded: the module is also imported by Node tests, where there is no window)
globalThis.addEventListener?.('storage', (e) => { if (e.key === KEY) { profile = null; emit(); } });

/** The local account: { id, name (the game's player name), tag, avatar (data: URL or null), card: null, local: true }. */
export function currentAccount() {
  const p = load();
  const name = store.get().me?.name || p.name || t('博士');
  return { id: `local-${p.tag}`, name, tag: p.tag, avatar: typeof p.avatar === 'string' ? p.avatar : null, card: null, local: true };
}
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export async function refreshAccount() { return currentAccount(); }
export async function logoutAccount() { /* a local account cannot log out */ }
/** A fetch timeout signal (some modules import it from here). */
export function timeoutSignal(ms) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }

/** Preact: { me, loaded } — always loaded, `me` is the local account. */
export function useCurrentAccount() {
  const [me, setMe] = useState(currentAccount);
  useEffect(() => {
    const update = () => setMe(currentAccount());
    listeners.add(update);
    const off = store.subscribe ? store.subscribe(update) : null;
    return () => { listeners.delete(update); if (typeof off === 'function') off(); };
  }, []);
  return { me, loaded: true };
}

const isMe = (playerId) => !!playerId && playerId === store.get().me?.playerId;
/** A player's account — only this browser's own player has one here (teammates: null, no #tag). */
export function accountOf(playerId) {
  if (isMe(playerId)) return currentAccount();
  const state = store.get();
  if (!playerId) return null;
  const avatar = state.avatarCache?.[playerId]
    || (state.roomAvatars?.code === state.room?.code ? state.roomAvatars?.avatars?.[playerId] : null);
  return avatar && isSharedAvatar(avatar) ? { avatar, local: false, tag: null, card: null } : null;
}
export function useAccount(playerId) {
  const { me } = useCurrentAccount();
  return isMe(playerId) ? me : accountOf(playerId);
}
/** The small "#1234" after a name when that player has an account. */
export function AccountTag({ playerId }) {
  const info = useAccount(playerId);
  return info?.tag ? html`<span class="acct-tag" title=${t('本机账号 {name}#{tag}', { name: info.name, tag: info.tag })}>#${info.tag}</span>` : null;
}
/** Plain DOM (chats): the #tag after this browser's own name. */
export function decorateChatName(element, playerId) {
  const info = accountOf(playerId);
  if (element && info?.tag && !element.querySelector('.acct-tag')) {
    const tag = document.createElement('span'); tag.className = 'acct-tag'; tag.textContent = `#${info.tag}`; element.append(tag);
  }
  return element;
}

export async function avatarForShare() {
  const avatar = currentAccount().avatar;
  if (isSharedAvatar(avatar)) return avatar;
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(avatar || '') || avatar.length > AVATAR_MAX) return null;
  try {
    const image = await new Promise((resolve, reject) => {
      const picture = new Image(); picture.onload = () => resolve(picture); picture.onerror = reject; picture.src = avatar;
    });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    canvas.getContext('2d').drawImage(image, 0, 0, 128, 128);
    const shared = canvas.toDataURL('image/jpeg', 0.75);
    return shared.length <= MAX_AVATAR_LENGTH ? shared : null;
  } catch { return null; }
}

// ---- avatar file → interactive 1:1 crop ------------------------------------------------------------------------------
const AVATAR_SIZE = 128;
const CROP_VIEW = 240;

export function avatarCropRect({ width, height, zoom = 1, offsetX = 0, offsetY = 0, viewSize = CROP_VIEW }) {
  const sourceWidth = Math.max(1, Number(width) || 1);
  const sourceHeight = Math.max(1, Number(height) || 1);
  const view = Math.max(1, Number(viewSize) || CROP_VIEW);
  const cropZoom = Math.max(1, Number(zoom) || 1);
  const factor = Math.max(view / sourceWidth, view / sourceHeight) * cropZoom;
  const size = Math.min(sourceWidth, sourceHeight) / cropZoom;
  const centerX = sourceWidth / 2 - (Number(offsetX) || 0) / factor;
  const centerY = sourceHeight / 2 - (Number(offsetY) || 0) / factor;
  const x = Math.max(0, Math.min(sourceWidth - size, centerX - size / 2));
  const y = Math.max(0, Math.min(sourceHeight - size, centerY - size / 2));
  return { x, y, size, factor, view };
}

function loadAvatarImage(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, url, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    image.src = url;
  });
}

function AvatarCropDialog({ file, onClose, onDone }) {
  const [source, setSource] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState(null);
  const drag = useRef(null);
  useEffect(() => {
    let active = true;
    let loaded = null;
    setSource(null);
    setError(null);
    loadAvatarImage(file).then((next) => {
      loaded = next;
      if (active) setSource(next);
      else URL.revokeObjectURL(next.url);
    }).catch(() => { if (active) setError(t('图片读取失败')); });
    return () => {
      active = false;
      if (loaded) URL.revokeObjectURL(loaded.url);
    };
  }, [file]);
  const clampOffset = (next, nextZoom = zoom) => {
    if (!source) return next;
    const rect = avatarCropRect({ width: source.width, height: source.height, zoom: nextZoom });
    const imageWidth = source.width * rect.factor;
    const imageHeight = source.height * rect.factor;
    return {
      x: Math.max(-(imageWidth - CROP_VIEW) / 2, Math.min((imageWidth - CROP_VIEW) / 2, next.x)),
      y: Math.max(-(imageHeight - CROP_VIEW) / 2, Math.min((imageHeight - CROP_VIEW) / 2, next.y)),
    };
  };
  const pointerDown = (event) => {
    if (!source) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const width = event.currentTarget.getBoundingClientRect().width || CROP_VIEW;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offset, scale: CROP_VIEW / width };
  };
  const pointerMove = (event) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    setOffset(clampOffset({ x: state.offset.x + (event.clientX - state.x) * state.scale,
      y: state.offset.y + (event.clientY - state.y) * state.scale }));
  };
  const pointerUp = (event) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };
  const moveByKey = (event) => {
    if (!source || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const distance = event.shiftKey ? 24 : 8;
    const dx = event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0;
    const dy = event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0;
    setOffset(clampOffset({ x: offset.x + dx, y: offset.y + dy }));
  };
  const save = () => {
    if (!source) return;
    try {
      const rect = avatarCropRect({ width: source.width, height: source.height, zoom, offsetX: offset.x, offsetY: offset.y });
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = AVATAR_SIZE;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas unavailable');
      context.drawImage(source.image, rect.x, rect.y, rect.size, rect.size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      onDone(canvas.toDataURL('image/jpeg', 0.86));
    } catch { setError(t('图片转换失败')); }
  };
  const rect = source ? avatarCropRect({ width: source.width, height: source.height, zoom }) : null;
  const renderedWidth = rect ? source.width * rect.factor / CROP_VIEW * 100 : 0;
  const renderedHeight = rect ? source.height * rect.factor / CROP_VIEW * 100 : 0;
  return html`<${Modal} open=${true} title=${t('裁剪头像')} class='lacct-crop-modal' width='min(92vw, 430px)' onClose=${onClose}
      actions=${html`<${Button} variant='secondary' onClick=${onClose}>${t('取消')}<//><${Button} variant='primary' disabled=${!source} onClick=${save}>${t('使用头像')}<//>`}>
    <div class='lacct-crop'>
      ${source ? html`<div class='lacct-crop__viewport' data-testid='avatar-crop' role='region' tabindex='0'
          aria-label=${t('头像裁剪区域')} onKeyDown=${moveByKey}
          onPointerDown=${pointerDown} onPointerMove=${pointerMove} onPointerUp=${pointerUp} onPointerCancel=${pointerUp}>
        <img class='lacct-crop__image' src=${source.url} alt='' draggable=${false}
          style=${`width:${renderedWidth}%;height:${renderedHeight}%;left:${50 + offset.x / CROP_VIEW * 100}%;top:${50 + offset.y / CROP_VIEW * 100}%;transform:translate(-50%,-50%)`} />
        <span class='lacct-crop__frame' aria-hidden='true'></span>
      </div>` : html`<${MicroLabel}>${error || t('图片处理中…')}<//>`}
      <label class='lacct-crop__zoom'>${t('缩放')}<input data-testid='avatar-crop-zoom' type='range' min='1' max='3' step='0.01' value=${zoom}
        disabled=${!source} onInput=${(event) => { const next = Number(event.currentTarget.value) || 1; setZoom(next); setOffset(clampOffset(offset, next)); }} /></label>
      <p class='lacct-crop__hint'>${t('拖动图片调整位置，使用滑块缩放；方向键也可微调')}</p>
      ${error && source ? html`<p class='lacct-crop__error'>${error}</p>` : null}
    </div>
  <//>`;
}

// ---- the panel (opened from the hub's top-right chip) -------------------------------------------------------------------
function ensureStyle() {
  if (document.getElementById('local-acct-style')) return;
  const st = document.createElement('style');
  st.id = 'local-acct-style';
  st.textContent = `.acct-tag{margin-left:.06em;font-size:.8em;font-weight:600;opacity:.62;letter-spacing:.02em}
.lacct{display:flex;flex-direction:column;gap:.16rem;min-width:min(5.6rem,86vw)}
.lacct__who{display:flex;align-items:center;gap:.16rem}
.lacct__pic{width:.9rem;height:.9rem;flex:none;display:grid;place-items:center;overflow:hidden;border:2px solid var(--mint-700,#2b7);background:#101614;font-size:.4rem;font-weight:900}
.lacct__pic img{width:100%;height:100%;object-fit:cover}
.lacct__name{font-size:.3rem;font-weight:900}
.lacct__note{margin:0;font-size:.17rem;line-height:1.5;opacity:.72}
.lacct__btns{display:flex;flex-wrap:wrap;gap:.1rem}
.lacct-crop{display:flex;flex-direction:column;align-items:center;gap:16px}
.lacct-crop__viewport{position:relative;width:min(240px,calc(100vw - 80px));aspect-ratio:1;overflow:hidden;background:var(--surface-1,#101614);border:1px solid var(--mint-700,#2b7);touch-action:none;cursor:grab}
.lacct-crop__viewport:active{cursor:grabbing}
.lacct-crop__viewport:focus-visible{outline:2px solid var(--mint-300,#8ff);outline-offset:3px}
.lacct-crop__image{position:absolute;max-width:none;user-select:none;pointer-events:none;transform-origin:center}
.lacct-crop__frame{position:absolute;inset:0;border:2px solid var(--mint-300,#8ff);pointer-events:none}
.lacct-crop__zoom{display:flex;align-items:center;gap:12px;width:min(240px,calc(100vw - 80px));font-size:16px}
.lacct-crop__zoom input{flex:1;min-width:0;min-height:36px;accent-color:var(--mint-400,#6fc)}
.lacct-crop__hint,.lacct-crop__error{width:min(280px,calc(100vw - 80px));margin:0;font-size:14px;line-height:1.5}
.lacct-crop__hint{color:var(--text)}.lacct-crop__error{color:var(--red,#f66)}
.lacct-crop-modal .btn{min-height:44px;font-size:14px}`;
  document.head.appendChild(st);
}
let host = null;
function AccountPanel({ onStats, onClose }) {
  const { me } = useCurrentAccount();
  const [cropFile, setCropFile] = useState(null);
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      setCropFile(f);
    };
    input.click();
  };
  const saveAvatar = (avatar) => {
    if (avatar.length > AVATAR_MAX) return;
    profile = { ...load(), avatar };
    write(profile);
    emit();
    setCropFile(null);
  };
  const clear = () => { profile = { ...load(), avatar: null }; write(profile); emit(); };
  if (cropFile) return html`<${AvatarCropDialog} file=${cropFile} onClose=${() => setCropFile(null)} onDone=${saveAvatar} />`;
  return html`<${Modal} open=${true} title=${t('本机账号')} micro="LOCAL ACCOUNT" onClose=${onClose}>
    <div class="lacct">
      <div class="lacct__who">
        <span class="lacct__pic">${me.avatar ? html`<img src=${me.avatar} alt="" />` : [...me.name][0]}</span>
        <span><b class="lacct__name">${me.name}<span class="acct-tag">#${me.tag}</span></b><br /><${MicroLabel}>${t('LOCAL · 本机')}<//></span>
      </div>
      <p class="lacct__note">${t('头像会分享给同房间玩家；编号和战绩仍保存在本机浏览器中。换设备或清除浏览器数据后，本机资料不会保留。')}</p>
      <div class="lacct__btns">
        <${Button} size="sm" variant="secondary" icon="edit" onClick=${pick}>${t('更换头像')}<//>
        ${me.avatar ? html`<${Button} size="sm" variant="ghost" onClick=${clear}>${t('移除头像')}<//>` : null}
        ${onStats ? html`<${Button} size="sm" variant="primary" icon="chart" onClick=${() => { onClose(); onStats(); }}>${t('统计数据')}<//>` : null}
      </div>
      <${PicturePresets} scope=${me.id} kind="avatar" canSave=${!!me.avatar}
        capture=${async () => { const avatar = await avatarForShare(); if (!avatar) throw new Error('No avatar'); return { blob: pictureBlobFromDataUrl(avatar) }; }}
        onUse=${async preset => saveAvatar(await pictureDataUrl(preset.blob))} />
    </div>
  <//>`;
}
/** Open the account panel ({ onStats } adds the 统计数据 button). */
export function openAccountPanel(opts = {}) {
  ensureStyle();
  if (!host) { host = document.createElement('div'); host.className = 'local-acct-host'; document.body.appendChild(host); }
  const close = () => render(null, host);
  render(html`<${AccountPanel} onStats=${opts.onStats} onClose=${close} />`, host);
}

/** The hub's top-right chip: avatar + name #tag; a click opens the account panel (with 统计数据). */
export function AccountMeChip({ player, onStats }) {
  const { me } = useCurrentAccount();
  useData('assets');
  const card = useStore(s => s, Object.is, cardStore);
  useEffect(ensureStyle, []);
  const name = player?.name || me.name || t('博士');
  return html`<button type="button" class="me-chip me-chip--btn stats-entry" onClick=${() => openAccountPanel({ onStats })} title=${t('本机账号 · 统计数据')} aria-label=${t('本机账号')}>
    <${AvatarFrame} size="sm" name=${name} seat=${0} self=${true} src=${me.avatar || cardAvatarUrl(card.card, card.cardSkin, data.get('assets')) || undefined}
      m=${data.get('assets')} charId=${!me.avatar ? card.card : null} skin=${card.cardSkin} />
    <span class="me-chip__text"><span class="me-chip__name">${name}<span class="acct-tag">#${me.tag}</span></span><${MicroLabel}>${t('LOCAL · 本机账号')}<//></span>
    <${Icon} name="user" class="me-chip__stats" />
  </button>`;
}

/** Nothing to start: no service. */
export function startAccounts() {}
