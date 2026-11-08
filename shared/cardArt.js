// Shared room illustration framing. It is cosmetic and independent of battle data.
export const CARD_ART_MIN_ZOOM = 0.5;
export const CARD_ART_MAX_ZOOM = 3;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function normalizeCardArt(value) {
  const number = (field, fallback) => typeof value?.[field] === 'number' && Number.isFinite(value[field]) ? value[field] : fallback;
  return { zoom: clamp(number('zoom', 1), CARD_ART_MIN_ZOOM, CARD_ART_MAX_ZOOM),
    ox: clamp(number('ox', 0), -100, 100), oy: clamp(number('oy', 0), -100, 100) };
}

export const isCardArtKey = value => typeof value === 'string' && value.length <= 256
  && (value === 'custom' || value === 'default' || /^char_[A-Za-z0-9_]+(?::[A-Za-z0-9_@#+.\-]+)?$/.test(value));

export function isCardArtFrame(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    && ['zoom', 'ox', 'oy'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
    && value.zoom >= CARD_ART_MIN_ZOOM && value.zoom <= CARD_ART_MAX_ZOOM
    && Math.abs(value.ox) <= 100 && Math.abs(value.oy) <= 100;
}

export function cardArtKey(charId, skinId = '') {
  return charId ? charId + (skinId ? ':' + skinId : '') : 'default';
}

/** A peer's missing or differently scoped frame must never use this viewer's local preferences. */
export function sharedCardArt(value, key) {
  return normalizeCardArt(value?.key === key ? value.frame : null);
}
