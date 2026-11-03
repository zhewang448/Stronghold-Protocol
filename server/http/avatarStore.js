// server/http/avatarStore.js — 自定义头像 the players upload (the maintainer's request of 2026-10-18): an in-memory map of
// playerId → one square picture, backed by one file per player in a local, git-ignored directory (default
// `.cache/avatars/`), served by `GET /avatar/<playerId>` and written by `POST /avatar`. It is our own small server, so
// the cache never evicts: every picture stays, and the directory is read back at start, so a restart loses nothing.
//
//   * a picture is written to a temporary file in the same directory and renamed into place, so a crash never leaves a
//     half-written picture behind (`.<playerId>-…`: `<playerId>.<ext>` — the name is the server's own playerId, never a
//     client-supplied path, and only `p_` + 10 hex is ever loaded or written);
//   * at start the directory is created if it is missing, leftover `.tmp-` files are removed, and every valid picture is
//     read back into memory (an invalid or corrupt file is skipped, not fatal);
//   * nothing here touches a room, a match, `cs` or the protocol: the client reads the pictures over plain HTTP, so the
//     feature is invisible to the game state and to the golden results.
//
// What a picture may be is enforced, never trusted: the bytes must be a real PNG, WebP or JPEG container of a square
// 32–512 px image (the client renders 256 × 256 before it uploads), at most AVATAR_MAX_BYTES. A type is read from the
// file's magic bytes, not from a header or a file name, and so are the dimensions. SVG (script and external refs),
// GIF, HTML and everything else are refused.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** Largest accepted picture (bytes). The client compresses to ≤ 128 KB before it uploads. */
export const AVATAR_MAX_BYTES = 128 * 1024;
/** Room for a request's headers/transfer framing above the picture itself. */
export const AVATAR_BODY_LIMIT = AVATAR_MAX_BYTES + 4096;
/** The square's side range (px). The client always sends 256. */
export const AVATAR_MIN_SIDE = 32;
export const AVATAR_MAX_SIDE = 512;
/** One player may replace their picture at most once in this window (a burst of uploads is refused with 429). */
export const AVATAR_MIN_INTERVAL_MS = 1500;
/** Accepted container → the file name extension it is stored under. */
export const AVATAR_EXT = Object.freeze({ 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' });

const PLAYER_ID_RE = /^p_[0-9a-f]{10}$/;
const STORED_FILE_RE = /^(p_[0-9a-f]{10})\.(png|webp|jpg|jpeg)$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * The picture's real type and size, read from its own bytes.
 * @param {Buffer} bytes
 * @returns {{ type: 'image/png'|'image/webp'|'image/jpeg', width: number, height: number } | null} null when the
 *   bytes are not one of the three accepted containers (or are truncated/inconsistent)
 */
export function readImageInfo(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16) return null;
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    // signature + IHDR chunk: length 13, 'IHDR', width, height (both big-endian, > 0)
    if (bytes.length < 24 || bytes.readUInt32BE(8) !== 13 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { type: 'image/png', width, height } : null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let i = 2;
    while (i + 8 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      let marker = bytes[i + 1];
      while (marker === 0xff) { i++; marker = bytes[i + 1]; }
      // stand-alone markers (SOI, TEM, RSTn) carry no length
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null; // EOI / start of scan before any frame header
      const length = bytes.readUInt16BE(i + 2);
      if (length < 2) return null;
      if (SOF_MARKERS.has(marker)) {
        if (i + 9 >= bytes.length) return null;
        const height = bytes.readUInt16BE(i + 5);
        const width = bytes.readUInt16BE(i + 7);
        return width > 0 && height > 0 ? { type: 'image/jpeg', width, height } : null;
      }
      i += 2 + length;
    }
    return null;
  }
  if (bytes.length >= 30 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') {
      // lossy: 3-byte frame tag, the 0x9d 0x01 0x2a start code, then 14-bit width and height
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      const width = bytes.readUInt16LE(26) & 0x3fff;
      const height = bytes.readUInt16LE(28) & 0x3fff;
      return width > 0 && height > 0 ? { type: 'image/webp', width, height } : null;
    }
    if (chunk === 'VP8L') {
      // lossless: 0x2f, then 14 bits width − 1 and 14 bits height − 1 (little-endian)
      if (bytes[20] !== 0x2f) return null;
      const bits = bytes.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { type: 'image/webp', width, height };
    }
    if (chunk === 'VP8X') {
      // extended: 1 flag byte + 3 reserved, then 24-bit canvas width − 1 and height − 1
      const width = bytes.readUIntLE(24, 3) + 1;
      const height = bytes.readUIntLE(27, 3) + 1;
      return { type: 'image/webp', width, height };
    }
  }
  return null;
}

/** The entry's strong ETag: the picture's own hash, quoted. */
function etagOf(bytes) {
  return `"${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}"`;
}

/**
 * The avatar store: every player's picture in memory, mirrored to `dir` (one file each), loaded back at start.
 * @param {{ dir?: string|null, maxBytes?: number, minIntervalMs?: number, now?: () => number,
 *           log?: { info?: Function, warn?: Function } | null }} [opts]
 *   dir: the picture directory (created when missing; null / uncreatable = memory only); now: the clock (tests)
 */
export function createAvatarStore({ dir = null, maxBytes = AVATAR_MAX_BYTES, minIntervalMs = AVATAR_MIN_INTERVAL_MS,
  now = Date.now, log = null } = {}) {
  /** @type {Map<string, { playerId: string, bytes: Buffer, type: string, etag: string, width: number, height: number,
   *   at: number, lastPutAt: number, file: string|null }>} */
  const map = new Map();
  let total = 0;
  let baseDir = null;
  let seq = 0;

  if (dir) {
    const resolved = path.resolve(dir);
    try {
      fs.mkdirSync(resolved, { recursive: true });
      baseDir = resolved;
    } catch (err) {
      log?.warn?.(`[avatar] cannot use ${resolved}: ${err?.message || err} — pictures stay in memory`);
    }
  }

  /** Put one validated entry into the map (and count its bytes). */
  function remember(playerId, bytes, type, file, at, lastPutAt) {
    const prev = map.get(playerId);
    if (prev) total -= prev.bytes.length;
    const entry = { playerId, bytes, type, etag: etagOf(bytes), width: 0, height: 0, at, lastPutAt, file };
    const info = readImageInfo(bytes);
    if (info) { entry.width = info.width; entry.height = info.height; }
    map.set(playerId, entry);
    total += bytes.length;
    return entry;
  }

  /** Read the directory once, at start: every valid picture comes back (temp and foreign files are ignored). */
  function load() {
    if (!baseDir) return;
    let names;
    try { names = fs.readdirSync(baseDir); } catch (err) {
      log?.warn?.(`[avatar] cannot read ${baseDir}: ${err?.message || err}`);
      return;
    }
    let loaded = 0;
    let skipped = 0;
    for (const name of names) {
      if (name.startsWith('.tmp-')) { try { fs.unlinkSync(path.join(baseDir, name)); } catch { /* gone */ } continue; }
      const m = STORED_FILE_RE.exec(name);
      if (!m) continue;
      const file = path.join(baseDir, name);
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > maxBytes) { skipped++; continue; }
        const bytes = fs.readFileSync(file);
        const info = readImageInfo(bytes);
        if (!info || info.width !== info.height || info.width < AVATAR_MIN_SIDE || info.width > AVATAR_MAX_SIDE) { skipped++; continue; }
        // two files for one player (a crash between the rename and the old format's removal): the newer file wins
        const existing = map.get(m[1]);
        if (existing && existing.at >= (Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0)) { skipped++; continue; }
        remember(m[1], bytes, info.type, file, Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0, 0);
        loaded++;
      } catch {
        skipped++; // a file that vanished / cannot be read: not fatal
      }
    }
    if (loaded || skipped) log?.info?.(`[avatar] ${loaded} picture(s) loaded from ${baseDir}${skipped ? `, ${skipped} skipped` : ''}`);
  }
  load();

  /** The file a picture of `playerId` and `type` is stored as, or null without a directory. */
  const fileFor = (playerId, type) => (baseDir ? path.join(baseDir, `${playerId}.${AVATAR_EXT[type] || 'bin'}`) : null);
  /** A temporary file beside it (same volume: the rename is atomic). */
  const tempFor = (playerId) => path.join(baseDir, `.tmp-${playerId}-${process.pid}-${++seq}`);

  return {
    /**
     * Store one player's picture, replacing the previous one on disk and in memory.
     * @param {string} playerId the session's own id (never a client-supplied one)
     * @param {Buffer} bytes
     * @returns {Promise<{ ok: true, entry: object } | { ok: false, code:
     *   'TOO_LARGE'|'BAD_TYPE'|'BAD_DIMENSIONS'|'RATE'|'BAD_ID'|'STORAGE' }>}
     */
    async put(playerId, bytes) {
      if (typeof playerId !== 'string' || !PLAYER_ID_RE.test(playerId)) return { ok: false, code: 'BAD_ID' };
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) return { ok: false, code: 'BAD_TYPE' };
      if (bytes.length > maxBytes) return { ok: false, code: 'TOO_LARGE' };
      const info = readImageInfo(bytes);
      if (!info) return { ok: false, code: 'BAD_TYPE' };
      if (info.width !== info.height || info.width < AVATAR_MIN_SIDE || info.width > AVATAR_MAX_SIDE) {
        return { ok: false, code: 'BAD_DIMENSIONS' };
      }
      const at = now();
      const prev = map.get(playerId);
      if (prev && at - prev.lastPutAt < minIntervalMs) return { ok: false, code: 'RATE' };
      const file = fileFor(playerId, info.type);
      if (file) {
        const temp = tempFor(playerId);
        try {
          await fsp.writeFile(temp, bytes, { mode: 0o600 });
          await fsp.rename(temp, file); // atomic on one volume; replaces a picture of the same extension
        } catch (err) {
          try { await fsp.unlink(temp); } catch { /* nothing to clean */ }
          log?.warn?.(`[avatar] cannot write ${file}: ${err?.message || err}`);
          return { ok: false, code: 'STORAGE' };
        }
        // a replacement in another format leaves the old file behind — remove it after the new one is in place
        if (prev?.file && prev.file !== file) { try { await fsp.unlink(prev.file); } catch { /* gone */ } }
      }
      return { ok: true, entry: remember(playerId, bytes, info.type, file, at, at) };
    },
    /** The player's picture, or null. */
    get(playerId) { return map.get(playerId) || null; },
    /**
     * Remove the player's picture (memory and disk).
     * @returns {Promise<boolean>} whether there was one
     */
    async remove(playerId) {
      const cur = map.get(playerId);
      if (!cur) return false;
      map.delete(playerId);
      total -= cur.bytes.length;
      if (cur.file) {
        try { await fsp.unlink(cur.file); } catch (err) {
          if (err?.code !== 'ENOENT') log?.warn?.(`[avatar] cannot remove ${cur.file}: ${err?.message || err}`);
        }
      }
      return true;
    },
    /** Number of pictures held (the `/healthz` count). */
    get size() { return map.size; },
    /** Bytes held by every picture. */
    get bytes() { return total; },
    /** The directory pictures are mirrored to (null: memory only). */
    get dir() { return baseDir; },
    /** Bounds and the current use (tests, diagnostics). */
    stats() { return { entries: map.size, bytes: total, dir: baseDir }; },
  };
}
