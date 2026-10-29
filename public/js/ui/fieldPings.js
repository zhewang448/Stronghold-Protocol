// Remake-only field pings: board coordinates throughout, client pixels only at the view boundary.
import { GEO, PING_KINDS, PING_TTL_MS } from '../../../shared/constants.js';
import { N_ } from '../../../shared/i18n.js';
import { html, Icon } from './components.js';
import { BOSS_ROW_SHIFT, MAX_COL } from '../render/prepfield.js';

export const PING_LABELS = Object.freeze({
  attention: N_('注意'), attack: N_('进攻'), danger: N_('危险'), retreat: N_('撤退'), question: N_('疑问'), heart: N_('爱心'),
});
const ICONS = Object.freeze({ attention: 'info', attack: 'sword', danger: 'warn', retreat: 'exit' });
export function PingIcon({ kind }) {
  if (kind === 'heart') return html`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 21 3.5 12.5a5.7 5.7 0 0 1 8.1-8.1l.4.4.4-.4a5.7 5.7 0 0 1 8.1 8.1z" />
  </svg>`;
  if (kind !== 'question') return html`<${Icon} name=${ICONS[kind] || 'info'} />`;
  return html`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 7a5 5 0 0 1 10 0c0 2.2-1.3 3.2-2.7 4.2-1.3.9-1.3 1.7-1.3 3.8h-2c0-2.8.2-4 2.1-5.4C14.4 8.7 15 8.2 15 7a3 3 0 0 0-6 0zM11 18h2v3h-2z" />
  </svg>`;
}

export function validPing(p) {
  return !!p && typeof p.fieldId === 'string' && p.area === 'board' && PING_KINDS.includes(p.kind)
    && Number.isInteger(p.row) && p.row >= 0 && p.row < GEO.ROWS
    && Number.isInteger(p.col) && p.col >= 0 && p.col < GEO.COLS;
}

export function activePings(pings, fieldId, now) {
  return (pings || []).filter((p) => validPing(p) && p.fieldId === fieldId && now >= p.at && now - p.at < PING_TTL_MS);
}

export function pingFieldTile(tile, deployField) {
  if (deployField !== 'bossL' && deployField !== 'bossR') return tile;
  return { row: tile.row + BOSS_ROW_SHIFT, col: deployField === 'bossR' ? MAX_COL - tile.col : tile.col };
}

export function pingViewTile(tile, deployField) {
  if (deployField !== 'bossL' && deployField !== 'bossR') return tile;
  return { row: tile.row - BOSS_ROW_SHIFT, col: deployField === 'bossR' ? MAX_COL - tile.col : tile.col };
}

export function pingRect(field, combat, showPrep, deployField = null, view = null) {
  if (showPrep && view?.kind === 'engine' && (deployField === 'bossL' || deployField === 'bossR')) {
    return { r0: GEO.BOSS_RECT.r0 - BOSS_ROW_SHIFT, r1: GEO.BOSS_RECT.r1 - BOSS_ROW_SHIFT, c0: GEO.BOSS_RECT.c0, c1: GEO.BOSS_RECT.c1 };
  }
  return combat || (!showPrep && field?.prep) ? (field?.rect || GEO.NORMAL_RECT) : GEO.NORMAL_RECT;
}

/** Pick the tile top from tileScreen polygons, including tiles occupied by units. */
export function pingTileAt(view, rect, x, y) {
  for (let row = rect.r1; row >= rect.r0; row--) {
    for (let col = rect.c0; col <= rect.c1; col++) {
      const poly = view?.tileScreen(row, col)?.poly;
      if (!poly?.length) continue;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return { row, col };
    }
  }
  return null;
}
