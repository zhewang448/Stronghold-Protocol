// The battlefield mini map of the strategy draft (#65): the field a player deploys on, drawn from the stage's own tiles
// (data/stages.json) so every battlefield of every official version has one. Official board textures are optional;
// missing art keeps the same cell drawing. Rows go bottom-up as
// on the board: the enemy gates (red) and the protected point (blue) stand where the match will have them.
// Styles: css/screens/draft.css (.stagemap).

import { useId, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { fallbackTileClass } from './fallbackField.js';
import { data } from '../data.js';
import { SURFACES, SOURCES } from '../render/board3d/atlas.js';

const MATERIALS = Object.freeze({
  road: 'concrete', fence: 'concreteRed', high: 'plateS', gate: 'concreteRed', goal: 'ringHatch',
  mire: 'concrete', smog: 'slats', deep: 'steel', infect: 'concreteStripe', 'duel-grass': 'concrete',
});

/** Manifest-listed official atlas regions, shared with the battle renderer; no guessed asset URLs. */
export function miniMapMaterials(groups) {
  const atlas = groups?.['map/autochess']?.TX_autochessi_D;
  const url = typeof atlas === 'string' ? atlas : atlas?.path;
  if (!url) return [];
  return [...new Set(Object.values(MATERIALS))].map((name) => ({
    name, url, ...SURFACES[name], ...SOURCES[SURFACES[name].src],
  }));
}

/** The stage tiles of the field: GEO.FIELD's rows, from the protected point's column to the last gate's. */
const RECT = Object.freeze({ r0: 9, r1: 12, c0: 2, c1: 12 });

/**
 * The look of one tile: 'gate', 'goal', 'void', 'high' (a ranged platform) or a special ground as on the fallback board,
 * else 'road' (enemies walk it) or 'fence' (low ground they do not).
 * @param {any} stage @param {number} r @param {number} c
 */
export function miniTile(stage, r, c) {
  const cls = fallbackTileClass(stage, r, c);
  if (cls !== 'floor' && cls !== 'lane') return cls;
  return stage.tiles?.[stage.rows[r][c]]?.groundPassable === false ? 'fence' : 'road';
}

/**
 * The drawn tiles (void left out), x / y in tiles from the top left.
 * @param {any} stage a data/stages.json record
 * @returns {{ w: number, h: number, tiles: Array<{ x: number, y: number, kind: string }> } | null} null without tile data
 */
export function stagePreview(stage) {
  if (!Array.isArray(stage?.rows) || !stage.rows[RECT.r1]) return null;
  const tiles = [];
  for (let r = RECT.r0; r <= RECT.r1; r++) {
    for (let c = RECT.c0; c <= RECT.c1; c++) {
      const kind = miniTile(stage, r, c);
      if (kind !== 'void') tiles.push({ x: c - RECT.c0, y: RECT.r1 - r, kind });
    }
  }
  return { w: RECT.c1 - RECT.c0 + 1, h: RECT.r1 - RECT.r0 + 1, tiles };
}

/**
 * @param {{ stage: any, class?: string }} props nothing without tile data
 */
export function StageMiniMap({ stage, class: cls }) {
  const id = `stagemap-${useId()}`;
  const [failed, setFailed] = useState(null);
  const map = stagePreview(stage);
  if (!map) return null;
  const materials = miniMapMaterials(data.get('local')?.groups);
  const textured = materials.length > 0 && failed !== materials[0].url;
  return html`<svg class=${cls ? `stagemap ${cls}` : 'stagemap'} viewBox=${`0 0 ${map.w} ${map.h}`} aria-hidden="true" data-testid="stage-minimap">
    ${textured ? html`<defs>${materials.map((m) => html`<pattern key=${m.name} id=${`${id}-${m.name}`}
        patternUnits="userSpaceOnUse" width="1" height="1" viewBox=${m.rect.join(' ')} preserveAspectRatio="xMidYMid slice">
      <image href=${m.url} width=${m.w} height=${m.h} onError=${() => setFailed(m.url)} />
    </pattern>`)}</defs>` : null}
    ${map.tiles.map((tile) => html`<g key=${`${tile.x},${tile.y}`}>
      <rect class=${`stagemap__t stagemap__t--${tile.kind}${textured ? ' is-textured' : ''}`} x=${tile.x + 0.04} y=${tile.y + 0.04} width="0.92" height="0.92"
        style=${textured ? `fill:url(#${id}-${MATERIALS[tile.kind] || 'concrete'})` : undefined} />
      ${tile.kind === 'gate' || tile.kind === 'goal' ? html`<rect class=${`stagemap__mark stagemap__mark--${tile.kind}`} x=${tile.x + 0.12} y=${tile.y + 0.12} width="0.76" height="0.76" />` : null}
    </g>`)}
  </svg>`;
}
