// Source-only upstream migration: combine generated inventories without downloading or changing game art.
// Usage: node tools/assets/merge-manifests.mjs <local.json> <upstream.json> <output.json> <installed-assets-directory>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash, totalBytes } from './manifest.mjs';
import { countStats } from '../fetch-assets.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Upstream fixes win shared leaves; local-only operators, outfits and inventories remain available. */
export function mergeAssetInventories(local, upstream) {
  if (!object(local) || !object(upstream)) return structuredClone(upstream);
  const out = structuredClone(local);
  for (const [key, value] of Object.entries(upstream)) {
    out[key] = object(out[key]) && object(value) ? mergeAssetInventories(out[key], value) : structuredClone(value);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [localPath, upstreamPath, output, assetsRoot] = process.argv.slice(2);
  if (!localPath || !upstreamPath || !output || !assetsRoot) throw new Error('Expected local, upstream, output and installed-assets paths');
  const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
  const upstream = JSON.parse(fs.readFileSync(upstreamPath, 'utf8'));
  const body = mergeAssetInventories(local, upstream);
  for (const key of ['version', 'hash', 'generator', 'stats']) delete body[key];
  const files = new Set();
  const visit = value => {
    if (typeof value === 'string' && value.startsWith('/assets/')) files.add(value.slice('/assets/'.length).split('?')[0]);
    else if (value && typeof value === 'object') for (const entry of Object.values(value)) visit(entry);
  };
  visit(body);
  const result = { version: upstream.version, hash: contentHash(body), generator: 'tools/assets/merge-manifests.mjs',
    stats: countStats(body, totalBytes(assetsRoot, files), files.size), ...body };
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, chars: Object.keys(body.chars).length,
    skins: Object.values(body.chars).reduce((n, char) => n + Object.keys(char.skins || {}).length, 0), hash: result.hash }));
}
