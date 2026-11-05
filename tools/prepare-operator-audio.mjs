// Scoped official presentation metadata; this never refreshes gameplay tables.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..'), commit = '08ba2aea0e8dba88eff0ec0d2c87e24b4db626f8';
const ids = ['char_4247_oxi', 'char_4246_dminon', 'char_4244_tocka'];
const cache = resolve(root, '.cache/operator-extension', commit); await mkdir(cache, { recursive: true });
const sources = [];
async function table(name) {
  const dest = resolve(cache, name + '.json');
  const url = `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${commit}/zh_CN/gamedata/excel/${name}.json`;
  let bytes; try { bytes = await readFile(dest); } catch {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    bytes = Buffer.from(await response.arrayBuffer()); JSON.parse(bytes.toString()); await writeFile(dest, bytes);
  }
  sources.push({ name, url, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
  return JSON.parse(bytes.toString());
}
const audio = await table('audio_data'), words = await table('charword_table');
const match = name => /(?:char_4247_oxi|char_4246_dminon|char_4244_tocka|skchr_(?:oxi|dminon|tocka)_|projectile_chr_(?:oxi|dminon|tocka))/.test(name);
const names = new Set([...audio.soundFXBanks.map(b => b.name), ...Object.keys(audio.bankAlias)].filter(match));
for (const name of names) if (audio.bankAlias[name]) names.add(audio.bankAlias[name]);
const result = { schema: 1, commit, ids, sources,
  audioData: { soundFXBanks: audio.soundFXBanks.filter(b => names.has(b.name)), bankAlias: Object.fromEntries(Object.entries(audio.bankAlias).filter(([name]) => names.has(name))) },
  charword: { charWords: Object.fromEntries(Object.entries(words.charWords).filter(([, v]) => ids.includes(v.charId))),
    voiceLangTypeDict: words.voiceLangTypeDict,
    voiceLangDict: Object.fromEntries(ids.filter(id => words.voiceLangDict[id]).map(id => [id, words.voiceLangDict[id]])) } };
await writeFile(resolve(root, 'docs/research/new-operator-audio-20261101.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ banks: result.audioData.soundFXBanks.length, words: Object.keys(result.charword.charWords).length, sources }));
