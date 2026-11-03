// Compat module (stronghold-ui package) — install ONLY when the target has no public/js/ui/accounts.js.
// The original deployment has player accounts kept by its own accounts service (login, avatar, #tag, name cards, the
// same records on every device). This module is the LOCAL stand-in: one "本机账号" per browser, everything in
// localStorage — the profile (avatar, #tag) under `sp.pref.localAccount`, the match records in the game's own
// `sp.pref.stats` (ui/stats.js). Only the player on this browser has an account here: teammates show no #tag. The avatar
// is the exception: 更换头像 opens the client's 1:1 cropper (ui/avatarCrop.js `openAvatarCropper`, the maintainer's
// report of 2026-11-03 — this entry used to pick a file and silently centre-crop it) and the cropped picture is uploaded
// to the server (`POST /avatar`, server/http/avatarStore.js), so teammates' seat cards draw it too. To connect a real
// account system later, replace this file with a module that has the same exports (AGENTS.md §3.2 lists them and what
// each must return).
import { html, AvatarFrame, MicroLabel, Icon, Modal, Button } from './components.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { render } from '../../vendor/preact.module.js';
import { store } from '../store.js';
import { t } from '../../../shared/i18n.js';
import { identity } from '../net.js';
import { openAvatarCropper } from './avatarCrop.js';
import { removeOwnAvatar, useOwnAvatar } from './customAvatar.js';

/** This module keeps the account in the browser (other modules may check it to word their notes). */
export const LOCAL_ACCOUNT = true;

const KEY = 'sp.pref.localAccount';
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
export function accountOf(playerId) { return isMe(playerId) ? currentAccount() : null; }
export function useAccount(playerId) {
  const { me } = useCurrentAccount();
  return isMe(playerId) ? me : null;
}
/** The small "#1234" after a name when that player has an account. */
export function AccountTag({ playerId }) {
  const info = useAccount(playerId);
  return info ? html`<span class="acct-tag" title=${t('本机账号 {name}#{tag}', { name: info.name, tag: info.tag })}>#${info.tag}</span>` : null;
}
/** Plain DOM (chats): the #tag after this browser's own name. */
export function decorateChatName(element, playerId) {
  const info = accountOf(playerId);
  if (element && info && !element.querySelector('.acct-tag')) {
    const tag = document.createElement('span'); tag.className = 'acct-tag'; tag.textContent = `#${info.tag}`; element.append(tag);
  }
  return element;
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
.lacct__btns{display:flex;flex-wrap:wrap;gap:.1rem}`;
  document.head.appendChild(st);
}
let host = null;
function AccountPanel({ onStats, onClose }) {
  const { me } = useCurrentAccount();
  // 服务器上的自定义头像（1:1 裁剪后上传的那张，ui/customAvatar.js）——本机账号的老头像仍作退路
  const ownUrl = useOwnAvatar();
  const [busy, setBusy] = useState(false);
  // 更换头像: the maintainer's report of 2026-11-03 — this used to open a bare file picker and centre-crop the file with no
  // UI at all ("头像设置没有裁剪选择"). It now opens the client's 1:1 cropper (ui/avatarCrop.js AvatarDialog through
  // `openAvatarCropper`): 选图 → 拖动 / 滚轮缩放 → 确认使用 → 上传 → every avatar slot redraws. The dialog is its own
  // body-level modal, so the panel closes first (nothing of it can clip or cover the stage).
  const change = () => { onClose(); openAvatarCropper(); };
  const clear = async () => {
    if (busy) return;
    setBusy(true);
    try { await removeOwnAvatar(ownUrl ? identity.getToken() : null); } catch { /* local removal stands */ }
    try { profile = { ...load(), avatar: null }; write(profile); emit(); } catch { /* private mode / quota */ }
    setBusy(false);
  };
  const shown = ownUrl || me.avatar;
  return html`<${Modal} open=${true} title=${t('本机账号')} micro="LOCAL ACCOUNT" onClose=${onClose}>
    <div class="lacct">
      <div class="lacct__who">
        <span class="lacct__pic">${shown ? html`<img src=${shown} alt="" />` : [...me.name][0]}</span>
        <span><b class="lacct__name">${me.name}<span class="acct-tag">#${me.tag}</span></b><br /><${MicroLabel}>${t('LOCAL · 本机')}<//></span>
      </div>
      <p class="lacct__note">${t('头像会先裁成 1:1 再上传到服务器，同盟里的其他博士也能看到；编号与战绩保存在这台设备的浏览器里，换设备或清除浏览器数据后不会保留。昵称跟随游戏里的名字。')}</p>
      <div class="lacct__btns">
        <${Button} size="sm" variant="secondary" icon="image" loading=${busy} onClick=${change} data-testid="avatar-change">${t('更换头像')}<//>
        ${shown ? html`<${Button} size="sm" variant="ghost" disabled=${busy} onClick=${clear}>${t('移除头像')}<//>` : null}
        ${onStats ? html`<${Button} size="sm" variant="primary" icon="chart" onClick=${() => { onClose(); onStats(); }}>${t('统计数据')}<//>` : null}
      </div>
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
  useEffect(ensureStyle, []);
  const name = player?.name || me.name || t('博士');
  return html`<button type="button" class="me-chip me-chip--btn stats-entry" onClick=${() => openAccountPanel({ onStats })} title=${t('本机账号 · 统计数据')} aria-label=${t('本机账号')}>
    <${AvatarFrame} size="sm" name=${name} seat=${0} self=${true} src=${me.avatar || undefined} playerId=${store.get().me?.playerId || null} />
    <span class="me-chip__text"><span class="me-chip__name">${name}<span class="acct-tag">#${me.tag}</span></span><${MicroLabel}>${t('LOCAL · 本机账号')}<//></span>
    <${Icon} name="user" class="me-chip__stats" />
  </button>`;
}

/** Nothing to start: no service. */
export function startAccounts() {}
