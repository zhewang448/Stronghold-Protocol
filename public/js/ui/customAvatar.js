// public/js/ui/customAvatar.js — 自定义头像 (the maintainer's request of 2026-10-18): the picture this browser uploaded,
// and the pictures of everybody else, as URLs an <img> can draw.
//
//   * own picture — after a successful `POST /avatar` the cropped blob is kept in IndexedDB (`sp-avatar` / `pictures` /
//     `own`) so it is on screen at once and survives a reload; the server keeps its own copy, so a teammate's browser
//     reads it with `GET /avatar/<playerId>` and nothing about it is ever put into a room, a match or the protocol.
//     A small module store (below) tells the components when it changes.
//   * other players' pictures — fetched once per playerId, revalidated at most every REMOTE_TTL_MS, 404 = "this player
//     has none" (the default avatar keeps drawing). Object URLs are reused while the ETag does not change and revoked
//     when the picture is replaced or removed.
//   * nothing is fetched at all until the server says somebody has a picture (`/healthz` `avatars`, read once per check
//     by ui/buildGuard.js into the store's `serverAvatars`): a server on which nobody uses this feature makes no avatar
//     request, and every avatar looks exactly as before.
//
// The components subscribe through `useCustomAvatar(playerId)`: the player's own local URL first, else the fetched one,
// else null (draw the default: the seat-hued glyph / the strategy icon).

import { useEffect, useReducer } from '../../vendor/hooks.module.js';
import { store, useStore } from '../store.js';

/** Largest picture the server accepts (bytes); the crop dialog compresses well under it. */
export const AVATAR_MAX_BYTES = 128 * 1024;
/** The square the crop dialog renders (px) before uploading. */
export const AVATAR_SIZE = 256;
/** How long a fetched picture is trusted before it is asked for again (a removal or a replacement shows up then). */
export const REMOTE_TTL_MS = 30_000;

const DB_NAME = 'sp-avatar';
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
/** Per player: bumped by `refreshRemoteAvatar` (a room.personal notice); a fetch from an older version drops its result. */
const stampVersion = new Map();
const listeners = new Set();

function notify() {
  for (const fn of [...listeners]) { try { fn(); } catch (err) { console.warn('[avatar] listener failed', err); } }
}

/** Subscribe to any change of the own picture or of a fetched one; returns the unsubscribe. */
export function subscribeAvatars(fn) {
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
export function ensureOwnAvatar() {
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
export function ownAvatarUrl() { return own.url; }

/** Keep a picture as the own one and show it at once. @param {Blob} blob @param {string|null} [etag] */
async function saveOwnAvatar(blob, etag = null) {
  own.blob = blob;
  own.etag = etag;
  ownLoaded = true;
  setOwnUrl(blob);
  gateOpen = true;
  notify();
  try { await idbPut(OWN_KEY, { blob, etag, at: Date.now() }); } catch { /* memory only */ }
}

/** Forget the own picture (after a removal). */
async function clearOwnAvatar() {
  own.blob = null;
  own.etag = null;
  ownLoaded = true;
  setOwnUrl(null);
  notify();
  try { await idbDelete(OWN_KEY); } catch { /* memory only */ }
}

/**
 * POST the picture for this session (no local bookkeeping). The token is the WebSocket session's own reconnect token;
 * the server reads the playerId from it and ignores any id a client might send.
 * @param {Blob} blob @param {string} token @returns {Promise<any>} the server's confirmation
 */
async function postAvatar(blob, token) {
  const res = await fetch('/avatar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!res.ok) {
    const err = new Error(`avatar upload failed (${res.status})`);
    // @ts-ignore — a code for the caller's message choice
    err.status = res.status;
    throw err;
  }
  gateOpen = true;
  return res.json().catch(() => ({}));
}

/**
 * Upload a cropped 1:1 picture for this session and keep it as the own one.
 * @param {Blob} blob the picture (the crop dialog renders 256 × 256)
 * @param {string} token @returns {Promise<any>} the server's confirmation
 */
export async function uploadOwnAvatar(blob, token) {
  const body = await postAvatar(blob, token);
  await saveOwnAvatar(blob, typeof body?.etag === 'string' ? body.etag : null);
  return body;
}

/** The playerId whose picture was last checked after a welcome (one check per session). */
let syncedFor = null;

/**
 * Re-publish this browser's own picture after a welcome whose playerId the server does not hold a picture for — a server
 * restart creates a new session (and playerId) while the browser keeps its cropped blob in IndexedDB, so without this the
 * picture survives on disk but the new playerId has none and teammates would fall back to the default. One check per
 * playerId; a failed upload is retried on the next welcome. Does nothing without a local picture or a token.
 * @param {string} token @param {string|null} playerId
 * @returns {Promise<boolean>} whether a picture was uploaded
 */
export async function syncOwnAvatar(token, playerId) {
  if (!token || typeof playerId !== 'string' || !playerId) return false;
  if (syncedFor === playerId) return false;
  syncedFor = playerId;
  await ensureOwnAvatar();
  if (!own.blob) return false;
  try {
    const res = await fetch(`/avatar/${encodeURIComponent(playerId)}`, { cache: 'no-cache' });
    await res.arrayBuffer().catch(() => {});
    if (res.ok) return false;              // this session already has a picture
    if (res.status !== 404) return false;  // server/network trouble: the next welcome may retry
    await postAvatar(own.blob, token);
    return true;
  } catch {
    syncedFor = null;
    return false;
  }
}

/** Remove this session's picture on the server as well (when a token is given) and forget it here. */
export async function removeOwnAvatar(token) {
  if (token) {
    try {
      const res = await fetch('/avatar', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      // consume the (empty) body: an unread response is reported as an aborted request by some browsers
      await res.arrayBuffer().catch(() => {});
    } catch { /* local removal stands */ }
  }
  await clearOwnAvatar();
}

// ---- other players' pictures --------------------------------------------------------------------------------------

/** Whether /healthz has reported any picture on this server (or this page uploaded one). */
export function remoteAvatarsAllowed() {
  return gateOpen || (Number(store.get().serverAvatars) || 0) > 0;
}

/**
 * Fetch (or revalidate) one player's picture. A 404 is remembered as "none" (the default avatar), an error keeps the
 * last picture on screen and retries later.
 * @param {string} playerId @param {{ force?: boolean, at?: number }} [opts] `at`: a change stamp (room.personal) — it
 *   cache-busts the URL so no HTTP cache can answer with the picture from before
 * @returns {Promise<void>}
 */
export function ensureRemoteAvatar(playerId, { force = false, at = 0 } = {}) {
  const pid = typeof playerId === 'string' && playerId ? playerId : null;
  if (!pid || !remoteAvatarsAllowed()) return Promise.resolve();
  const cur = remote.get(pid);
  if (!force && cur && Date.now() - cur.at < REMOTE_TTL_MS) return Promise.resolve();
  if (pending.has(pid)) return pending.get(pid);
  // a fetch that started before a change notice must not overwrite the picture the notice asks for
  const version = stampVersion.get(pid) || 0;
  const fresh = () => (stampVersion.get(pid) || 0) === version;
  const task = (async () => {
    const before = remote.get(pid);
    try {
      const res = await fetch(`/avatar/${encodeURIComponent(pid)}${at ? `?t=${at}` : ''}`, { cache: 'no-cache' });
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
 * 头像变了 (server → `room.personal`, server/lobby.js personalChanged): drop this player's cached picture and read it again
 * at once, so the room's other clients redraw the avatar without a reload (the maintainer's request of 2026-11-03). `at`
 * is the broadcast's timestamp and cache-busts the URL. The own picture needs nothing (it is the local blob), and nothing
 * here fetches without such a notice.
 * @param {string} playerId @param {number} [at]
 */
export function refreshRemoteAvatar(playerId, at = Date.now(), { removed = false } = {}) {
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
  if (flying) { void flying.finally(() => ensureRemoteAvatar(pid, { force: true, at })); return; }
  void ensureRemoteAvatar(pid, { force: true, at });
}

/** A fetched picture's current URL (null until one arrives / when the player has none). */
export function remoteAvatarUrl(playerId) {
  return remote.get(playerId)?.url || null;
}

/** Drop every fetched picture (tests, sign-out). */
export function resetRemoteAvatars() {
  for (const rec of remote.values()) if (rec.url) { try { URL.revokeObjectURL(rec.url); } catch { /* already gone */ } }
  remote.clear();
  pending.clear();
  notify();
}

// ---- hooks ---------------------------------------------------------------------------------------------------------

/**
 * The own picture's URL (null when there is none; re-renders when it is set or removed).
 * @returns {string|null}
 */
export function useOwnAvatar() {
  const [, force] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const off = subscribeAvatars(force);
    void ensureOwnAvatar();
    return off;
  }, []);
  return own.url;
}

/**
 * The URL to draw for a player's avatar, or null (draw the default avatar exactly as before).
 * The own player's local picture wins (it is the exact blob that was uploaded); everybody else's comes from
 * `/avatar/<playerId>` once the server reports that somebody has one.
 * @param {string|null|undefined} playerId
 * @returns {string|null}
 */
export function useCustomAvatar(playerId) {
  const [, force] = useReducer((n) => n + 1, 0);
  const gate = useStore((s) => s.serverAvatars, Object.is);
  const myId = useStore((s) => s.me?.playerId, Object.is);
  useEffect(() => {
    const off = subscribeAvatars(force);
    void ensureOwnAvatar();
    return off;
  }, []);
  useEffect(() => {
    const pid = typeof playerId === 'string' && playerId ? playerId : null;
    const off = subscribeAvatars(force);
    // the own picture is the local blob (it is the very file that was uploaded) — never asked for a second time
    if (!pid || pid === myId) return off;
    void ensureRemoteAvatar(pid);
    // revalidate while mounted: a teammate's new or removed picture arrives within REMOTE_TTL_MS
    const timer = setInterval(() => { void ensureRemoteAvatar(pid, { force: true }); }, REMOTE_TTL_MS);
    return () => { off(); clearInterval(timer); };
  }, [playerId, gate, myId]);
  const pid = typeof playerId === 'string' && playerId ? playerId : null;
  if (!pid) return null;
  if (pid === myId && own.url) return own.url;
  return remote.get(pid)?.url || null;
}
