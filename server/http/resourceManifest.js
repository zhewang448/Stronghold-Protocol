import { isOptionalDynamicArt } from '../../shared/dynamicDownload.js';
import { routeResourcePacks } from '../../shared/resourcePackRoutes.js';
// Machine-local preload metadata. It inventories installed bytes; no gameplay/generated game table is modified.
import { opendir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isResourceUrl, AUDIO_EXTS, validateManifest } from '../../public/js/resources/common.js';

export async function buildResourceManifest({ publicDir, dataDir, cdnBase = '', resourcePackRoutes = [] }) {
  const paths = [];
  async function walk(dir, prefix) {
    let entries;
    try { entries = await opendir(dir); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for await (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const url = `${prefix}/${e.name}`, file = path.join(dir, e.name);
      if (e.isDirectory()) await walk(file, url);
      else if (e.isFile() && isResourceUrl(encodeURI(url))) paths.push({ file, url: encodeURI(url) });
    }
  }
  await walk(path.join(publicDir, 'assets'), '/assets');
  await walk(path.join(publicDir, 'fonts'), '/fonts');
  const files = []; let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < paths.length) {
      const item = paths[next++], bytes = await readFile(item.file);
      const ext = path.extname(item.file).toLowerCase();
      files.push({ url: cdnBase ? cdnBase + item.url : item.url, tier: AUDIO_EXTS.includes(ext) || item.url.startsWith('/assets/local/fx/') || isOptionalDynamicArt('public' + decodeURI(item.url)) ? 2 : 1,
        hash: createHash('sha1').update(bytes).digest('hex').slice(0,12),
        assetHash: createHash('sha256').update(bytes).digest('hex').slice(0,16), size: bytes.length });
    }
  }));
  files.sort((a,b) => a.tier - b.tier || a.url.localeCompare(b.url, 'en'));
  const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,16);
  const manifest = validateManifest({ format: 1, version, count: files.length, tier1: files.filter(f => f.tier === 1).length,
    totalBytes: files.reduce((n,f) => n + f.size, 0), files });
  if (dataDir) {
    try { const packs = JSON.parse(await readFile(path.join(dataDir, 'resource-packs.json'), 'utf8'));
      manifest.packs = routeResourcePacks(packs.packs, cdnBase, resourcePackRoutes);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // Routing metadata is part of the served manifest identity: changing mirrors/CDN paths must invalidate its ETag.
  manifest.version = createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 16);
  return manifest;
}
