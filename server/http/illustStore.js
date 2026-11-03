// server/http/illustStore.js — 自定义立绘 the players upload, in the spirit of avatarStore.js (ported from hex031):
// an in-memory map of playerId → one picture, mirrored to one file per player in a local, git-ignored directory
// (default `.cache/illusts/`), served by `GET /illust/<playerId>` and written by `POST /illust` / `DELETE /illust`.
//
//   * a picture is written to a temporary file in the same directory and renamed into place, so a crash never leaves a
//     half-written picture behind; the name is the server's own playerId, never a client-supplied path;
//   * at start the directory is created if it is missing, leftover `.tmp-` files are removed, and every valid picture is
//     read back into memory (an invalid or corrupt file is skipped, not fatal);
//   * nothing here touches a room, a match, `cs` or the protocol: the page reads the pictures over plain HTTP, and the
//     host's room switch (room.customIllust) only decides whether a seat card draws one. So the feature is invisible to
//     the game state and to the golden results.
//
// What a picture may be is enforced, never trusted: the bytes must be a real PNG, WebP or JPEG container (magic bytes,
// never a header or file name) of 64–2048 px on each side and at most 3:1 in either direction (a seat card is 1:2, so
// the client downscales the long side to 1 536 before it uploads), at most ILLUST_MAX_BYTES.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readImageInfo } from './avatarStore.js';

/** Largest accepted picture (bytes): 2 MB — a seat-card illustration, not a full-resolution artwork. */
export const ILLUST_MAX_BYTES = 2 * 1024 * 1024;
/** Room for a request's headers / transfer framing above the picture itself. */
export const ILLUST_BODY_LIMIT = ILLUST_MAX_BYTES + 4096;
/** Side bounds (px). The client downscales the long side to ≤ 1536. */
export const ILLUST_MIN_SIDE = 64;
export const ILLUST_MAX_SIDE = 2048;
/** The widest aspect accepted in either direction (a seat card is 1:2; 3:1 still cover-crops sensibly). */
export const ILLUST_MAX_ASPECT = 3;
/** One player may replace their picture at most once in this window (a burst of uploads is refused with 429). */
export const ILLUST_MIN_INTERVAL_MS = 1500;
/** Accepted container → the file name extension it is stored under. */
export const ILLUST_EXT = Object.freeze({ 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' });

const PLAYER_ID_RE = /^p_[0-9a-f]{10}$/;
const STORED_FILE_RE = /^(p_[0-9a-f]{10})\.(png|webp|jpg|jpeg)$/;

/** The entry's strong ETag: the picture's own hash, quoted. */
function etagOf(bytes) {
  return `"${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}"`;
}

/** Is a decoded picture inside the bounds this store accepts? */
function acceptable(info) {
  if (!info) return false;
  const { width: w, height: h } = info;
  if (w < ILLUST_MIN_SIDE || h < ILLUST_MIN_SIDE || w > ILLUST_MAX_SIDE || h > ILLUST_MAX_SIDE) return false;
  return Math.max(w / h, h / w) <= ILLUST_MAX_ASPECT;
}

/**
 * The illustration store: every player's picture in memory, mirrored to `dir` (one file each), loaded back at start.
 * @param {{ dir?: string|null, maxBytes?: number, minIntervalMs?: number, now?: () => number,
 *           log?: { info?: Function, warn?: Function } | null }} [opts]
 *   dir: the picture directory (created when missing; null / uncreatable = memory only); now: the clock (tests)
 */
export function createIllustStore({ dir = null, maxBytes = ILLUST_MAX_BYTES, minIntervalMs = ILLUST_MIN_INTERVAL_MS,
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
      log?.warn?.(`[illust] cannot use ${resolved}: ${err?.message || err} — pictures stay in memory`);
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
      log?.warn?.(`[illust] cannot read ${baseDir}: ${err?.message || err}`);
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
        if (!acceptable(info)) { skipped++; continue; }
        // two files for one player (a crash between the rename and the old format's removal): the newer file wins
        const existing = map.get(m[1]);
        if (existing && existing.at >= (Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0)) { skipped++; continue; }
        remember(m[1], bytes, info.type, file, Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0, 0);
        loaded++;
      } catch {
        skipped++; // a file that vanished / cannot be read: not fatal
      }
    }
    if (loaded || skipped) log?.info?.(`[illust] ${loaded} picture(s) loaded from ${baseDir}${skipped ? `, ${skipped} skipped` : ''}`);
  }
  load();

  /** The file a picture of `playerId` and `type` is stored as, or null without a directory. */
  const fileFor = (playerId, type) => (baseDir ? path.join(baseDir, `${playerId}.${ILLUST_EXT[type] || 'bin'}`) : null);
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
      if (!acceptable(info)) return { ok: false, code: 'BAD_DIMENSIONS' };
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
          log?.warn?.(`[illust] cannot write ${file}: ${err?.message || err}`);
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
          if (err?.code !== 'ENOENT') log?.warn?.(`[illust] cannot remove ${cur.file}: ${err?.message || err}`);
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
