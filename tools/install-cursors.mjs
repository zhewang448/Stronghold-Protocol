#!/usr/bin/env node
// Explicit, pinned third-party art download. Outputs stay in ignored public/assets.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { decodeRgbaPng, encodeRgbaPng } from './assets/alpha-edges.mjs';
import { crc32 } from '../server/plugins/zip.js';
import { CURSOR_SIZES, DEFAULT_CURSOR_SIZE, cursorHotspot } from '../shared/cursor.js';

export const CURSOR_SOURCE = 'e1249037536f46e0f39ad93e359cf29bf61aae80';
const HASHES = { 'art.bin': '989ab559e8710c645e3924293e90cd136ee90f6deeb98f9f0209bc177ebdcf44', 'fx.bin': '8b4081ea85cc53e1b4743e164c5d1591f02a84168ff18be1aea8a5d25e77e577' };
const FRAMES = { normal: ['art.bin', 'Arrow', 0], pointer: ['art.bin', 'Hand', 0], pressed: ['fx.bin', 'hand_normal', 106],
  'pointer-pressed': ['fx.bin', 'hand_link', 106], grab: ['fx.bin', 'grab_enter', 11], grabbing: ['fx.bin', 'grab_loop', 0],
  text: ['art.bin', 'IBeam', 0], disabled: ['art.bin', 'No', 0] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Area resampling in premultiplied alpha, directly from the 96 px master. */
export function cursorPng(bytes, size = DEFAULT_CURSOR_SIZE) {
  if (!CURSOR_SIZES.includes(size)) throw new Error('Unsupported cursor size');
  const image = decodeRgbaPng(bytes);
  if (image.width !== 96 || image.height !== 96) throw new Error('Cursor source must be 96x96 RGBA');
  if (size === 96) return bytes;
  const pixels = Buffer.alloc(size * size * 4), scale = 96 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let alpha = 0; const rgb = [0, 0, 0];
    for (let sy = Math.floor(y * scale); sy < Math.ceil((y + 1) * scale); sy++) for (let sx = Math.floor(x * scale); sx < Math.ceil((x + 1) * scale); sx++) {
      const weight = Math.max(0, Math.min((x + 1) * scale, sx + 1) - Math.max(x * scale, sx))
        * Math.max(0, Math.min((y + 1) * scale, sy + 1) - Math.max(y * scale, sy));
      const i = (sy * 96 + sx) * 4, a = image.pixels[i + 3] * weight;
      alpha += a;
      for (let c = 0; c < 3; c++) rgb[c] += image.pixels[i + c] * a;
    }
    const i = (y * size + x) * 4;
    pixels[i + 3] = Math.round(alpha / (scale * scale));
    if (alpha) for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(rgb[c] / alpha);
  }
  const header = Buffer.from(image.chunks.find(c => c.type === 'IHDR').bytes);
  header.writeUInt32BE(size, 8); header.writeUInt32BE(size, 12);
  header.writeUInt32BE(crc32(header.subarray(4, -4)) >>> 0, header.length - 4);
  return encodeRgbaPng({ width: size, height: size, pixels, chunks: image.chunks.map(c => c.type === 'IHDR' ? { ...c, bytes: header } : c) });
}

export async function installCursors({ root = resolve(import.meta.dirname, '..'), offline = false } = {}) {
  const output = resolve(root, 'public/assets/cursor/arknights-e1249037'), cache = resolve(root, '.cache/cursor-source');
  await mkdir(cache, { recursive: true }); await mkdir(output, { recursive: true });
  const packs = {};
  for (const [file, expected] of Object.entries(HASHES)) {
    let bytes;
    try { bytes = await readFile(resolve(cache, file)); } catch { /* explicit download below */ }
    if (bytes && hash(bytes) !== expected) throw new Error(`Cursor cache checksum mismatch: ${file}`);
    if (!bytes) {
      if (offline) throw new Error(`Missing cached cursor source: ${file}`);
      const url = `https://raw.githubusercontent.com/DoingStone/Arknights-Mouse/${CURSOR_SOURCE}/src/arkmouse/${file}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
      if (!response.ok) throw new Error(`Cursor download HTTP ${response.status}: ${file}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (hash(bytes) !== expected) throw new Error(`Cursor source checksum mismatch: ${file}`);
      await writeFile(resolve(cache, file), bytes);
    }
    if (bytes.subarray(0, 8).toString('ascii') !== 'AKPT1\0\0\0') throw new Error(`Invalid cursor pack: ${file}`);
    const length = bytes.readUInt32LE(8), index = JSON.parse(bytes.toString('utf8', 12, 12 + length));
    packs[file] = { bytes, base: 12 + length, roles: index.roles || index };
  }
  const files = [];
  for (const size of CURSOR_SIZES) {
    await mkdir(resolve(output, String(size)), { recursive: true });
    for (const [name, [pack, family, frame]] of Object.entries(FRAMES)) {
      const source = packs[pack], info = source.roles[family], [offset, length] = info.frames[frame];
      const bytes = cursorPng(source.bytes.subarray(source.base + offset, source.base + offset + length), size);
      const relative = `${size}/${name}.png`, file = resolve(output, relative), temporary = file + '.tmp';
      await writeFile(temporary, bytes); await rename(temporary, file);
      files.push({ file: relative, size, bytes: bytes.length, sha256: hash(bytes), hotspot: cursorHotspot(size, name), family, frame });
      // Keep the original 32 px paths for existing pages and rollback copies.
      if (size === 32) await writeFile(resolve(output, name + '.png'), bytes);
    }
  }
  await writeFile(resolve(output, 'provenance.json'), JSON.stringify({ source: `https://github.com/DoingStone/Arknights-Mouse/tree/${CURSOR_SOURCE}`,
    artwork: 'PRTS Replica v8 96x; third-party artwork, not covered by the source code MIT license; non-commercial only',
    sourceHashes: HASHES, defaultSize: DEFAULT_CURSOR_SIZE, sizes: CURSOR_SIZES,
    transform: 'Area resampling in premultiplied alpha from 96 px master; 96 px retains original bytes', files }, null, 2) + '\n');
  return { directory: output, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await installCursors({ offline: process.argv.includes('--offline') }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
