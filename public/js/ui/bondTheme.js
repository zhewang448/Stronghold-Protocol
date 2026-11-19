// Official bond-disc layers. Geometry and background files come from bond_icon_view_item;
// the shared board sprites supply the real segmented rim. No extracted artwork is shipped in source.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { nodeById, scriptRef } from './prefab/layout.js';

const clamp = (value) => Math.max(0, Math.min(1, value));
const byName = (root, name) => {
  if (root?.name === name) return root;
  for (const child of root?.children || []) {
    const found = byName(child, name);
    if (found) return found;
  }
  return null;
};

/** Resolve the controller's own nodes; missing or incomplete packs keep the ordinary disc. @param {any} pack */
export function bondThemeFromPack(pack) {
  const root = pack?.doc?.prefabs?.['bondicon/bond_icon_view_item'];
  if (!root || typeof pack?.sprite !== 'function') return null;
  const selected = nodeById(root, scriptRef(root, '_select')) || byName(root, 'img_active');
  const unselected = nodeById(root, scriptRef(root, '_unselect')) || byName(root, 'img_inactive');
  const icon = nodeById(root, scriptRef(root, '_imgBondIcon'));
  const total = nodeById(root, scriptRef(root, '_imgBoardTotal'));
  const actual = nodeById(root, scriptRef(root, '_imgBoard'));
  const width = Number(root.rect?.sizeDelta?.[0]);
  const iconWidth = Number(icon?.rect?.sizeDelta?.[0]);
  const back = selected?.rect?.sizeDelta;
  const active = selected?.image && pack.sprite(selected.image.sprite, selected.image.file);
  const inactive = unselected?.image && pack.sprite(unselected.image.sprite, unselected.image.file);
  if (!(width > 0 && iconWidth > 0 && back?.[0] > 0 && back?.[1] > 0) || !active || !inactive || !total || !actual) return null;
  return {
    id: pack.doc.id || pack.group?.split('/').pop() || '',
    rootWidth: width, iconRatio: iconWidth / width,
    backWidth: back[0], backHeight: back[1], active, inactive,
    totalColor: total.image?.color || '#535353CC',
  };
}

/** Native board sprites stop at four stages; larger plugin bonds keep all their SVG segments. */
export function bondRimKey(maxTier, tier) {
  if (!Number.isInteger(maxTier) || maxTier < 1 || maxTier > 4) return null;
  const reached = Math.max(0, Math.min(maxTier, tier | 0));
  return `bondBoardIcon/${reached ? `${maxTier}_${reached}` : '1_0'}`;
}

/**
 * Separate the original mint actual-rim and neutral total-rim through their original alpha.
 * [ASSUMED] These colour mattes and the 21.5px centre cut reproduce the approved preview,
 * not the Unity material itself. Arc ends, gaps, antialiasing and footprint remain the source sprite's.
 * @param {Uint8ClampedArray} rgba @param {number} width @param {number} height
 */
export function bondRimMasks(rgba, width, height) {
  const lit = new Uint8ClampedArray(rgba.length);
  const track = new Uint8ClampedArray(rgba.length);
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const r = rgba[offset], g = rgba[offset + 1], b = rgba[offset + 2], a = rgba[offset + 3];
      const rim = clamp((Math.hypot(x - cx, y - cy) - 21.5) / 1.2);
      const active = clamp((g - r - 20) / 140);
      const inactive = clamp((Math.min(r, g, b) - 60) / 95);
      lit.set([255, 255, 255, Math.round(a * active * rim)], offset);
      track.set([255, 255, 255, Math.round(a * inactive * (1 - active) * rim)], offset);
    }
  }
  return { lit, track };
}

/** A bounded cache also shares in-flight image work and remembers a failed URL until its revision changes. */
export function createBondRimCache(load, limit = 64) {
  const entries = new Map();
  return {
    peek: (url) => entries.get(url) || null,
    get(url) {
      if (entries.has(url)) return entries.get(url);
      const entry = { ready: false, value: null, promise: null };
      entry.promise = Promise.resolve().then(() => load(url)).catch(() => null).then((value) => {
        entry.ready = true; entry.value = value; return value;
      });
      entries.set(url, entry);
      if (entries.size > limit) entries.delete(entries.keys().next().value);
      return entry;
    },
  };
}

/** Browser-only derived masks; a missing sprite, unavailable canvas or CORS failure keeps the SVG fallback. */
function loadBondRim(url) {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onerror = () => resolve(null);
    image.onload = () => {
      try {
        const w = image.naturalWidth, h = image.naturalHeight;
        if (!w || !h || w > 128 || h > 128) { resolve(null); return; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) { resolve(null); return; }
        context.drawImage(image, 0, 0);
        const masks = bondRimMasks(context.getImageData(0, 0, w, h).data, w, h);
        const paint = (pixels) => {
          const output = context.createImageData(w, h);
          output.data.set(pixels); context.putImageData(output, 0, 0);
          return canvas.toDataURL('image/png');
        };
        resolve({ url, w, h, lit: paint(masks.lit), track: paint(masks.track) });
      } catch { resolve(null); }
    };
    image.src = url;
  });
}

const rims = createBondRimCache(loadBondRim);

/** A late image must never paint the rim of a different stage or asset revision. @param {string|null} url */
export function useBondRim(url) {
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (!url) { setLoaded(null); return undefined; }
    let live = true;
    const entry = rims.get(url);
    if (entry.ready) setLoaded({ url, rim: entry.value });
    else entry.promise.then((rim) => { if (live) setLoaded({ url, rim }); });
    return () => { live = false; };
  }, [url]);
  return loaded?.url === url ? loaded.rim : rims.peek(url)?.value || null;
}
