import { useEffect, useReducer } from '../../vendor/hooks.module.js';
import { store, useStore } from '../store.js';
import { identity } from '../net.js';
import { ILLUST_MAX_BYTES, ILLUST_MAX_SIDE, ILLUST_SOURCE_MAX_BYTES } from '../../../shared/illustration.js';

export { ILLUST_MAX_BYTES, ILLUST_MAX_SIDE, ILLUST_SOURCE_MAX_BYTES };
const own = { blob: null, url: null, etag: null };
const listeners = new Set(), remote = new Map(), pending = new Map();
let loaded = null, synced = null;
const notify = () => { for (const listener of listeners) listener(); };

function database(action, value = undefined) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const opening = indexedDB.open('sp-illust', 1);
    opening.onupgradeneeded = () => { if (!opening.result.objectStoreNames.contains('pictures')) opening.result.createObjectStore('pictures'); };
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const connection = opening.result, transaction = connection.transaction('pictures', action === 'get' ? 'readonly' : 'readwrite');
      const pictures = transaction.objectStore('pictures');
      const request = action === 'get' ? pictures.get('own') : action === 'put' ? pictures.put(value, 'own') : pictures.delete('own');
      transaction.oncomplete = () => { connection.close(); resolve(request.result); };
      transaction.onerror = () => { connection.close(); reject(transaction.error); };
      transaction.onabort = transaction.onerror;
    };
  });
}

function replaceOwn(blob, etag = null) {
  if (own.url) URL.revokeObjectURL(own.url);
  own.blob = blob; own.etag = etag; own.url = blob ? URL.createObjectURL(blob) : null; notify();
}

export function ensureOwnIllust() {
  if (!loaded) loaded = database('get').then(saved => {
    if (saved?.blob instanceof Blob && saved.blob.size <= ILLUST_MAX_BYTES) replaceOwn(saved.blob, saved.etag);
  }).catch(() => {});
  return loaded;
}

async function encodedBlob(canvas, type, quality) {
  return new Promise(resolve => { try { canvas.toBlob(resolve, type, quality); } catch { resolve(null); } });
}

export async function encodeIllust(image, crop = null) {
  const canvas = document.createElement('canvas'), drawing = canvas.getContext('2d');
  if (!drawing || !image?.naturalWidth || !image.naturalHeight) return null;
  const area = crop || { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  for (const [maximum, quality] of [[ILLUST_MAX_SIDE, 0.85], [ILLUST_MAX_SIDE, 0.75], [ILLUST_MAX_SIDE, 0.65], [1024, 0.85], [1024, 0.75]]) {
    const scale = Math.min(1, maximum / Math.max(area.width, area.height));
    canvas.height = Math.max(crop ? 128 : 1, Math.round(area.height * scale));
    canvas.width = crop ? Math.round(canvas.height / 2) : Math.max(1, Math.round(area.width * scale));
    drawing.imageSmoothingEnabled = true; drawing.imageSmoothingQuality = 'high';
    drawing.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
    const webp = await encodedBlob(canvas, 'image/webp', quality);
    if (webp?.type === 'image/webp' && webp.size > 0 && webp.size <= ILLUST_MAX_BYTES) return { blob: webp, width: canvas.width, height: canvas.height };
    drawing.fillStyle = '#0c0f0e'; drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
    const jpeg = await encodedBlob(canvas, 'image/jpeg', quality);
    if (jpeg?.type === 'image/jpeg' && jpeg.size > 0 && jpeg.size <= ILLUST_MAX_BYTES) return { blob: jpeg, width: canvas.width, height: canvas.height };
  }
  return null;
}

async function requestPicture(method, body = undefined) {
  const token = identity.getToken();
  if (!token) throw new Error('OFFLINE');
  const response = await fetch('/illust', { method, headers: { Authorization: 'Bearer ' + token,
    ...(body ? { 'Content-Type': body.type } : {}) }, body, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Object.assign(new Error('Illustration request failed'), { status: response.status });
  return response.status === 204 ? {} : response.json();
}

export async function uploadOwnIllust(blob) {
  await ensureOwnIllust();
  const result = await requestPicture('POST', blob);
  replaceOwn(blob, result.etag);
  await database('put', { blob, etag: result.etag }).catch(() => {});
  return result;
}

export async function removeOwnIllust() {
  await requestPicture('DELETE');
  replaceOwn(null);
  await database('delete').catch(() => {});
}

export async function syncOwnIllust() {
  await ensureOwnIllust();
  const playerId = store.get().me?.playerId;
  if (!own.blob || !playerId || synced === playerId) return;
  const token = identity.getToken();
  try {
    const metadata = await requestPicture('GET');
    if (token !== identity.getToken() || playerId !== store.get().me?.playerId) return;
    if (metadata.etag !== own.etag) await requestPicture('POST', own.blob);
    synced = playerId;
  } catch { synced = null; }
}

const stampOf = playerId => store.get().room?.seats?.find(seat => seat?.playerId === playerId)?.illust || null;
async function ensureRemote(playerId, stamp) {
  const key = playerId + '|' + stamp;
  if (pending.has(key) || remote.get(playerId)?.etag === stamp) return;
  const code = store.get().room?.code, token = identity.getToken();
  const task = (async () => {
    try {
      const response = await fetch('/illust/' + encodeURIComponent(playerId), { headers: { Authorization: 'Bearer ' + token }, cache: 'no-cache', signal: AbortSignal.timeout(15000) });
      if (!response.ok) return;
      const blob = await response.blob();
      if (stamp !== stampOf(playerId) || code !== store.get().room?.code || token !== identity.getToken() || !blob.size || blob.size > ILLUST_MAX_BYTES) return;
      if (!['image/webp', 'image/png', 'image/jpeg'].includes(blob.type)) return;
      const previous = remote.get(playerId);
      if (previous?.url) URL.revokeObjectURL(previous.url);
      remote.set(playerId, { url: URL.createObjectURL(blob), etag: stamp }); notify();
    } catch {} finally { pending.delete(key); }
  })();
  pending.set(key, task); await task;
}

export function useOwnIllust() {
  const [, force] = useReducer(value => value + 1, 0);
  useEffect(() => { listeners.add(force); void ensureOwnIllust(); return () => listeners.delete(force); }, []);
  return own.url;
}

export function useCustomIllust(playerId) {
  const [, force] = useReducer(value => value + 1, 0);
  const stamp = useStore(state => state.room?.seats?.find(seat => seat?.playerId === playerId)?.illust || null);
  const enabled = useStore(state => state.room?.customIllust !== false);
  const myId = useStore(state => state.me?.playerId);
  useEffect(() => { listeners.add(force); void ensureOwnIllust(); return () => listeners.delete(force); }, []);
  useEffect(() => {
    if (enabled && playerId && stamp) void ensureRemote(playerId, stamp);
    else if (playerId && !stamp && remote.has(playerId)) { URL.revokeObjectURL(remote.get(playerId).url); remote.delete(playerId); }
  }, [playerId, stamp, enabled]);
  if (!enabled || !playerId || !stamp) return null;
  return playerId === myId && own.url ? own.url : remote.get(playerId)?.url || null;
}

export function installIllustSync({ net }) {
  const offWelcome = net.on('welcome', () => { synced = null; void syncOwnIllust(); });
  const offStore = store.subscribe((state, previous) => {
    const members = new Set((state.room?.seats || []).filter(Boolean).map(seat => seat.playerId));
    let changed = false;
    for (const [playerId, picture] of remote) if (state.room?.code !== previous.room?.code || !members.has(playerId)) {
      URL.revokeObjectURL(picture.url); remote.delete(playerId); changed = true;
    }
    if (changed) notify();
  });
  return () => { offWelcome?.(); offStore(); };
}
