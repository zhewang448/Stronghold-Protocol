export function readImageInfo(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { type: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 255) { offset++; continue; }
      const marker = bytes[offset + 1];
      if (marker === 255 || marker === 1 || marker >= 208 && marker <= 216) { offset += marker === 255 ? 1 : 2; continue; }
      if (marker === 217 || marker === 218) return null;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) return null;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        return { type: 'image/jpeg', width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += length + 2;
    }
    return null;
  }
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 > bytes.length) return null;
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { type: 'image/webp', width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
    return { type: 'image/webp', width: bytes.readUInt16LE(26) & 16383, height: bytes.readUInt16LE(28) & 16383 };
  }
  if (kind === 'VP8L' && bytes[20] === 47) {
    const dimensions = bytes.readUInt32LE(21);
    return { type: 'image/webp', width: 1 + (dimensions & 16383), height: 1 + ((dimensions >>> 14) & 16383) };
  }
  return null;
}
