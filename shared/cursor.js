export const DEFAULT_CURSOR_SIZE = 'auto';
export const MAX_CURSOR_SIZE = 128;
export const CURSOR_SIZES = Object.freeze([32, 48, 64, 80, 96, 112, MAX_CURSOR_SIZE]);

/** @param {unknown} value */
export function normalizeCursorSize(value) {
  return typeof value === 'number' && CURSOR_SIZES.includes(value) ? value : DEFAULT_CURSOR_SIZE;
}
