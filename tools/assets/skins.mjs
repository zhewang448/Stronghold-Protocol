import { RAW, safeName, urlDir } from './sources.mjs';

// Cosmetics are shared by every official version. Explicit subsets remain available to callers.
export function skinCatalogue(research, operatorIds = new Set(Object.keys(research?.chars || {}))) {
  const chars = {};
  for (const id of [...operatorIds].sort()) {
    if (research?.chars?.[id]?.length) chars[id] = research.chars[id].map(({ id: skinId, name, group }) => ({ id: skinId, name, group }));
  }
  return { version: 1, chars };
}

// Uses processModels, including atlas pages, normalization and this skeleton's own roles/bounds.
export function buildSkinPlan(research, selected = [], seatArt = null) {
  const template = { chars: {} }, models = new Map();
  for (const [charId, list] of Object.entries(research?.chars || {})) {
    for (const s of list) {
      if (!selected.includes(s.id)) continue;
      const spine = {};
      for (const side of ['front', 'back']) {
        if (side === 'back' && !s.back) continue;
        const dir = `spine/op/${charId}/${s.stem}/${side}/`;
        const folder = side === 'front' ? s.frontFolder || 'Front' : 'Back';
        const baseUrl = `${RAW.fexli}spine/${charId}/${s.stem}/${folder}/`;
        const file = (ext, kind) => ({ rel: `${dir}${s.stem}.${ext}`, urls: [`${baseUrl}${s.stem}.${ext}`], kind });
        const key = `skin:${s.id}:${side}`;
        models.set(key, { key, kind: 'op', roleId: charId, dir, pma: false, strict: true, skillIndices: [0, 1, 2], baseUrl: urlDir(`${baseUrl}${s.stem}.atlas`),
          skel: file('skel', 'skel'), atlas: { ...file('atlas', 'atlas'), mutable: true }, pngs: [file('png', 'png')] });
        spine[side] = { model: key };
      }
      const rel = `char/skin_avatar/${safeName(s.stem)}.png`;
      const avatar = { alts: [{ rel, urls: [s.avatar], kind: 'png' }] };
      const c = template.chars[charId] ||= { skins: {} };
      const portraitUrl = seatArt?.chars?.[charId]?.choices?.find((row) => row.id === s.id)?.portrait;
      // Existing seat posters are optional local files, resolved through the same leaf format as avatars.
      const portrait = typeof portraitUrl === 'string' && portraitUrl.startsWith('/assets/')
        ? { alts: [{ rel: portraitUrl.slice('/assets/'.length), urls: [], kind: 'png' }] } : null;
      c.skins[s.id] = { avatar, spine, ...(portrait ? { portrait } : {}) };
    }
  }
  return { template, models };
}

export function completeSkins(chars) {
  for (const c of Object.values(chars || {})) {
    for (const [id, skin] of Object.entries(c.skins || {})) {
      if (!skin.avatar || !skin.spine?.front) delete c.skins[id];
    }
  }
  return chars;
}
