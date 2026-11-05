// A portable offline source cache from an installation whose bytes are already
// verified. Contains source pages, never a screenshot or a battle-model substitute.
import fs from 'node:fs/promises';
import path from 'node:path';
import { atlasInfo } from './assets/atlas.mjs';
const root = path.resolve(import.meta.dirname, '..'), out = path.resolve(process.argv[2] || '.cache/dynamic-offline-sources');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'data/assets.json')));
const registry = JSON.parse(await fs.readFile(path.join(root, 'docs/research/dynamic-illustrations.json')));
const skins = {};
await fs.mkdir(out, { recursive: true });
for (const [id, row] of Object.entries(registry.skins)) {
  const art = row.field ? manifest.chars[row.charId] : manifest.chars[row.charId]?.skins?.[id], entry = row.field ? art?.[row.field] : art?.dynamic;
  if (!entry?.source?.sha256) continue;
  const dir = id.replace(/[^a-zA-Z0-9_-]/g, '_'); await fs.mkdir(path.join(out, dir), { recursive: true });
  const copy = async (url, name) => {
    const rel = dir + '/' + name;
    await fs.copyFile(path.join(root, 'public', url), path.join(out, rel)); return rel;
  };
  const folder = path.posix.dirname(entry.skel), atlas = folder + '/' + row.stem + '.source.atlas';
  const text = await fs.readFile(path.join(root, 'public', atlas), 'utf8');
  for (const page of atlasInfo(text).pages) await copy(folder + '/' + page, page);
  const record = { skeleton: await copy(entry.skel, path.basename(entry.skel)), atlas: await copy(atlas, row.stem + '.atlas'),
    bundleSha256: entry.source.sha256, viewBounds: entry.bounds, extraTracks: entry.extraTracks || [],
    nativeParticles: entry.nativeLayers?.particles || 0, nativeHolders: entry.nativeLayers?.holders || 0,
    static: await copy(art[row.field ? 'illustE2' : 'illust'], 'still.png'), staticBundle: entry.staticSource?.replace(/^client:/, '') || 'retained-client' };
  for (const field of ['avatar', 'portrait']) if (art[row.field ? field + 'E2' : field]) record[field] = await copy(art[row.field ? field + 'E2' : field], field + '.png');
  for (const field of ['background', 'foreground']) if (entry[field]) record[field] = await copy(entry[field], field + '.png');
  skins[id] = record;
}
await fs.writeFile(path.join(out, 'index.json'), JSON.stringify({ schema: 1, skins }, null, 2));
console.log(`offline dynamic source cache: ${Object.keys(skins).length} illustrations at ${out}`);
