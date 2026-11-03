export const ILLUST_MAX_BYTES = 2 * 1024 * 1024;
export const ILLUST_MAX_SIDE = 1536;
export const ILLUST_SOURCE_MAX_BYTES = 48 * 1024 * 1024;

export function illustrationCropRect({ width, height, zoom = 1, ox = 0, oy = 0 }) {
  const finite = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const sourceWidth = Math.max(1, finite(width, 1)), sourceHeight = Math.max(1, finite(height, 1));
  const scale = Math.max(1, Math.min(3, finite(zoom, 1)));
  const cropHeight = Math.min(sourceHeight, sourceWidth * 2) / scale, cropWidth = cropHeight / 2;
  const x = Math.max(0, Math.min(sourceWidth - cropWidth, (sourceWidth - cropWidth) / 2 - finite(ox, 0) / 100 * cropWidth));
  const y = Math.max(0, Math.min(sourceHeight - cropHeight, (sourceHeight - cropHeight) / 2 - finite(oy, 0) / 100 * cropHeight));
  return { x, y, width: cropWidth, height: cropHeight, zoom: scale,
    ox: ((sourceWidth - cropWidth) / 2 - x) / cropWidth * 100,
    oy: ((sourceHeight - cropHeight) / 2 - y) / cropHeight * 100 };
}
