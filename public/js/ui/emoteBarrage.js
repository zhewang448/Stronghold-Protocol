// 表情弹幕 (emote barrage, host console) — the falling pictures over the field and the two signal-bar cells that send
// them. The host console (server/admin.js → server/match/hostSettings.js) switches the whole feature; when it is off the
// signal bar renders exactly as before (no extra cells, no layer).
//
//   EmoteBarrageRain   the layer over the field: each `m.emote { watch, count }` spawns exactly `count` particles on the
//                      screens that should see it (the sender, the watched board, its watchers, or everyone in 联防),
//                      removes a particle when its fall ends, and replays the watched target's last second on a switch.
//                      No combo counter and no bubble: the falling picture is the whole effect.
//   EmoteBarrageCells  the two signal-bar cells (表情弹幕 / 表情设置), in the existing .gm__ping-btn style. The first
//                      SENDS the current selection at once (tap = one picture; taps inside 200 ms merge into one pulse);
//                      the second is the settings panel that picks what to send — one emote or 「随机」 (default), with
//                      the current choice highlighted and persisted (`sp.pref.barrageEmote`). Panels are
//                      `position: fixed` so the compact bar's horizontal scroll cannot clip them.
//
// The pure parameters / visibility / replay cache live in ui/gameLogic/barrage.js (Node-testable).

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { GIcon } from './gameComponents.js';
import { EmoteArt } from './emotes.js';
import { ALL_EMOTE_CATALOG } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';
import { loadPref, savePref } from '../store.js';
import { rainBurst, particleLife, barrageSide, barrageCount, rememberBarrage, takeBarrageReplay } from './gameLogic/barrage.js';

/** Clicks inside this window merge into one pulse (at most ~5 messages/s per player). */
export const BARRAGE_PULSE_MS = 200;
/** The persisted selection value that means "draw a random emote per tap" (the default). */
export const BARRAGE_RANDOM = '?';
const EMOTE_KEY = 'barrageEmote';
const RECENT_KEY = 'barrageRecent';
const RECENT_MAX = 8;
/** A soft render cap: a runaway flood keeps the newest particles instead of growing the DOM without bound. */
const RAIN_MAX_PARTICLES = 300;

const BY_ID = new Map(ALL_EMOTE_CATALOG.map((e) => [e.id, e]));
const isEmoteId = (id) => typeof id === 'string' && BY_ID.has(id);

/** The persisted choice: `'?'` (random), a known emote id, else random (the default the old feature shipped with). */
function readSelection() {
  const raw = loadPref(EMOTE_KEY, BARRAGE_RANDOM);
  return raw === BARRAGE_RANDOM || isEmoteId(raw) ? raw : BARRAGE_RANDOM;
}
function readRecent() {
  const raw = loadPref(RECENT_KEY, []);
  return Array.isArray(raw) ? raw.filter(isEmoteId).slice(0, RECENT_MAX) : [];
}
/**
 * A random emote id. `avoid` holds ids already used in this burst (plus the previous tap), so a quick burst of
 * random taps shows different pictures instead of repeating one.
 * @param {Iterable<string>|string|null} [avoid]
 */
export function pickRandomEmote(avoid = null) {
  const pool = ALL_EMOTE_CATALOG;
  const n = pool.length;
  const used = new Set(typeof avoid === 'string' ? [avoid] : avoid || []);
  let id = pool[Math.min(n - 1, Math.floor(Math.random() * n))].id;
  for (let i = 0; used.has(id) && i < 12 && used.size < n; i++) {
    id = pool[Math.min(n - 1, Math.floor(Math.random() * n))].id;
  }
  return id;
}

let rainSeq = 0;

/**
 * The falling-emote layer over the field. `events` is the store's `emotes` array; a new record with a `watch` field is a
 * barrage pulse. `enabled` is the host console's switch — off clears the layer at once and starts nothing.
 * @param {{ events: Array<any>, myId: string, watchingOther: boolean, watchedPid: string|null, enabled?: boolean }} props
 */
export function EmoteBarrageRain({ events, myId, watchingOther, watchedPid, enabled = true }) {
  const [items, setItems] = useState([]);
  const seen = useRef(null);
  const timers = useRef(new Map());
  const prevWatch = useRef({ watchingOther, watchedPid });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const spawn = (list) => {
    const added = [];
    for (const e of list) {
      const count = barrageCount(e);
      for (const p of rainBurst(Math.random, count)) {
        added.push({ ...p, id: e.id, receiver: barrageSide(e, { myId, watchingOther, watchedPid }), key: `r${++rainSeq}` });
      }
    }
    return added;
  };

  // New store events → falls on the screens that should see them; every pulse is cached per target for the 1 s replay.
  useEffect(() => {
    const list = Array.isArray(events) ? events : [];
    if (seen.current == null) {
      for (const e of list) if (e?.watch) rememberBarrage(e, Number(e.at) || Date.now());
      seen.current = list.length ? Number(list[list.length - 1].seq) || 0 : 0;
      return;
    }
    let top = seen.current;
    const fresh = [];
    for (const e of list) {
      const seq = Number(e?.seq) || 0;
      if (seq <= seen.current || !e?.watch) continue;
      rememberBarrage(e, Number(e.at) || Date.now());
      if (enabledRef.current && barrageSide(e, { myId, watchingOther, watchedPid })) fresh.push(e);
    }
    if (list.length) top = Math.max(top, ...list.map((e) => Number(e?.seq) || 0));
    seen.current = top;
    if (!fresh.length) return;
    const added = spawn(fresh);
    setItems((cur) => [...cur, ...added].slice(-RAIN_MAX_PARTICLES));
  }, [events, myId, watchingOther, watchedPid]);

  // A view switch: drop the previous board's particles, then replay the new target's last second (fresh positions).
  useEffect(() => {
    const prev = prevWatch.current;
    prevWatch.current = { watchingOther, watchedPid };
    if (prev.watchingOther === watchingOther && prev.watchedPid === watchedPid) return;
    setItems([]);
    const target = watchingOther ? watchedPid : null;
    if (!target || !enabledRef.current) return;
    const entries = takeBarrageReplay(target).filter((e) => {
      const side = barrageSide({ ...e, at: Date.now() }, { myId, watchingOther: true, watchedPid: target });
      return !!side;
    });
    if (!entries.length) return;
    const added = spawn(entries);
    setItems((cur) => [...cur, ...added].slice(-RAIN_MAX_PARTICLES));
  }, [watchingOther, watchedPid, myId]);

  // Host switch off: hide everything now (the server also stops relaying pulses).
  useEffect(() => {
    if (!enabled) setItems([]);
  }, [enabled]);

  // A particle leaves when its fall (delay + duration + fade margin) is over.
  useEffect(() => {
    const live = new Set(items.map((p) => p.key));
    for (const p of items) {
      if (timers.current.has(p.key)) continue;
      const timer = setTimeout(() => {
        timers.current.delete(p.key);
        setItems((cur) => cur.filter((x) => x.key !== p.key));
      }, particleLife(p));
      timers.current.set(p.key, timer);
    }
    for (const [key, timer] of [...timers.current]) {
      if (!live.has(key)) { clearTimeout(timer); timers.current.delete(key); }
    }
  }, [items]);

  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); }, []);

  if (!enabled) return null;
  return html`<div class="gm__emote-rain" data-watch-rain data-count=${items.length} aria-hidden="true">
    ${items.map((p) => html`<span key=${p.key} class="gm__emote-rain__drop" data-receiver=${p.receiver} data-emote=${p.id}
        style=${`left:${p.left}%;--rain-delay:${p.delay}ms;--rain-dur:${p.duration}ms;--rain-sway:${p.sway}rem;--rain-spin:${p.spin}deg;--rain-size:${p.size}rem`}>
      <span class="gm__emote-rain__inner"><${EmoteArt} id=${p.id} /></span>
    </span>`)}
  </div>`;
}

/** Pending clicks of one window → one `g.emote { id, watch, count }` per id. */
function createPulse(onSend, windowMs = BARRAGE_PULSE_MS) {
  let counts = new Map();
  let timer = 0;
  const send = () => {
    const entries = [...counts.entries()];
    counts = new Map();
    for (const [id, count] of entries) if (id && count > 0) onSend(id, count);
  };
  return {
    click(id) {
      if (!id) return;
      counts.set(id, (counts.get(id) || 0) + 1);
      if (!timer) timer = setTimeout(() => { timer = 0; send(); }, windowMs);
    },
    flush() { if (timer) { clearTimeout(timer); timer = 0; } send(); },
    discard() { if (timer) { clearTimeout(timer); timer = 0; } counts = new Map(); },
    pendingIds() { return [...counts.keys()]; },
  };
}

/**
 * The two signal-bar cells. Ordered after the original 标点 buttons (the caller renders them after the .gm__ping-buttons
 * row). Cell 1 sends the current selection immediately (no list); cell 2 opens the settings panel that picks it.
 * `onSend(id, count)` is bound to the board a pulse names by the caller.
 * @param {{ disabled?: boolean, onSend?: (id: string, count: number) => void }} props
 */
export function EmoteBarrageCells({ disabled = false, onSend }) {
  const [selection, setSelection] = useState(readSelection); // '?' = random, else an emote id
  const [recent, setRecent] = useState(readRecent);
  const [panel, setPanel] = useState(null);           // 'settings' | null
  const [pos, setPos] = useState(null);               // { left, bottom } in viewport px (position: fixed)
  const settingsRef = useRef(null);
  const pulseRef = useRef(null);
  const lastSent = useRef(null);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  const pulse = () => {
    if (!pulseRef.current) pulseRef.current = createPulse((id, count) => onSendRef.current?.(id, count));
    return pulseRef.current;
  };
  useEffect(() => () => pulseRef.current?.discard(), []);

  const rememberRecent = (id) => {
    setRecent((cur) => {
      const next = [id, ...cur.filter((x) => x !== id)].slice(0, RECENT_MAX);
      savePref(RECENT_KEY, next);
      return next;
    });
  };

  // Cell 1: send the current choice at once. 「随机」 draws a fresh emote per tap (never the same as the previous
  // tap, so a quick burst shows different pictures); taps inside BARRAGE_PULSE_MS merge into one pulse per id.
  const sendCurrent = () => {
    if (disabled) return;
    const avoid = [...pulse().pendingIds(), ...(lastSent.current ? [lastSent.current] : [])];
    const id = selection === BARRAGE_RANDOM ? pickRandomEmote(avoid) : selection;
    lastSent.current = id;
    rememberRecent(id);
    pulse().click(id);
  };

  // Cell 2: choosing takes effect immediately (the next tap on cell 1 sends it) and survives a reload.
  const choose = (value) => {
    if (value !== BARRAGE_RANDOM && !isEmoteId(value)) return;
    setSelection(value);
    savePref(EMOTE_KEY, value);
  };

  const toggleSettings = () => {
    if (panel === 'settings') { setPanel(null); return; }
    const r = settingsRef.current?.getBoundingClientRect?.();
    if (r) {
      const width = globalThis.innerWidth || 1280, height = globalThis.innerHeight || 720;
      // Match the panel's CSS max-height so it also fits above a high anchor on a short landscape screen.
      const maxBottom = height - Math.min(height * 0.7, 380) - 8;
      setPos({ left: Math.max(8, Math.min(r.left, width - 372)),
        bottom: Math.max(8, Math.min(height - r.top + 8, maxBottom)) });
    }
    setPanel('settings');
  };

  // outside press / Escape closes; the panel swallows its own keys so the match shortcuts never fire while it is open
  useEffect(() => {
    if (!panel) return undefined;
    const onDown = (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest?.('.gbar__panel, .gm__ping-btn--barrage-settings')) return;
      setPanel(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setPanel(null); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [panel]);

  const style = pos ? `left:${pos.left}px;bottom:${pos.bottom}px` : '';
  const random = selection === BARRAGE_RANDOM;
  const currentName = random ? t('随机') : t(BY_ID.get(selection).label);
  const faceTitle = random ? t('表情弹幕：发送随机表情') : t('表情弹幕：发送「{name}」', { name: currentName });
  const closeBtn = html`<button type="button" class="gbar__x" aria-label=${t('关闭')} onClick=${() => setPanel(null)}><${Icon} name="close" /></button>`;
  const settings = html`<div class="gbar__panel gbar__panel--settings" style=${style} role="dialog" aria-label=${t('表情设置')}
      onKeyDown=${(e) => e.stopPropagation()}>
    <header class="gbar__head"><b>${t('表情设置')}</b>${closeBtn}</header>
    <p class="gbar__current">${t('当前：{name}', { name: currentName })}${random ? html`<span class="gbar__sub">${t('每次点击随机一个')}</span>` : null}</p>
    <div class="gbar__label">${t('发送内容')}</div>
    <div class="gbar__row">
      <button type="button" class=${`gbar__choice${random ? ' is-on' : ''}`} aria-pressed=${random}
        data-choice="random" onClick=${() => choose(BARRAGE_RANDOM)}><b class="gbar__q">?</b><span>${t('随机')}</span></button>
    </div>
    <div class="gbar__label">${t('最近使用')}</div>
    ${recent.length ? html`<div class="gbar__row">${recent.map((id) => html`<button key=${id} type="button" class=${`gbar__chip${id === selection ? ' is-on' : ''}`}
      aria-label=${t(BY_ID.get(id).label)} title=${t(BY_ID.get(id).label)} aria-pressed=${id === selection} onClick=${() => choose(id)}><${EmoteArt} id=${id} /></button>`)}</div>`
      : html`<p class="gbar__hint">${t('还没有发送过表情弹幕。')}</p>`}
    <div class="gbar__label">${t('全部表情')}</div>
    <div class="gbar__grid gbar__grid--all">${ALL_EMOTE_CATALOG.map((e) => html`<button key=${e.id} type="button"
      class=${`gbar__emote${e.id === selection ? ' is-on' : ''}`}
      aria-label=${t(e.label)} aria-pressed=${e.id === selection} title=${t(e.label)} data-emote=${e.id} onClick=${() => choose(e.id)}><${EmoteArt} id=${e.id} /></button>`)}</div>
    <p class="gbar__hint">${t('点一下选中；回到对局点第 1 格发送。')}</p>
  </div>`;

  return html`<button type="button" data-selection=${selection} class=${`gm__ping-btn gm__ping-btn--barrage${random ? ' is-random' : ''}`}
      disabled=${disabled} aria-label=${faceTitle} title=${faceTitle} onClick=${sendCurrent}>
      ${random ? html`<b class="gbar__q">?</b>` : html`<${EmoteArt} id=${selection} />`}
    </button>
    <button ref=${settingsRef} type="button" class=${`gm__ping-btn gm__ping-btn--barrage-settings${panel === 'settings' ? ' is-on' : ''}`}
      disabled=${disabled} aria-label=${t('表情设置：选择发送内容')} aria-expanded=${panel === 'settings' ? 'true' : 'false'} aria-haspopup="dialog"
      title=${t('表情设置：选择发送内容')} onClick=${toggleSettings}>
      <${GIcon} name="gear" />
    </button>
    ${panel === 'settings' ? settings : null}`;
}
