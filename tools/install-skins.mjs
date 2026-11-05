#!/usr/bin/env node
// Deployment-only installer: never imported by the server and no remote installation intent.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Downloader } from './assets/downloader.mjs';
import { buildSkinPlan, completeSkins } from './assets/skins.mjs';
import { processModels } from './assets/spine.mjs';
import { collectLeaves, downloadLeaves, resolveTemplate, contentHash, totalBytes } from './assets/manifest.mjs';
import { restartForEnvProxy } from './assets/env-proxy.mjs';
import { countStats } from './fetch-assets.mjs';
import { installDynamicIllustrations } from './install-dynamic-illustrations.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export async function installSkins(ids, { root = ROOT, offline = false, source = 'direct', log = console.log } = {}) {
  const read = async (p) => JSON.parse(await readFile(join(root, p), 'utf8'));
  const research = await read('docs/research/operator-skins.json');
  const catalogue = await read('data/skins.json');
  const allowed = new Set(Object.values(catalogue.chars).flat().map((s) => s.id));
  const selected = [...new Set(ids.includes('--all') ? [...allowed] : ids)];
  for (const id of selected) if (!allowed.has(id)) throw new Error(`unknown or unsupported skin: ${id}`);
  const manifest = await read('data/assets.json');
  const assetRoot = join(root, 'public/assets');
  const dl = new Downloader({ root: assetRoot, ledgerPath: join(root, '.cache/skin-ledger.json'), concurrency: 6, retries: 2, timeoutMs: 30000, source, log });
  await dl.loadLedger();
  const plan = buildSkinPlan(research, selected, await read('data/seat-art.json').catch(() => null));
  if (!offline) await downloadLeaves(collectLeaves(plan.template), dl, assetRoot, 'skin avatars');
  const parsed = await processModels(plan.models, { root: assetRoot, dl, cachePath: join(root, '.cache/skin-spines.json'), download: !offline, log });
  const resolved = resolveTemplate(plan.template, { root: assetRoot, spine: parsed.entries });
  const chars = completeSkins(resolved.value.chars);
  const installed = [];
  for (const [charId, c] of Object.entries(chars || {})) {
    if (!manifest.chars?.[charId]) continue;
    Object.assign(manifest.chars[charId].skins ||= {}, c.skins);
    installed.push(...Object.keys(c.skins || {}));
  }
  // Every successful skin is atomic; failed installs retain an existing working entry.
  if (installed.length) {
    const { hash: _oldHash, version: _version, generator: _generator, stats: _stats, ...body } = manifest;
    manifest.hash = contentHash(body);
    const files = new Set();
    const walk = (v) => {
      if (typeof v === 'string' && v.startsWith('/assets/')) files.add(v.slice('/assets/'.length));
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(body);
    manifest.stats = countStats(body, totalBytes(assetRoot, files), files.size);
    const dest = join(root, 'data/assets.json'), tmp = `${dest}.tmp-${process.pid}`;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(tmp, JSON.stringify(manifest));
    await rename(tmp, dest);
  }
  const failed = selected.filter((id) => !installed.includes(id));
  for (const p of parsed.problems) log(`[skins] ${p}`);
  log(`[skins] installed ${installed.length}/${selected.length}; failed ${failed.length}`);
  return { installed, failed };
}

async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const source = args.find((a) => a.startsWith('--asset-source='))?.split('=')[1] || process.env.SP_ASSET_SOURCE || 'direct';
  const ids = args.filter((a) => a !== '--offline' && !a.startsWith('--asset-source='));
  if (!ids.length || ids.includes('--help')) {
    console.log('Usage: node tools/install-skins.mjs <skinId... | --all> [--offline] [--asset-source=direct|mirror]');
    return;
  }
  const result = await installSkins(ids, { offline, source });
  const dynamicSources = JSON.parse(await readFile(join(ROOT, 'docs/research/dynamic-illustrations.json'), 'utf8'));
  const dynamicIds = ids.includes('--all') ? Object.keys(dynamicSources.skins) : ids.filter(id => dynamicSources.skins[id]);
  if (dynamicIds.length) {
    const dynamic = await installDynamicIllustrations(dynamicIds, { offline });
    if (dynamic.failed.length) console.log(`[skins] ${dynamic.failed.length} optional dynamic sources unavailable; static outfits retained`);
  }
  if (result.failed.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && !restartForEnvProxy()) {
  main().catch((e) => { console.error(e.stack); process.exitCode = 1; });
}
