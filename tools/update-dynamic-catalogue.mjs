// Derive the difference from official skin metadata, never from URL availability.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { prtsIllustrationUrl } from './assets/illustration-sources.mjs';

const args = process.argv.slice(2), file = args[0];
if (args.includes('--frames-only')) {
  const framesFile = args.find(arg => arg.startsWith('--frames='))?.slice('--frames='.length);
  if (!framesFile) throw new Error('--frames-only requires --frames=PATH');
  const crops = JSON.parse(await readFile(resolve(framesFile), 'utf8'));
  const registry = JSON.parse(await readFile('docs/research/dynamic-illustrations.json', 'utf8'));
  let count = 0;
  for (const [id, crop] of Object.entries(crops.illustrations || {})) {
    const row = registry.skins[id];
    if (!row) throw new Error(`Unknown dynamic illustration: ${id}`);
    for (const kind of ['avatar', 'portrait']) {
      const rect = crop.frames?.[kind];
      if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) || rect.width <= 0 || rect.height <= 0) throw new Error(`Invalid ${kind} crop for ${id}`);
    }
    row.frames = crop.frames; row.frameSource = crop.source; count++;
  }
  await writeFile('docs/research/dynamic-illustrations.json', JSON.stringify(registry, null, 2) + '\n');
  console.log(JSON.stringify({ framesUpdated: count }));
  process.exit(0);
}
if (!file) throw new Error('Usage: node tools/update-dynamic-catalogue.mjs <official skin_table.json>');
const bytes = await readFile(resolve(file)), official = JSON.parse(bytes);
const read = async name => JSON.parse(await readFile(name, 'utf8'));
const registry = await read('docs/research/dynamic-illustrations.json');
const research = await read('docs/research/operator-skins.json');
const backups = await read('data/backups.json');
const baseNames = Object.fromEntries(Object.entries(backups.units).map(([id, u]) => [u.charId || id, u.name]));
for (const row of Object.values(await read('data/chess.json'))) if (row.charId && row.name) baseNames[row.charId] ||= row.name;
const known = new Map(Object.values(research.chars).flat().map(s => [s.id, s]));
const inScope = new Set([...Object.keys(research.chars), ...Object.keys(JSON.parse(await readFile('data/assets.json','utf8')).chars)]);
const includeMissing = args.includes('--include-missing');
const framesFile = args.find(arg => arg.startsWith('--frames='))?.slice('--frames='.length);
const cropSource = framesFile ? await read(framesFile) : null;
const outside = [];
for (const [id, skin] of Object.entries(official.charSkins)) {
  if (!skin.dynIllustId) continue;
  const def = !id.includes('@') && /#2$/.test(id) && inScope.has(skin.charId);
  if (!known.has(id) && !def && !includeMissing) { outside.push({ id, charId: skin.charId, name: skin.displaySkin.skinName, dynIllustId: skin.dynIllustId }); continue; }
  const row = registry.skins[id] ||= { charId: skin.charId, stem: skin.dynIllustId.replace('#', '__') };
  row.bundle = skin.dynIllustId.replace(/^dyn_illust_/, '');
  row.officialDynamic = true;
  row.name = skin.displaySkin.skinName || '精英二'; row.group = skin.displaySkin.skinGroupName;
  if (def) row.field = 'dynamicE2';
  const charName = baseNames[skin.charId] || Object.values(backups.units).find(u => u.id === skin.charId)?.name;
  const order = Object.values(official.charSkins).filter(s => s.charId === skin.charId && s.isBuySkin).sort((a, b) => a.displaySkin.getTime - b.displaySkin.getTime);
  const number = order.findIndex(s => s.skinId === id) + 1;
  // PRTS uses skin1/skin2… filenames, not the translated outfit name. The
  // sequence is the official catalogue order; each download still validates PNG.
  if (charName && (def || number > 0)) {
    row.prtsFile = `立绘_${charName}_${def ? '2' : 'skin' + number}.png`;
    row.illust = prtsIllustrationUrl(row.prtsFile);
  }
  row.skeleton ||= `https://static.prts.wiki/spine38/dyn/${row.stem}/${row.stem}/${row.stem}.skel`;
  row.atlas ||= row.skeleton.replace(/\.skel$/, '.atlas');
  const crop = cropSource?.illustrations?.[id];
  if (crop) {
    for (const kind of ['avatar', 'portrait']) {
      const rect = crop.frames?.[kind];
      if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) || rect.width <= 0 || rect.height <= 0) throw new Error(`Invalid ${kind} crop for ${id}`);
    }
    row.frames = crop.frames;
    row.frameSource = crop.source;
  }
  if (includeMissing && !def && !known.has(id)) {
    const mirror = 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/';
    const entry = { id, name: row.name, group: row.group, stem: row.bundle.replaceAll('#', '_'), pictureOnly: true,
      avatar: mirror + 'avatar/' + encodeURIComponent(skin.avatarId) + '.png',
      portrait: mirror + 'portrait/' + encodeURIComponent(skin.portraitId) + '.png',
      ...(row.illust ? { illust: row.illust } : {}) };
    (research.chars[skin.charId] ||= []).push(entry);
    known.set(id, entry);
  }
}
registry.official = { source: 'https://github.com/Kengxxiao/ArknightsGameData/blob/master/zh_CN/gamedata/excel/skin_table.json',
  sha256: createHash('sha256').update(bytes).digest('hex'), outsideCatalogue: outside };
await writeFile('docs/research/dynamic-illustrations.json', JSON.stringify(registry, null, 2) + '\n');
if (includeMissing) await writeFile('docs/research/operator-skins.json', JSON.stringify(research, null, 1) + '\n');
console.log(JSON.stringify({ registered: Object.keys(registry.skins).length, outsideCatalogue: outside.length }));
