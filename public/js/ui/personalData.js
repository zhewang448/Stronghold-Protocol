// Portable local profile; no reconnect tokens, permissions, caches or server credentials.
// The checksum detects damage, not ownership: the recovery code contains private data.
import { migrateStats, mergeStats } from './stats.js';
import { namespacedStorageKey } from '../../../shared/plugins/ui.js';

export const PERSONAL_DATA_VERSION = 1;
export const MAX_PERSONAL_BYTES = 128 * 1024 * 1024;
export const MAX_CODE_CHARS = 176 * 1024 * 1024;
const MAX_PREF_CHARS = 8 * 1024 * 1024;
const MAX_MEDIA_BYTES = 60 * 1024 * 1024;
const STATS = 'sp.pref.stats';
const omitted = new Set(['sp.pref.recentRooms', 'sp.pref.recentTestRooms', 'sp.pref.stats.damaged']);
export function personalKey(key) {
  if (typeof key !== 'string' || key.length > 256 || omitted.has(key)) return false;
  if (key === 'sp.name' || /^sp\.pref\.[^\x00-\x1f]+$/.test(key)) return true;
  const plugin = /^sp\.plugin\.([^.]+)\.(.+)$/.exec(key);
  return !!plugin && plugin[1] !== 'consent' && namespacedStorageKey(plugin[1], plugin[2]) === key;
}
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function unbase64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4) fail('invalid');
  try { return Uint8Array.from(atob(text), (c) => c.charCodeAt(0)); } catch { return fail('invalid'); }
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  return value >>> 0;
});
function checksum(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}
async function readBounded(stream) {
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_PERSONAL_BYTES) { await reader.cancel(); fail('too-large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.length; }
  return bytes;
}

export function validatePersonalData(raw) {
  if (!raw || raw.app !== 'stronghold-protocol' || raw.kind !== 'personal-data' || !Number.isInteger(raw.v)) fail('invalid');
  if (raw.v > PERSONAL_DATA_VERSION) fail('newer');
  if (raw.v !== PERSONAL_DATA_VERSION || !raw.entries || Array.isArray(raw.entries) || typeof raw.entries !== 'object') fail('invalid');
  const entries = Object.create(null);
  let size = 0;
  const rows = Object.entries(raw.entries);
  if (rows.length > 2000) fail('too-large');
  for (const [key, value] of rows) {
    if (!personalKey(key) || typeof value !== 'string') fail('invalid');
    size += key.length + value.length;
    if (size > MAX_PREF_CHARS) fail('too-large');
    if (key === 'sp.name') { if (value.length > 64 || /[\x00-\x1f]/.test(value)) fail('invalid'); }
    else { try { JSON.parse(value); } catch { fail('invalid'); } }
    entries[key] = value;
  }
  if (entries[STATS]) checkedStats(entries[STATS]);
  let backdrop = null;
  if (raw.backdrop != null) {
    const b = raw.backdrop;
    if (!b || !['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/x-m4v', 'video/quicktime'].includes(b.type) ||
        typeof b.data !== 'string' || b.data.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4) fail('invalid');
    const bytes = unbase64(b.data);
    if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) fail('too-large');
    backdrop = { type: b.type, data: b.data };
  }
  let music = null;
  if (raw.music != null) {
    const m = raw.music;
    if (!m || typeof m.name !== 'string' || m.name.length > 256 || typeof m.type !== 'string' ||
        !/^(audio\/[a-z0-9.+-]+|video\/webm|application\/ogg)$/.test(m.type) ||
        typeof m.data !== 'string' || m.data.length > Math.ceil(20 * 1024 * 1024 / 3) * 4 ||
        typeof m.paused !== 'boolean' || typeof m.enabled !== 'boolean') fail('invalid');
    const bytes = unbase64(m.data);
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) fail('too-large');
    music = { name: m.name, type: m.type, data: m.data, paused: m.paused, enabled: m.enabled };
  }
  return { app: raw.app, kind: raw.kind, v: raw.v, exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt.slice(0, 40) : '', entries, backdrop,
    ...(Object.hasOwn(raw, 'music') ? { music } : {}) };
}
function checkedStats(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { fail('invalid'); }
  if (!raw || !Array.isArray(raw.records)) fail('invalid');
  const result = migrateStats(raw);
  if (result.newer) fail('newer');
  if (result.dropped) fail('invalid');
  return result.stats;
}

export async function capturePersonalData(storage = globalThis.localStorage, readMedia = readBackdrop, readTrack = readMusic) {
  if (!storage) fail('storage');
  const entries = Object.create(null);
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (personalKey(key)) entries[key] = storage.getItem(key);
  }
  const blob = await readMedia();
  const backdrop = blob ? { type: blob.type, data: base64(new Uint8Array(await blob.arrayBuffer())) } : null;
  const track = await readTrack();
  const music = track?.blob ? { name: track.name || '', type: track.blob.type || 'audio/mpeg',
    data: base64(new Uint8Array(await track.blob.arrayBuffer())), paused: !!track.paused, enabled: !!track.enabled } : null;
  return validatePersonalData({ app: 'stronghold-protocol', kind: 'personal-data', v: 1, exportedAt: new Date().toISOString(), entries, backdrop, music });
}
export async function encodePersonalData(raw) {
  const bytes = new TextEncoder().encode(JSON.stringify(validatePersonalData(raw)));
  if (bytes.length > MAX_PERSONAL_BYTES) fail('too-large');
  const compressed = typeof CompressionStream === 'function';
  const packed = compressed ? await readBounded(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))) : bytes;
  return `SPDATA1.${compressed ? 'g' : 'j'}.${checksum(packed)}.${base64(packed)}`;
}
export async function decodePersonalData(code) {
  if (typeof code !== 'string' || code.length > MAX_CODE_CHARS) fail('too-large');
  const match = /^SPDATA1\.([gj])\.([a-f0-9]{8})\.([A-Za-z0-9+/=]+)$/.exec(code.trim());
  if (!match) fail('invalid');
  let bytes = unbase64(match[3]);
  if (bytes.length > MAX_PERSONAL_BYTES) fail('too-large');
  if (checksum(bytes) !== match[2]) fail('invalid');
  if (match[1] === 'g') {
    if (typeof DecompressionStream !== 'function') fail('compression');
    try { bytes = await readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))); }
    catch (err) { if (err.code === 'too-large') throw err; fail('invalid'); }
  }
  let raw;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('invalid'); }
  return validatePersonalData(raw);
}
export function personalSummary(raw) {
  const data = validatePersonalData(raw);
  return { name: data.entries['sp.name'] || '', count: Object.keys(data.entries).length,
    records: data.entries[STATS] ? checkedStats(data.entries[STATS]).records.length : 0, backdrop: !!data.backdrop, music: !!data.music, exportedAt: data.exportedAt };
}

// A single durable IDB transaction, shared with hubBackdrop.js's existing kv/image store.
function mediaStore(mode, fn, name = 'sp-hub-backdrop', table = 'kv') {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(Object.assign(new Error('storage'), { code: 'storage' })); return; }
    let abandoned = false;
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(table);
    open.onerror = () => reject(open.error);
    open.onblocked = () => { abandoned = true; reject(Object.assign(new Error('storage'), { code: 'storage' })); };
    open.onsuccess = () => {
      const db = open.result;
      if (abandoned) { db.close(); return; }
      try {
        const tx = db.transaction(table, mode), request = fn(tx.objectStore(table));
        tx.oncomplete = () => { db.close(); resolve(request.result ?? null); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (err) { db.close(); reject(err); }
    };
  });
}
export const readBackdrop = () => mediaStore('readonly', (s) => s.get('image'));
export const writeBackdrop = (blob) => mediaStore('readwrite', (s) => blob ? s.put(blob, 'image') : s.delete('image'));
export const readMusic = () => mediaStore('readonly', (s) => s.get('lobby'), 'sp-lobby-music', 'tracks');
export const writeMusic = (track) => mediaStore('readwrite', (s) => track ? s.put(track, 'lobby') : s.delete('lobby'), 'sp-lobby-music', 'tracks');

export async function restorePersonalData(raw, { storage = globalThis.localStorage, readMedia = readBackdrop, writeMedia = writeBackdrop,
  readTrack = readMusic, writeTrack = writeMusic, replace = false } = {}) {
  const data = validatePersonalData(raw), entries = { ...data.entries };
  if (!storage) fail('storage');
  if (entries[STATS] && !replace) {
    const current = storage.getItem(STATS);
    entries[STATS] = JSON.stringify(mergeStats(current ? checkedStats(current) : { records: [] }, checkedStats(entries[STATS])));
  }
  const keys = new Set(Object.keys(entries));
  if (replace) for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (personalKey(key)) keys.add(key); }
  const previous = new Map([...keys].map((key) => [key, storage.getItem(key)]));
  const changed = [], mediaChanged = replace || !!data.backdrop || Object.hasOwn(entries, 'sp.pref.hub.backdrop');
  const oldMedia = mediaChanged ? await readMedia() : null;
  const trackChanged = replace || Object.hasOwn(data, 'music');
  const oldTrack = trackChanged ? await readTrack() : null;
  let backdropWritten = false, trackWritten = false;
  try {
    if (mediaChanged) {
      await writeMedia(data.backdrop ? new Blob([unbase64(data.backdrop.data)], { type: data.backdrop.type }) : null);
      backdropWritten = true;
    }
    if (trackChanged) {
      await writeTrack(data.music ? { name: data.music.name, blob: new Blob([unbase64(data.music.data)], { type: data.music.type }),
        paused: data.music.paused, enabled: data.music.enabled } : null);
      trackWritten = true;
    }
    for (const key of keys) {
      const value = Object.hasOwn(entries, key) ? entries[key] : null;
      if (previous.get(key) === value) continue;
      if (value === null) storage.removeItem(key); else storage.setItem(key, value);
      changed.push(key);
      if (storage.getItem(key) !== value) fail('storage');
    }
  } catch (err) {
    try {
      for (const key of changed.reverse()) {
        const old = previous.get(key);
        if (old === null) storage.removeItem(key); else storage.setItem(key, old);
      }
      if (backdropWritten) await writeMedia(oldMedia);
      if (trackWritten) await writeTrack(oldTrack);
    } catch { fail('rollback'); }
    throw Object.assign(err, { code: 'storage' });
  }
  return personalSummary(data);
}

// A durable, origin-local undo point; never exported and never uploaded.
export const readRecoveryBackup = () => mediaStore('readonly', (s) => s.get('before-restore'), 'sp-recovery-backup');
export async function saveRecoveryBackup() {
  const data = await capturePersonalData();
  await mediaStore('readwrite', (s) => s.put(data, 'before-restore'), 'sp-recovery-backup');
}
export async function undoRecoveryBackup() {
  const data = await readRecoveryBackup();
  if (!data) fail('invalid');
  await restorePersonalData(data, { replace: true });
  await mediaStore('readwrite', (s) => s.delete('before-restore'), 'sp-recovery-backup');
}

export function migrationOrigin(value, current = globalThis.location?.origin) {
  let url;
  try { url = new URL(value); } catch { fail('origin'); }
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || url.origin === current) fail('origin');
  return url.origin;
}
export function validMigrationMessage(event, popup, origin, nonce) {
  return !!popup && event.source === popup && event.origin === origin && event.data?.type === 'sp.personal-data' && event.data?.nonce === nonce;
}
