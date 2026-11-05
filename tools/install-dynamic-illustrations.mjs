// Optional artwork installer. Game files stay under ignored public/assets; metadata is generated atomically.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { atlasInfo, normalizeAtlas } from './assets/atlas.mjs';
import { parseSkel, parseSpineJson } from './assets/skel.mjs';
import { pngSize, isCompletePng } from './assets/formats.mjs';
import { contentHash, totalBytes } from './assets/manifest.mjs';
import { countStats } from './fetch-assets.mjs';
import { decodeRgbaPng, encodeRgbaPng, extendAlphaEdges, atlasEdgeRectangles } from './assets/alpha-edges.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const sha256 = b => createHash('sha256').update(b).digest('hex');
export async function installDynamicIllustrations(ids, { root = ROOT, offline = false, log = console.log, localRoot = '.cache/dynamic-extract', inputManifest = null, writeManifest = true, addOnly = false } = {}) {
  const json = async p => JSON.parse(await readFile(resolve(root, p), 'utf8'));
  const registry = await json('docs/research/dynamic-illustrations.json');
  const research = await json('docs/research/operator-skins.json');
  const manifest = inputManifest || await json('data/assets.json'), files = [], failed = [], installed = [], warnings = [];
  let local = {};
  try { local = JSON.parse(await readFile(resolve(root, localRoot, 'index.json'), 'utf8')).skins || {}; } catch { /* optional client cache */ }
  for (const rec of Object.values(local)) for (const key of ['skeleton', 'atlas', 'static', 'background', 'foreground', 'avatar', 'portrait']) {
    if (typeof rec[key] === 'string') rec[key] = resolve(root, localRoot, rec[key]);
  }
  const selected = ids.includes('--all') ? Object.keys(registry.skins) : [...new Set(ids)];
  for (const id of selected) if (!registry.skins[id]) throw new Error(`No dynamic source for ${id}`);
  async function obtain(url, rel, png = false) {
    const abs = resolve(root, 'public/assets', rel);
    let b;
    try { b = await readFile(abs); } catch { /* download below */ }
    if (b && png && !isCompletePng(b) && !addOnly) b = null;
    const save = async bytes => {
      await mkdir(dirname(abs), { recursive: true });
      const tmp = abs + '.part-' + process.pid; await writeFile(tmp, bytes); await rename(tmp, abs);
    };
    if (!b) {
      if (url?.startsWith('file:')) {
        b = await readFile(new URL(url));
        if (png && !isCompletePng(b)) throw new Error(`Invalid local source PNG: ${url}`);
        await save(b);
      } else {
        if (offline) throw new Error(`Missing local file: ${rel}`);
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
            b = Buffer.from(await r.arrayBuffer());
            if (!b.length || b.length > 64 * 1024 * 1024) throw new Error(`Invalid file size: ${url}`);
            if (png && !isCompletePng(b)) throw new Error(`Invalid PNG: ${url}`);
            await save(b); break;
          } catch (e) { if (attempt === 2 || /HTTP (404|410):/.test(e.message)) throw e; }
        }
      }
    }
    if (png && !isCompletePng(b)) throw new Error(`Invalid local PNG: ${rel}`);
    files.push({ url, path: abs, bytes: b.length, sha256: sha256(b) });
    return b;
  }
  for (const id of selected) {
    try {
      const declared = registry.skins[id];
      const priorArt = declared.field ? manifest.chars?.[declared.charId] : manifest.chars?.[declared.charId]?.skins?.[id];
      const priorEntry = declared.field ? priorArt?.[declared.field] : priorArt?.dynamic;
      let native = local[id];
      // A full/offline package carries original atlas pages, not the owner's
      // extraction cache. Rebuild a missing display derivative from those files.
      if (!native?.skeleton && priorEntry?.source?.bundle) {
        const folder = dirname(priorEntry.skel);
        let skeleton = priorEntry.skel;
        try { await readFile(resolve(root, 'public', skeleton.slice(1))); } catch {
          for (const candidate of priorEntry.installationFiles || []) if (/\.(skel|json)$/.test(candidate)) {
            try { if (sha256(await readFile(resolve(root, 'public', candidate.slice(1)))) === priorEntry.identity) { skeleton = candidate; break; } } catch { /* another retained source */ }
          }
        }
        native = { skeleton: resolve(root, 'public', skeleton.slice(1)), atlas: resolve(root, 'public', folder.slice(1), declared.stem + '.source.atlas'),
          bundleSha256: priorEntry.source.sha256, viewBounds: priorEntry.bounds, extraTracks: priorEntry.extraTracks || [],
          nativeParticles: priorEntry.nativeLayers?.particles || 0, nativeHolders: priorEntry.nativeLayers?.holders || 0,
          ...(priorArt?.[declared.field ? 'illustE2' : 'illust'] ? { static: resolve(root, 'public', priorArt[declared.field ? 'illustE2' : 'illust'].slice(1)),
            staticBundle: priorEntry.staticSource?.replace(/^client:/, '') || 'retained-client' } : {}) };
      }
      const r = native?.skeleton && native?.atlas ? { ...declared, skeleton: pathToFileURL(native.skeleton).href, atlas: pathToFileURL(native.atlas).href } : declared;
      const skin = r.field ? { id, stem: r.bundle.replaceAll('#', '_'), name: r.name, group: r.group, illust: r.illust } : research.chars[r.charId]?.find(s => s.id === id);
      if (!skin) throw new Error('Outfit absent from the local catalogue');
      // A native cache is separate from earlier web downloads; each keeps its
      // original pages so a retry cannot silently mix two source versions.
      const rel = `dynamic/${skin.stem}${native?.skeleton ? '/client/' + native.bundleSha256.slice(0, 12) : ''}/`, stem = r.stem;
      // Keep the original atlas separately: offline reinstallation must validate the same input.
      const raw = await obtain(r.atlas, rel + stem + '.source.atlas');
      const info = atlasInfo(raw.toString()), sizes = new Map(), textures = [], displayPages = new Map(), edgeCorrections = [];
      if (!info.pages.length) throw new Error('Empty atlas');
      for (const page of info.pages) {
        if (basename(page) !== page || !page.endsWith('.png')) throw new Error(`Unsupported atlas page: ${page}`);
        const b = await obtain(new URL(encodeURIComponent(page), r.atlas).href, rel + page, true);
        sizes.set(page, pngSize(b));
        const edgeNames = native?.skeleton ? (r.alphaEdgeRegions || []).flatMap(n => [n, n.replace(/^A\//, '')]) : r.alphaEdgeRegions || [];
        const rectangles = atlasEdgeRectangles(raw.toString(), edgeNames, page);
        let displayPage = page;
        if (rectangles.length) {
          const image = decodeRgbaPng(b);
          const changed = extendAlphaEdges(image.pixels, image.width, image.height, rectangles);
          if (changed) {
            displayPage = page.replace(/\.png$/, '.edges.png');
            const display = encodeRgbaPng(image);
            if (!addOnly) await writeFile(resolve(root, 'public/assets', rel + displayPage), display);
            else { try { await readFile(resolve(root, 'public/assets', rel + displayPage)); } catch { await writeFile(resolve(root, 'public/assets', rel + displayPage), display); } }
            edgeCorrections.push({ page, displayPage, changed, sourceSha256: sha256(b), displaySha256: sha256(display) });
          }
        }
        displayPages.set(page, displayPage); textures.push('/assets/' + rel + displayPage);
      }
      const pma = /pma:\s*true/i.test(raw.toString());
      const norm = normalizeAtlas(raw.toString(), { pma, pageSize: p => sizes.get(p), renamePage: p => displayPages.get(p) || p });
      const ext = r.skeleton.endsWith('.json') ? 'json' : 'skel';
      const bytes = await obtain(r.skeleton, rel + stem + '.' + ext);
      const meta = ext === 'json' ? parseSpineJson(JSON.parse(bytes.toString()), atlasInfo(norm.text).regions) : parseSkel(bytes, atlasInfo(norm.text).regions);
      if (!meta.version.startsWith('3.8.') || meta.missingRegions.length || !meta.animations.length) throw new Error('Incompatible illustration skeleton');
      const atlasName = stem + (edgeCorrections.length ? '.edges.atlas' : '.atlas');
      if (!addOnly) await writeFile(resolve(root, 'public/assets', rel + atlasName), norm.text);
      else { try { await readFile(resolve(root, 'public/assets', rel + atlasName)); } catch { await writeFile(resolve(root, 'public/assets', rel + atlasName), norm.text); } }
      const previous = r.field ? manifest.chars?.[r.charId]?.[r.field] : manifest.chars?.[r.charId]?.skins?.[id]?.dynamic;
      const originalFiles = [];
      // Preserve the original web source (including the unmodified face page),
      // even after the native-client source becomes the selected display copy.
      const legacy = `dynamic/${skin.stem}/`, legacyAtlas = legacy + stem + '.source.atlas';
      try {
        const text = await readFile(resolve(root, 'public/assets', legacyAtlas), 'utf8');
        originalFiles.push('/assets/' + legacyAtlas, ...atlasInfo(text).pages.map(p => '/assets/' + legacy + p));
      } catch { /* no earlier web installation */ }
      const dynamic = { skel: '/assets/' + rel + stem + '.' + ext, atlas: '/assets/' + rel + atlasName, textures, pma,
        anims: { idle: meta.animations.find(n => /^idle$/i.test(n)) || meta.animations[0] }, animations: meta.durations,
        bounds: native?.viewBounds || meta.bounds, frames: r.frames, ...(r.frameSource ? { frameSource: r.frameSource } : {}), identity: sha256(bytes), ...(edgeCorrections.length ? { edgeCorrections } : {}),
        ...(native?.viewBounds ? { skeletonBounds: meta.bounds, extraTracks: native.extraTracks, nativeLayers: { particles: native.nativeParticles, holders: native.nativeHolders } } : {}),
        installationFiles: [...new Set(['/assets/' + rel + stem + '.source.atlas', ...info.pages.map(p => '/assets/' + rel + p),
          ...originalFiles, ...(previous?.installationFiles || []), ...(previous ? [previous.skel, previous.atlas, ...previous.textures] : [])])],
        source: native?.bundleSha256 ? { bundle: `arts/dynchars/${r.bundle || id.replace('@', '_')}.ab`, sha256: native.bundleSha256 }
          : { skeleton: r.skeleton, atlas: r.atlas } };
      for (const layer of ['background', 'foreground']) if (r[layer]) {
        await obtain(native?.[layer] ? pathToFileURL(native[layer]).href : r[layer], rel + layer + '.png', true); dynamic[layer] = '/assets/' + rel + layer + '.png';
      }
      const art = {};
      const stillSource = native?.static ? pathToFileURL(native.static).href : r.illust || skin.illust;
      const stillIdentity = native?.static ? 'client:' + native.staticBundle : stillSource;
      const imageId = encodeURIComponent(skin.stem.replace(/_(\d+)$/, '#$1'));
      const mirror = 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/';
      for (const [field, url] of [['avatar', native?.avatar ? pathToFileURL(native.avatar).href : skin.avatar || `${mirror}avatar/${imageId}.png`],
        ['portrait', native?.portrait ? pathToFileURL(native.portrait).href : skin.portrait || `${mirror}portrait/${imageId}.png`], ['illust', stillSource]]) if (url) {
        const priorRec = r.field ? manifest.chars?.[r.charId] : manifest.chars?.[r.charId]?.skins?.[id];
        const prior = priorRec?.[r.field && field !== 'illust' ? field + 'E2' : r.field ? 'illustE2' : field];
        if (prior?.startsWith('/assets/')) {
          try { const b = await readFile(resolve(root, 'public', prior.slice(1))); if (isCompletePng(b) && (field !== 'illust' ||
            (Math.max(pngSize(b).width, pngSize(b).height) > 600 && (!stillSource || previous?.staticSource === stillIdentity || r.field)))) { art[field] = prior; if (field === 'illust') dynamic.staticSource = stillIdentity; continue; } } catch { /* obtain below */ }
        }
        const artFile = field === 'illust' && native?.static ? 'illust-client.png' : field === 'illust' && r.illust ? 'illust-prts.png' : field + '.png';
        try { await obtain(url, rel + artFile, true); art[field] = '/assets/' + rel + artFile; if (field === 'illust') dynamic.staticSource = stillIdentity; }
        catch (e) { if (field !== 'illust') throw e; warnings.push({ id, field, error: e.message }); }
      }
      if (!art.portrait) throw new Error('A static fallback portrait is required');
      if (!art.illust) {
        const prior = manifest.chars?.[r.charId]?.skins?.[id]?.illust;
        if (prior) art.illust = prior;
        else warnings.push({ id, field: 'illust', error: 'No full static illustration declared; using the verified portrait fallback' });
      }
      art.illust ||= art.portrait;
      const rec = manifest.chars[r.charId] ||= {};
      if (r.field) {
        rec[r.field] = dynamic;
        if (art.illust && art.illust !== art.portrait) rec.illustE2 = art.illust;
        dynamic.staticArt = { ...(rec.illustE2 ? { illustE2: rec.illustE2 } : {}), ...(rec.portraitE2 ? { portraitE2: rec.portraitE2 } : {}), ...(rec.avatarE2 ? { avatarE2: rec.avatarE2 } : {}) };
        installed.push(id); log(`[dynamic] installed ${id}: ${meta.animations.length} animations, ${textures.length} pages`); continue;
      }
      rec.skins ||= {};
      dynamic.staticArt = { ...art, ...(rec.skins[id]?.avatarE2 ? { avatarE2: rec.skins[id].avatarE2 } : {}),
        ...(rec.skins[id]?.portraitE2 ? { portraitE2: rec.skins[id].portraitE2 } : {}) };
      rec.skins[id] = { ...rec.skins[id], name: skin.name, group: skin.group, ...art, dynamic };
      installed.push(id); log(`[dynamic] installed ${id}: ${meta.animations.length} animations, ${textures.length} pages`);
    } catch (e) { failed.push({ id, error: String(e.message) }); log(`[dynamic] kept prior ${id}: ${e.message}`); }
  }
  if (installed.length && writeManifest) {
    const { hash: _hash, version: _version, generator: _generator, stats: _stats, ...body } = manifest;
    manifest.hash = contentHash(body);
    const paths = new Set();
    const walk = v => { if (typeof v === 'string' && v.startsWith('/assets/')) paths.add(v.slice(8)); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(body); manifest.stats = countStats(body, totalBytes(resolve(root, 'public/assets'), paths), paths.size);
    const dest = resolve(root, 'data/assets.json'), tmp = dest + '.tmp-' + process.pid;
    await writeFile(tmp, JSON.stringify(manifest)); await rename(tmp, dest);
  }
  const ledger = resolve(root, '.cache/dynamic-install.json');
  await mkdir(dirname(ledger), { recursive: true });
  await writeFile(ledger, JSON.stringify({ installed, failed, warnings, files }, null, 2));
  return { installed, failed, warnings, ledger, manifest };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), offline = args.includes('--offline');
  const localRoot = args.find(a => a.startsWith('--source-cache='))?.slice('--source-cache='.length) || '.cache/dynamic-extract';
  const ids = args.filter(a => a !== '--offline' && !a.startsWith('--source-cache='));
  if (!ids.length) console.log('node tools/install-dynamic-illustrations.mjs <skinId... | --all> [--offline] [--source-cache=PATH]');
  else installDynamicIllustrations(ids, { offline, localRoot }).then(r => { if (r.failed.length) process.exitCode = 1; }).catch(e => { console.error(e); process.exitCode = 1; });
}
