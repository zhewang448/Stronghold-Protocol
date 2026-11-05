// Waiting-room cosmetics. [ASSUMED] Owner-approved faction backgrounds and automatic bond selection.
export const NAMECARD_BONDS = Object.freeze({ yanShip: 'yan', sargonShip: 'sargon', victoriaShip: 'victoria', kjeragShip: 'kjerag', lateranoShip: 'laterano', egirShip: 'egir', siracusaShip: 'siracusa', kazimierzShip: 'kazimierz' });
export const NAMECARD_CAMPS = Object.freeze(['rhodes', 'lungmen', 'yan', 'higashi', 'victoria', 'kazimierz', 'laterano', 'leithanien', 'columbia', 'ursus', 'siracusa', 'iberia', 'sargon', 'kjerag', 'egir', 'bolivar', 'minos', 'rim', 'sami', 'babel', 'rhine', 'penguin', 'blacksteel', 'karlan', 'glasgow', 'abyssal', 'siesta', 'dublinn', 'followers', 'lgd', 'pinus', 'chiave', 'lee', 'rainbow', 'student', 'sui', 'sweep', 'elite', 'action4', 'reserve1', 'reserve4', 'reserve6']);
export function validNamecard(value) {
  return !!value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(k => ['mode', 'id', 'x', 'y', 'zoom'].includes(k))
    && ['auto', 'none', 'manual'].includes(value.mode) && typeof value.id === 'string' && value.id.length <= 160
    && (value.mode !== 'manual' || /^(?:camp:[a-z0-9_]+|loading:[a-z0-9_]+|skin:[A-Za-z0-9_@#+.-]+)$/.test(value.id))
    && ['x', 'y'].every(k => Number.isFinite(value[k]) && value[k] >= 0 && value[k] <= 100)
    && Number.isFinite(value.zoom) && value.zoom >= 100 && value.zoom <= 300;
}
export function normalizeNamecard(value) {
  return validNamecard(value) ? { mode: value.mode, id: value.mode === 'manual' ? value.id : '', x: value.x, y: value.y, zoom: value.zoom } : { mode: 'auto', id: '', x: 50, y: 50, zoom: 100 };
}
export function namecardSource(manifest, id) {
  if (!manifest || typeof id !== 'string') return null;
  if (id.startsWith('camp:') && NAMECARD_CAMPS.includes(id.slice(5))) return manifest.ui?.['campLogo/logo_' + id.slice(5)] || null;
  if (id.startsWith('loading:')) return manifest.ui?.['loading/loading_ac_' + id.slice(8)] || null;
  if (id.startsWith('skin:')) for (const entry of Object.values(manifest.chars || {})) {
    const look = entry.skins?.[id.slice(5)];
    if (look) return look.illust || look.illustration || look.portrait || null;
  }
  if (id.startsWith('skin:')) {
    const skin = manifest.skins?.[id.slice(5)];
    return skin?.illust || skin?.illustration || skin?.portrait || null;
  }
  return null;
}
export function resolveNamecard(value, bondPlan, manifest) {
  const selection = normalizeNamecard(value);
  const id = selection.mode === 'auto' ? (NAMECARD_BONDS[bondPlan] ? 'camp:' + NAMECARD_BONDS[bondPlan] : '') : selection.mode === 'manual' ? selection.id : '';
  return { ...selection, resolved: id && namecardSource(manifest, id) ? id : null };
}

/** The cover crop follows the pointer by the image's actual overflow, including zoom. */
export function dragNamecard(frame, dx, dy, { width, height, aspect }) {
  if (!(width > 0) || !(height > 0) || !(aspect > 0)) return frame;
  const cover = Math.max(width, height / aspect) * frame.zoom / 100;
  const follow = (value, delta, spare) => spare > 0 ? Math.max(0, Math.min(100, value - delta / spare * 100)) : value;
  return { x: follow(frame.x, dx, cover - width), y: follow(frame.y, dy, cover * aspect - height), zoom: frame.zoom };
}
