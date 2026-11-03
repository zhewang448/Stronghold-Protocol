// public/js/ui/customIllust.js — 自定义立绘 (the maintainer's request of 2026-10-18, with the avatar store): the picture
// this browser uploaded to the room's 立绘 position, and everybody else's, as URLs an <img> can draw.
//
//   * own picture — after a successful `POST /illust` the downscaled blob is kept in IndexedDB (`sp-illust` / `pictures` /
//     `own`) so it is on screen at once and survives a reload; the server keeps its own copy, so a teammate's browser
//     reads it with `GET /illust/<playerId>` and nothing about it is ever put into a room, a match or the protocol.
//   * other players' pictures — fetched once per playerId, revalidated at most every REMOTE_TTL_MS, 404 = "this player
//     has none" (the operator's own illustration keeps drawing). Object URLs are reused while the ETag does not change.
//   * nothing is fetched until the server says somebody has one (`/healthz` `illusts` → the store's `serverIllusts`): a
//     server on which nobody uses this feature makes no illustration request at all.
//   * the server's switch (room.state.personalization.customIllust, from local/personalization.json) decides whether a
//     seat card may draw one — the hook is passed a null id when it is off, so a server that turned it off draws the
//     operator's illustration exactly as before. There is no room option: every room of that server renders alike.
//
// Framing is NOT done here: the uploaded picture is drawn by the seat card's 立绘 position through ui/cardArt.js
// (`CardArtImage` with a `src`), so the existing 立绘调整 (pan / zoom / 精一精二 / sp.pref.room.cardArt) frames it.
//
// No cropper: the picture is downscaled to a long side of ≤ ILLUST_MAX_SIDE (1536) before upload and drawn with
// `object-fit: cover`, which is what the seat card's slot does; nothing is stretched.

import { useEffect, useReducer } from '../../vendor/hooks.module.js';
import { store, useStore } from '../store.js';

/** Largest picture the server accepts (bytes); the client compresses well under it. */
export const ILLUST_MAX_BYTES = 2 * 1024 * 1024;
/** The long side the picture is rendered at before uploading (px); the seat card's slot is 1:2. */
export const ILLUST_MAX_SIDE = 1536;
/** Largest source file the picker accepts (bytes; a 4000×6000 PNG photograph is ~46 MB, the server only ever sees the
 * rendered ≤ 1536 WebP). */
export const ILLUST_SOURCE_MAX_BYTES = 48 * 1024 * 1024;
/** How long a fetched picture is trusted before it is asked for again (a removal or a replacement shows up then). */
export const REMOTE_TTL_MS = 60_000;

const DB_NAME = 'sp-illust';
const DB_STORE = 'pictures';
const OWN_KEY = 'own';

/** @type {{ url: string|null, etag: string|null, blob: Blob|null }} the own picture, once loaded */
const own = { url: null, etag: null, blob: null };
let ownLoaded = false;
/** @type {Promise<void>|null} */
let ownLoading = null;
/** The server had a picture when this page uploaded one: the remote fetches are worth making even before /healthz says so. */
let gateOpen = false;

/** @type {Map<string, { url: string|null, state: 'ok'|'missing'|'error'|'idle', etag: string|null, at: number }>} */
const remote = new Map();
/** @type {Map<string, Promise<void>>} */
const pending = new Map();
/** Per player: bumped by `refreshRemoteIllust` (a room.personal notice); a fetch from an older version drops its result. */
const stampVersion = new Map();
const listeners = new Set();

function notify() {
  for (const fn of [...listeners]) { try { fn(); } catch (err) { console.warn('[illust] listener failed', err); } }
}

/** Subscribe to any change of the own picture or of a fetched one; returns the unsubscribe. */
export function subscribeIllusts(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---- IndexedDB (the browser's own store; a browser without it keeps the picture in memory only) ---------------------

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  }).catch((err) => { dbPromise = null; throw err; });
  return dbPromise;
}

/** Run one IndexedDB request against the pictures store. */
function idbRequest(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode);
    const req = run(tx.objectStore(DB_STORE));
    tx.oncomplete = () => resolve(req?.result ?? null);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  }));
}

const idbGet = (key) => idbRequest('readonly', (s) => s.get(key));
const idbPut = (key, value) => idbRequest('readwrite', (s) => s.put(value, key));
const idbDelete = (key) => idbRequest('readwrite', (s) => s.delete(key));

// ---- own picture ---------------------------------------------------------------------------------------------------

function setOwnUrl(blob) {
  if (own.url) { try { URL.revokeObjectURL(own.url); } catch { /* nothing to revoke */ } }
  own.url = blob ? URL.createObjectURL(blob) : null;
}

/** Read the own picture from IndexedDB once (idempotent). */
export function ensureOwnIllust() {
  if (ownLoaded) return Promise.resolve();
  if (ownLoading) return ownLoading;
  ownLoading = (async () => {
    try {
      const rec = await idbGet(OWN_KEY);
      if (rec && rec.blob && typeof rec.blob.size === 'number' && rec.blob.size > 0) {
        own.blob = rec.blob;
        own.etag = typeof rec.etag === 'string' ? rec.etag : null;
        setOwnUrl(rec.blob);
      }
    } catch { /* no IndexedDB / a private window: the picture still lives for this page */ }
    ownLoaded = true;
    ownLoading = null;
    notify();
  })();
  return ownLoading;
}

/** The own picture's URL (null before it loaded or when there is none). */
export function ownIllustUrl() { return own.url; }

/** Keep a picture as the own one and show it at once. @param {Blob} blob @param {string|null} [etag] */
async function saveOwnIllust(blob, etag = null) {
  own.blob = blob;
  own.etag = etag;
  ownLoaded = true;
  setOwnUrl(blob);
  gateOpen = true;
  notify();
  try { await idbPut(OWN_KEY, { blob, etag, at: Date.now() }); } catch { /* memory only */ }
}

/** Forget the own picture (after a removal). */
async function clearOwnIllust() {
  own.blob = null;
  own.etag = null;
  ownLoaded = true;
  setOwnUrl(null);
  notify();
  try { await idbDelete(OWN_KEY); } catch { /* memory only */ }
}

// ---- the picture → blob --------------------------------------------------------------------------------------------

const dimsFor = (iw, ih, targetLong) => {
  const long = Math.max(iw, ih) || 1;
  const k = Math.min(1, targetLong / long); // never upscale a small picture
  return { w: Math.max(1, Math.round(iw * k)), h: Math.max(1, Math.round(ih * k)) };
};

/** `canvas.toBlob` as a promise (null when the browser has no 2d canvas). */
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch { resolve(null); }
  });
}

/**
 * Render the picture with its long side ≤ ILLUST_MAX_SIDE (1536 — the seat card's slot is 1:2) as WebP q0.85, exactly as
 * the maintainer asked: WebP keeps alpha; a browser without a WebP encoder falls back to JPEG q0.9 **on a dark backdrop**
 * so transparency never turns into black speckles. If that is still over ILLUST_MAX_BYTES (2 MB), quality drops
 * (0.75 → 0.65) and then the long side drops to 1024 and is tried again. A typical 1536-long picture lands at 150–400 KB.
 * @param {HTMLImageElement} img
 * @returns {Promise<{ blob: Blob, width: number, height: number }|null>}
 */
export async function encodeIllust(img) {
  if (typeof document === 'undefined' || !img) return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  /** @type {[number, number][]} long side, WebP quality */
  const plan = [[ILLUST_MAX_SIDE, 0.85], [ILLUST_MAX_SIDE, 0.75], [ILLUST_MAX_SIDE, 0.65], [1024, 0.85], [1024, 0.75]];
  for (const [target, quality] of plan) {
    const { w, h } = dimsFor(img.naturalWidth, img.naturalHeight, target);
    // WebP first: no backdrop, so a transparent picture keeps its alpha
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const webp = await canvasToBlob(canvas, 'image/webp', quality);
    if (webp && webp.size > 0 && webp.size <= ILLUST_MAX_BYTES && webp.type === 'image/webp') {
      return { blob: webp, width: w, height: h };
    }
    // the JPEG fallback: draw it again on a dark plate (transparency becomes the page's own dark, not black speckles)
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0c0f0e';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    if (jpeg && jpeg.size > 0 && jpeg.size <= ILLUST_MAX_BYTES) return { blob: jpeg, width: w, height: h };
  }
  return null;
}

// ---- server -------------------------------------------------------------------------------------------------------

/** POST the picture for this session (no local bookkeeping). */
async function postIllust(blob, token) {
  const res = await fetch('/illust', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!res.ok) {
    const err = new Error(`illust upload failed (${res.status})`);
    // @ts-ignore — a code for the caller's message choice
    err.status = res.status;
    throw err;
  }
  gateOpen = true;
  return res.json().catch(() => ({}));
}

/**
 * Upload a rendered picture for this session and keep it as the own one.
 * @param {Blob} blob the picture (encodeIllust)
 * @param {string} token @returns {Promise<any>} the server's confirmation
 */
export async function uploadOwnIllust(blob, token) {
  const body = await postIllust(blob, token);
  await saveOwnIllust(blob, typeof body?.etag === 'string' ? body.etag : null);
  return body;
}

/** The playerId whose picture was last checked after a welcome (one check per session). */
let syncedFor = null;

/**
 * Re-publish this browser's own picture after a welcome whose playerId the server does not hold a picture for (a server
 * restart mints a new session / playerId while the browser keeps its blob in IndexedDB).
 * @param {string} token @param {string|null} playerId
 * @returns {Promise<boolean>} whether a picture was uploaded
 */
export async function syncOwnIllust(token, playerId) {
  if (!token || typeof playerId !== 'string' || !playerId) return false;
  if (syncedFor === playerId) return false;
  syncedFor = playerId;
  await ensureOwnIllust();
  if (!own.blob) return false;
  try {
    const res = await fetch(`/illust/${encodeURIComponent(playerId)}`, { cache: 'no-cache' });
    await res.arrayBuffer().catch(() => {});
    if (res.ok) return false;              // this session already has a picture
    if (res.status !== 404) return false;  // server/network trouble: the next welcome may retry
    await postIllust(own.blob, token);
    return true;
  } catch {
    syncedFor = null;
    return false;
  }
}

/** Remove this session's picture on the server as well (when a token is given) and forget it here. */
export async function removeOwnIllust(token) {
  if (token) {
    try {
      const res = await fetch('/illust', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      await res.arrayBuffer().catch(() => {});
    } catch { /* local removal stands */ }
  }
  await clearOwnIllust();
}

// ---- other players' pictures --------------------------------------------------------------------------------------

/** Whether /healthz has reported any picture on this server (or this page uploaded one). */
export function remoteIllustsAllowed() {
  return gateOpen || (Number(store.get().serverIllusts) || 0) > 0;
}

/**
 * Fetch (or revalidate) one player's picture. A 404 is remembered as "none" (the operator's illustration), an error
 * keeps the last picture on screen and retries later.
 * @param {string} playerId @param {{ force?: boolean, at?: number }} [opts] `at`: a change stamp (room.personal) — it
 *   cache-busts the URL so no HTTP cache can answer with the picture from before
 * @returns {Promise<void>}
 */
export function ensureRemoteIllust(playerId, { force = false, at = 0 } = {}) {
  const pid = typeof playerId === 'string' && playerId ? playerId : null;
  if (!pid || !remoteIllustsAllowed()) return Promise.resolve();
  const cur = remote.get(pid);
  if (!force && cur && Date.now() - cur.at < REMOTE_TTL_MS) return Promise.resolve();
  if (pending.has(pid)) return pending.get(pid);
  // a fetch that started before a change notice must not overwrite the picture the notice asks for
  const version = stampVersion.get(pid) || 0;
  const fresh = () => (stampVersion.get(pid) || 0) === version;
  const task = (async () => {
    const before = remote.get(pid);
    try {
      const res = await fetch(`/illust/${encodeURIComponent(pid)}${at ? `?t=${at}` : ''}`, { cache: 'no-cache' });
      if (!fresh()) return;
      if (res.status === 404) {
        if (before?.url) { try { URL.revokeObjectURL(before.url); } catch { /* already gone */ } }
        remote.set(pid, { url: null, state: 'missing', etag: null, at: Date.now() });
        notify();
        return;
      }
      if (!res.ok) {
        remote.set(pid, { url: before?.url || null, state: 'error', etag: before?.etag || null, at: Date.now() });
        notify();
        return;
      }
      const etag = res.headers.get('etag');
      if (before && before.state === 'ok' && before.url && etag && before.etag === etag) {
        remote.set(pid, { ...before, at: Date.now() });
        return;
      }
      const blob = await res.blob();
      if (!fresh()) return;
      if (!blob.size || !/^image\//.test(blob.type)) {
        remote.set(pid, { url: before?.url || null, state: 'error', etag: before?.etag || null, at: Date.now() });
        notify();
        return;
      }
      if (before?.url) { try { URL.revokeObjectURL(before.url); } catch { /* already gone */ } }
      remote.set(pid, { url: URL.createObjectURL(blob), state: 'ok', etag, at: Date.now() });
      notify();
    } catch {
      if (!fresh()) return;
      remote.set(pid, { url: before?.url || null, state: 'error', etag: before?.etag || null, at: Date.now() });
      notify();
    }
  })().finally(() => pending.delete(pid));
  pending.set(pid, task);
  return task;
}

/**
 * 立绘变了 (server → `room.personal`, server/lobby.js personalChanged): drop this player's cached picture and read it again
 * at once, so a roommate's seat card shows the new 立绘 without a reload (the maintainer's request of 2026-11-03). `at` is
 * the broadcast's timestamp and cache-busts the URL. The own picture needs nothing (it is the local blob, already the
 * file that was uploaded), and nothing here fetches without such a notice.
 * @param {string} playerId @param {number} [at]
 */
export function refreshRemoteIllust(playerId, at = Date.now(), { removed = false } = {}) {
  const pid = typeof playerId === 'string' && playerId ? playerId : null;
  if (!pid || pid === store.get().me?.playerId) return;
  gateOpen = true; // the server just said this player has a picture (or had one)
  stampVersion.set(pid, (stampVersion.get(pid) || 0) + 1);
  if (removed) {
    // the server said it is gone: drop it here and now — no request, no 404 in the console
    const before = remote.get(pid);
    if (before?.url) { try { URL.revokeObjectURL(before.url); } catch { /* already gone */ } }
    remote.set(pid, { url: null, state: 'missing', etag: null, at: Date.now() });
    notify();
    return;
  }
  const flying = pending.get(pid);
  if (flying) { void flying.finally(() => ensureRemoteIllust(pid, { force: true, at })); return; }
  void ensureRemoteIllust(pid, { force: true, at });
}

/** A fetched picture's current URL (null until one arrives / when the player has none). */
export function remoteIllustUrl(playerId) {
  return remote.get(playerId)?.url || null;
}

/** Drop every fetched picture (tests, sign-out). */
export function resetRemoteIllusts() {
  for (const rec of remote.values()) if (rec.url) { try { URL.revokeObjectURL(rec.url); } catch { /* already gone */ } }
  remote.clear();
  pending.clear();
  notify();
}

// ---- hooks --------------------------------------------------------------------------------------------------------

/**
 * The own picture's URL (null when there is none; re-renders when it is set or removed).
 * @returns {string|null}
 */
export function useOwnIllust() {
  const [, force] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const off = subscribeIllusts(force);
    void ensureOwnIllust();
    return off;
  }, []);
  return own.url;
}

/**
 * The URL to draw for a player's 立绘, or null (draw the operator's own illustration exactly as before). The own player's
 * local picture wins (it is the exact blob that was uploaded); everybody else's comes from `/illust/<playerId>` once the
 * server reports that somebody has one. Pass a null playerId when the room's switch is off.
 * @param {string|null|undefined} playerId
 * @returns {string|null}
 */
export function useCustomIllust(playerId) {
  const [, force] = useReducer((n) => n + 1, 0);
  const gate = useStore((s) => s.serverIllusts, Object.is);
  const myId = useStore((s) => s.me?.playerId, Object.is);
  useEffect(() => {
    const off = subscribeIllusts(force);
    void ensureOwnIllust();
    return off;
  }, []);
  useEffect(() => {
    const pid = typeof playerId === 'string' && playerId ? playerId : null;
    const off = subscribeIllusts(force);
    if (!pid || pid === myId) return off;
    void ensureRemoteIllust(pid);
    const timer = setInterval(() => { void ensureRemoteIllust(pid, { force: true }); }, REMOTE_TTL_MS);
    return () => { off(); clearInterval(timer); };
  }, [playerId, gate, myId]);
  const pid = typeof playerId === 'string' && playerId ? playerId : null;
  if (!pid) return null;
  if (pid === myId && own.url) return own.url;
  return remote.get(pid)?.url || null;
}
