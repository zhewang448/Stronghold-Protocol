import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ILLUST_MAX_BYTES } from '../../shared/illustration.js';
import { readImageInfo } from './imageInfo.js';

const PLAYER_ID = /^p_[0-9a-f]{10}$/;
const extensions = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };
const acceptable = info => info && info.width >= 64 && info.height >= 64 && info.width <= 2048 && info.height <= 2048
  && Math.max(info.width / info.height, info.height / info.width) <= 3;

export function createIllustStore({ dir = null, now = Date.now, minIntervalMs = 1500, maxTotalBytes = 128 * 1024 * 1024, log = null } = {}) {
  const records = new Map(), pending = new Set();
  let total = 0, sequence = 0, reserved = 0;
  const base = dir ? path.resolve(dir) : null;
  const entryOf = (playerId, bytes, filename, stamp) => ({ playerId, bytes, ...readImageInfo(bytes), file: filename, at: stamp,
    etag: '"' + createHash('sha256').update(bytes).digest('hex') + '"' });
  if (base && fs.existsSync(base)) for (const filename of fs.readdirSync(base)) {
    const match = /^(p_[0-9a-f]{10})\.(png|webp|jpg)$/.exec(filename);
    if (!match) continue;
    try {
      const full = path.join(base, filename), stat = fs.lstatSync(full);
      if (!stat.isFile() || stat.size > ILLUST_MAX_BYTES || total + stat.size > maxTotalBytes) continue;
      const bytes = fs.readFileSync(full);
      if (!acceptable(readImageInfo(bytes))) continue;
      const previous = records.get(match[1]);
      if (previous && previous.at >= stat.mtimeMs) continue;
      total += bytes.length - (previous?.bytes.length || 0);
      records.set(match[1], entryOf(match[1], bytes, full, stat.mtimeMs));
    } catch (error) { log?.warn?.('[illust] ' + error.message); }
  }
  return {
    get(playerId) { return records.get(playerId) || null; },
    get size() { return records.size; },
    get bytes() { return total; },
    async put(playerId, bytes) {
      if (!PLAYER_ID.test(playerId)) return { error: 'BAD_ID' };
      if (!Buffer.isBuffer(bytes) || !bytes.length) return { error: 'BAD_TYPE' };
      if (bytes.length > ILLUST_MAX_BYTES) return { error: 'TOO_LARGE' };
      const info = readImageInfo(bytes);
      if (!info) return { error: 'BAD_TYPE' };
      if (!acceptable(info)) return { error: 'BAD_DIMENSIONS' };
      const previous = records.get(playerId), stamp = now();
      if (pending.has(playerId) || previous && stamp - previous.at < minIntervalMs) return { error: 'RATE' };
      const reservation = Math.max(0, bytes.length - (previous?.bytes.length || 0));
      if (total + reserved + reservation > maxTotalBytes) return { error: 'STORAGE_FULL' };
      reserved += reservation;
      pending.add(playerId);
      const filename = base ? path.join(base, playerId + '.' + extensions[info.type]) : null;
      const temporary = filename ? path.join(base, '.tmp-' + playerId + '-' + process.pid + '-' + ++sequence) : null;
      try {
        if (base) {
          fs.mkdirSync(base, { recursive: true });
          await fsp.writeFile(temporary, bytes, { mode: 0o600 });
          await fsp.rename(temporary, filename);
          if (previous?.file && previous.file !== filename) await fsp.unlink(previous.file).catch(error => { if (error.code !== 'ENOENT') log?.warn?.('[illust] ' + error.message); });
        }
        const entry = entryOf(playerId, bytes, filename, stamp);
        total += bytes.length - (previous?.bytes.length || 0); records.set(playerId, entry);
        return { ok: true, entry };
      } catch (error) {
        if (temporary) await fsp.unlink(temporary).catch(() => {});
        log?.warn?.('[illust] ' + error.message); return { error: 'STORAGE' };
      } finally { reserved -= reservation; pending.delete(playerId); }
    },
    async remove(playerId) {
      if (pending.has(playerId)) return { error: 'RATE' };
      const previous = records.get(playerId);
      if (!previous) return { ok: true };
      pending.add(playerId);
      try {
        if (previous.file) await fsp.unlink(previous.file).catch(error => { if (error.code !== 'ENOENT') throw error; });
        records.delete(playerId); total -= previous.bytes.length; return { ok: true };
      } catch (error) { log?.warn?.('[illust] ' + error.message); return { error: 'STORAGE' }; }
      finally { pending.delete(playerId); }
    },
  };
}
