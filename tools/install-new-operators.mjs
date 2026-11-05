// Install only the three scoped operators through the normal asset planner and Spine parser.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { isCompletePng } from './assets/formats.mjs';
import { buildPlan } from './assets/plan.mjs';
import { Downloader } from './assets/downloader.mjs';
import { collectLeaves, downloadLeaves, resolveTemplate, contentHash, totalBytes } from './assets/manifest.mjs';
import { processModels } from './assets/spine.mjs';
import { countStats } from './fetch-assets.mjs';
import { indexAudio } from './assets/audio.mjs';
import { charModesFromIndex } from './assets/plan.mjs';

const root = resolve(import.meta.dirname, '..');
const json = async p => JSON.parse(await readFile(resolve(root, p), 'utf8'));
const source = await json('docs/research/new-operators-20261101.json');
const extraOperators = Object.fromEntries(source.ids.map(id => [id, { ...source.charTable[id],
  skills: source.charTable[id].skills.map((s, index) => ({ ...s, index, iconId: source.skillTable[s.skillId].levels[0].iconId })) }]));
const audioInput = await json('docs/research/new-operator-audio-20261101.json');
const audio = indexAudio(audioInput.audioData);
let charModes = null;
try { charModes = charModesFromIndex(await json('public/assets/local/fx/index.json')); } catch { /* optional extract */ }
const plan = buildPlan({ assets07: {}, ops03: {}, enemies05: {}, maps05: {}, audio, modelsData: {},
  extraOperators, charword: audioInput.charword, charModes, optionalVoice: true });
const assetRoot = resolve(root, 'public/assets'), offline = process.argv.includes('--offline');
const dl = new Downloader({ root: assetRoot, ledgerPath: resolve(root, '.cache/new-operator-ledger.json'), concurrency: 4, retries: 2, timeoutMs: 30000, source: 'direct', log: console.log });
await dl.loadLedger();
const template = { chars: plan.template.chars, skills: plan.template.skills, skillsById: plan.template.skillsById, prof: { sub: plan.template.prof.sub }, audio: plan.template.audio };
if (!offline) await downloadLeaves(collectLeaves(template), dl, assetRoot, 'new operators');
const parsed = await processModels(plan.models, { root: assetRoot, dl, cachePath: resolve(root, '.cache/new-operator-spines.json'), download: !offline, log: console.log });
const result = resolveTemplate(template, { root: assetRoot, spine: parsed.entries });
const manifest = await json('data/assets.json');
for (const section of ['chars', 'skills', 'skillsById']) for (const [key, value] of Object.entries(result.value[section] || {})) {
  manifest[section] ||= {};
  manifest[section][key] = section === 'chars' ? { ...manifest[section][key], ...value } : value;
}
manifest.audio ||= {};
for (const tree of ['voice', 'voiceJp', 'voiceEn', 'voiceKr', 'voiceNative', 'voiceNativeLangType']) Object.assign(manifest.audio[tree] ||= {}, result.value.audio?.[tree]);
manifest.audio.sfx ||= {};
for (const field of ['units', 'pools']) Object.assign(manifest.audio.sfx[field] ||= {}, result.value.audio?.sfx?.[field]);
const illustrations = [];
for (const id of source.ids) for (const phase of [1, 2]) {
  const title = `立绘_${source.charTable[id].name}_${phase}.png`, hash = createHash('md5').update(title).digest('hex');
  const url = `https://media.prts.wiki/${hash[0]}/${hash.slice(0, 2)}/${encodeURIComponent(title)}`;
  const rel = `char/illust/${id}_${phase}.png`, path = resolve(assetRoot, rel);
  let b;
  try { b = await readFile(path); } catch { /* download below */ }
  if (!b && !offline) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      b = Buffer.from(await response.arrayBuffer());
      if (!isCompletePng(b)) throw new Error('Invalid illustration PNG');
      await mkdir(resolve(assetRoot, 'char/illust'), { recursive: true }); await writeFile(path, b);
    } catch (e) { console.error(`[illustration] ${id}/${phase}: ${e.message}`); }
  }
  if (b && isCompletePng(b)) {
    manifest.chars[id][phase === 1 ? 'illust' : 'illustE2'] = '/assets/' + rel;
    illustrations.push({ id, phase, url, bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') });
  }
}
Object.assign((manifest.prof ||= {}).sub ||= {}, result.value.prof?.sub);
const { hash: _hash, version: _version, generator: _generator, stats: _stats, ...body } = manifest;
const files = new Set();
const walk = v => { if (typeof v === 'string' && v.startsWith('/assets/')) files.add(v.slice(8)); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
walk(body); manifest.hash = contentHash(body); manifest.stats = countStats(body, totalBytes(assetRoot, files), files.size);
const dest = resolve(root, 'data/assets.json'), tmp = dest + '.tmp-' + process.pid;
await writeFile(tmp, JSON.stringify(manifest)); await rename(tmp, dest);
const missing = {};
for (const id of source.ids) {
  const rec = manifest.chars[id];
  const fields = ['avatar', 'portrait', 'illust', 'illustE2'];
  missing[id] = [];
  for (const field of fields) {
    try {
      if (!rec?.[field]?.startsWith('/assets/')) throw new Error('missing record');
      if (!isCompletePng(await readFile(resolve(root, 'public', rec[field].slice(1))))) throw new Error('invalid PNG');
    } catch { missing[id].push(field); }
  }
  for (const side of ['front', 'back']) {
    const spine = rec?.spine?.[side];
    if (!spine) { missing[id].push('spine.' + side); continue; }
    for (const file of [spine.skel, spine.atlas, ...spine.textures]) {
      try { if (!(await readFile(resolve(root, 'public', file.slice(1)))).length) throw new Error('empty'); }
      catch { missing[id].push('spine.' + side + ':' + file); }
    }
  }
}
const failed = source.ids.filter(id => missing[id].length);
const audioMissing = result.misses.filter(p => p.startsWith('audio.'));
await writeFile(resolve(root, '.cache/new-operator-assets-report.json'), JSON.stringify({ failed, missing, audioMissing, problems: parsed.problems, misses: result.misses, illustrations }, null, 2));
console.log(`new operator assets: ${source.ids.length - failed.length}/${source.ids.length} complete`);
console.log(`new operator audio: ${audioMissing.length} missing planned entries`);
if (failed.length || audioMissing.length) process.exitCode = 1;
