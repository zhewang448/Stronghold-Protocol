// Shared ZIP reader for packaging and the local console updater.
import fs from 'node:fs';
import zlib from 'node:zlib';

/** Read `len` bytes at `pos` of an open file. */
function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = fs.readSync(fd, buf, got, len - got, pos + got);
    if (n <= 0) throw new Error('unexpected end of the zip file');
    got += n;
  }
  return buf;
}

const SIG = { eocd: 0x06054b50, loc64: 0x07064b50, eocd64: 0x06064b50, central: 0x02014b50, local: 0x04034b50 };
const U32 = 0xffffffff;

/**
 * The name of the central-directory entry at `p`: the header bytes when flag bit 11 marks them UTF-8; otherwise the
 * Info-ZIP Unicode Path extra field (0x7075, APPNOTE 4.6.9) when its CRC matches the header name — Info-ZIP's zip on
 * Windows stores a non-ASCII name in the system code page and the UTF-8 name only there; without that field the header
 * bytes, read as UTF-8 (an ASCII name).
 */
function entryName(cd, p, flags, nameLen, extraLen) {
  const raw = cd.subarray(p + 46, p + 46 + nameLen);
  if (!(flags & 0x800)) {
    for (let q = p + 46 + nameLen, end = q + extraLen; q + 4 <= end;) {
      const id = cd.readUInt16LE(q);
      const len = cd.readUInt16LE(q + 2);
      if (id === 0x7075 && len >= 5 && cd[q + 4] === 1 && q + 4 + len <= end
        && (typeof zlib.crc32 !== 'function' || (zlib.crc32(raw) >>> 0) === cd.readUInt32LE(q + 5))) {
        return cd.toString('utf8', q + 9, q + 4 + len);
      }
      q += 4 + len;
    }
  }
  return raw.toString('utf8');
}

/**
 * Call `onFile(name, data)` for every file entry of a zip (directories skipped), in central-directory order.
 * @param {string} zipPath
 * @param {(name: string, data: Buffer) => void} onFile
 */
export function readZip(zipPath, onFile) {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 22 + 65535);
    const tail = readAt(fd, size - tailLen, tailLen);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === SIG.eocd) { e = i; break; }
    if (e < 0) throw new Error('not a zip file (no end of central directory)');
    let count = tail.readUInt16LE(e + 10);
    let cdSize = tail.readUInt32LE(e + 12);
    let cdOffset = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdSize === U32 || cdOffset === U32) {
      const locPos = size - tailLen + e - 20;
      const loc = locPos >= 0 ? readAt(fd, locPos, 20) : null;
      if (!loc || loc.readUInt32LE(0) !== SIG.loc64) throw new Error('zip64 locator missing');
      const rec = readAt(fd, Number(loc.readBigUInt64LE(8)), 56);
      if (rec.readUInt32LE(0) !== SIG.eocd64) throw new Error('zip64 end record missing');
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    const cd = readAt(fd, cdOffset, cdSize);
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG.central) throw new Error('damaged central directory');
      const madeBy = cd.readUInt16LE(p + 4);
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      let packedSize = cd.readUInt32LE(p + 20);
      let rawSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const external = cd.readUInt32LE(p + 38);
      let offset = cd.readUInt32LE(p + 42);
      const name = entryName(cd, p, flags, nameLen, extraLen);
      if (packedSize === U32 || rawSize === U32 || offset === U32) {
        // the zip64 extra field carries the values the header marks 0xFFFFFFFF, in this order
        for (let q = p + 46 + nameLen, end = q + extraLen; q + 4 <= end;) {
          const id = cd.readUInt16LE(q);
          const len = cd.readUInt16LE(q + 2);
          if (id === 1) {
            let r = q + 4;
            if (rawSize === U32) { rawSize = Number(cd.readBigUInt64LE(r)); r += 8; }
            if (packedSize === U32) { packedSize = Number(cd.readBigUInt64LE(r)); r += 8; }
            if (offset === U32) { offset = Number(cd.readBigUInt64LE(r)); r += 8; }
            break;
          }
          q += 4 + len;
        }
      }
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;
      if ((madeBy >> 8) === 3 && ((external >>> 16) & 0o170000) === 0o120000) throw new Error(`${name}: a symbolic link (release zips have none)`);
      if (flags & 1) throw new Error(`${name}: encrypted`);
      const local = readAt(fd, offset, 30);
      if (local.readUInt32LE(0) !== SIG.local) throw new Error(`${name}: damaged local header`);
      const packed = readAt(fd, offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28), packedSize);
      let data;
      if (method === 0) data = packed;
      else if (method === 8) {
        try { data = zlib.inflateRawSync(packed); } catch (err) { throw new Error(`${name}: ${err.message}`, { cause: err }); }
      } else throw new Error(`${name}: compression method ${method} (only stored and deflated entries)`);
      if (data.length !== rawSize) throw new Error(`${name}: ${data.length} bytes, the directory says ${rawSize}`);
      if (typeof zlib.crc32 === 'function' && (zlib.crc32(data) >>> 0) !== crc) throw new Error(`${name}: CRC mismatch (a damaged zip)`);
      onFile(name, data);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Total uncompressed file bytes from the ZIP central directory, without extracting or allocating file bodies. */
export function zipUnpackedSize(zipPath) {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const size = fs.fstatSync(fd).size, tailLen = Math.min(size, 22 + 65535), tail = readAt(fd, size - tailLen, tailLen);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === SIG.eocd) { e = i; break; }
    if (e < 0) throw new Error('not a zip file (no end of central directory)');
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOffset = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdSize === U32 || cdOffset === U32) {
      const locPos = size - tailLen + e - 20, loc = locPos >= 0 ? readAt(fd, locPos, 20) : null;
      if (!loc || loc.readUInt32LE(0) !== SIG.loc64) throw new Error('zip64 locator missing');
      const rec = readAt(fd, Number(loc.readBigUInt64LE(8)), 56);
      if (rec.readUInt32LE(0) !== SIG.eocd64) throw new Error('zip64 end record missing');
      count = Number(rec.readBigUInt64LE(32)); cdSize = Number(rec.readBigUInt64LE(40)); cdOffset = Number(rec.readBigUInt64LE(48));
    }
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(cdSize) || !Number.isSafeInteger(cdOffset)
      || cdSize < 0 || cdOffset < 0 || cdOffset + cdSize > size) throw new Error('invalid ZIP central directory size');
    const cd = readAt(fd, cdOffset, cdSize); let p = 0, total = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG.central) throw new Error('damaged central directory');
      let raw = cd.readUInt32LE(p + 24); const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
      if (raw === U32) {
        for (let q = p + 46 + nameLen, end = q + extraLen; q + 4 <= end;) {
          const id = cd.readUInt16LE(q), len = cd.readUInt16LE(q + 2);
          if (q + 4 + len > end) throw new Error('damaged ZIP extra field');
          if (id === 1) { raw = Number(cd.readBigUInt64LE(q + 4)); break; }
          q += 4 + len;
        }
      }
      if (!Number.isSafeInteger(raw) || raw < 0 || !Number.isSafeInteger(total + raw)) throw new Error('ZIP uncompressed size exceeds safe limit');
      total += raw; p += 46 + nameLen + extraLen + commentLen;
    }
    if (p !== cd.length) throw new Error('central directory length mismatch');
    return total;
  } finally { fs.closeSync(fd); }
}
