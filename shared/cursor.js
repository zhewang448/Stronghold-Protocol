// Browser presentation sizes, independent of battle content.
export const CURSOR_SIZES = Object.freeze([32, 48, 64, 80, 96, 112, 128]);
export const DEFAULT_CURSOR_SIZE = 96;
export const normalizeCursorSize = value => CURSOR_SIZES.includes(value) ? value : DEFAULT_CURSOR_SIZE;
// The claw artwork starts near y=52 in the 96 px frame. Its own palm hotspot
// keeps it at the pointer instead of below it. [ASSUMED] Visual alignment y=68;
// source poses/bytes and the real DOM pointer coordinates remain unchanged.
export const cursorHotspot = (size, role = 'normal') =>
  (role === 'text' ? [48, 48] : role === 'grab' || role === 'grabbing' ? [28, 68] : [28, 20])
    .map(value => Math.round(value * normalizeCursorSize(size) / 96));
