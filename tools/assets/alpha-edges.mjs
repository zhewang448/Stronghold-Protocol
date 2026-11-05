// Extend neighbouring opaque colour through a verified attachment's translucent
// edge. Alpha and opaque artwork are kept exactly; original downloads stay intact.
import { inflateSync, deflateSync } from 'node:zlib';
import { crc32 } from '../../server/plugins/zip.js';

export function decodeRgbaPng(bytes) {
  const chunks = [], idat = [];
  for (let p = 8; p < bytes.length;) {
    const n = bytes.readUInt32BE(p), type = bytes.toString('ascii', p + 4, p + 8);
    const chunk = bytes.subarray(p, p + n + 12); chunks.push({ type, bytes: chunk });
    if (type === 'IDAT') idat.push(bytes.subarray(p + 8, p + n + 8));
    p += n + 12;
  }
  const header = chunks.find(c => c.type === 'IHDR').bytes.subarray(8, 21);
  if (header[8] !== 8 || header[9] !== 6 || header[12] !== 0) throw new Error('Alpha correction requires an 8-bit RGBA non-interlaced PNG');
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), stride = width * 4;
  const raw = inflateSync(Buffer.concat(idat)), pixels = Buffer.alloc(stride * height);
  if (raw.length !== (stride + 1) * height) throw new Error('Invalid RGBA scanline length');
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error('Invalid PNG scanline filter');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? pixels[i - 4] : 0, b = y ? pixels[i - stride] : 0, c = y && x >= 4 ? pixels[i - stride - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const prediction = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      pixels[i] = (raw[y * (stride + 1) + x + 1] + prediction) & 255;
    }
  }
  return { width, height, pixels, chunks };
}

export function encodeRgbaPng(image) {
  const { width, height, pixels, chunks } = image, stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const data = deflateSync(raw), chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); chunk.write('IDAT', 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)) >>> 0, chunk.length - 4);
  let emitted = false;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks.flatMap(c => {
    if (c.type !== 'IDAT') return [c.bytes];
    if (emitted) return []; emitted = true; return [chunk];
  })]);
}

/** Rectangles use atlas page pixels, before rotation. No colour crosses an attachment's rectangle. */
export function extendAlphaEdges(pixels, width, height, rectangles, radius = 3) {
  const original = new Uint8Array(pixels); let changed = 0;
  for (const { x: x0, y: y0, width: w, height: h } of rectangles) {
    if (![x0, y0, w, h].every(Number.isInteger) || x0 < 0 || y0 < 0 || x0 + w > width || y0 + h > height) throw new Error('Attachment edge rectangle is outside its page');
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 4;
      if (original[i + 3] >= 250) continue;
      let distance = Infinity, count = 0, r = 0, g = 0, b = 0;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy, d = dx * dx + dy * dy;
        if (nx < x0 || nx >= x0 + w || ny < y0 || ny >= y0 + h || d > distance) continue;
        const j = (ny * width + nx) * 4;
        if (original[j + 3] < 250) continue;
        if (d < distance) { distance = d; count = r = g = b = 0; }
        count++; r += original[j]; g += original[j + 1]; b += original[j + 2];
      }
      if (count) {
        const rgb = [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
        if (rgb.some((v, k) => v !== pixels[i + k])) changed++;
        pixels[i] = rgb[0]; pixels[i + 1] = rgb[1]; pixels[i + 2] = rgb[2];
      }
    }
  }
  return changed;
}

export function atlasEdgeRectangles(text, names, page) {
  const lines = text.replace(/\r/g, '').split('\n'), result = [];
  let currentPage = null, region = null, fields = {};
  const finish = () => {
    if (currentPage === page && names.includes(region)) {
      const [x, y] = fields.xy.split(',').map(Number), [w, h] = fields.size.split(',').map(Number);
      const rotated = ['true', '90', '270'].includes(fields.rotate);
      result.push({ x, y, width: rotated ? h : w, height: rotated ? w : h });
    }
  };
  for (const line of lines) {
    if (!line.trim()) { finish(); currentPage = region = null; fields = {}; continue; }
    if (!currentPage) { currentPage = line.trim(); continue; }
    const colon = line.indexOf(':');
    if (colon >= 0) { fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim(); continue; }
    finish(); region = line.trim(); fields = {};
  }
  finish(); return result;
}
