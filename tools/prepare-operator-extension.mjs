// Regenerate the scoped, pinned official input; never refresh the historical game tables.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const commit = '08ba2aea0e8dba88eff0ec0d2c87e24b4db626f8';
const ids = ['char_4247_oxi', 'char_4246_dminon', 'char_4244_tocka'];
const cache = resolve(root, '.cache/operator-extension', commit);
const sha256 = b => createHash('sha256').update(b).digest('hex');
await mkdir(cache, { recursive: true });
const sources = [];
async function table(name) {
  const url = `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${commit}/zh_CN/gamedata/excel/${name}.json`;
  const dest = resolve(cache, name + '.json');
  let bytes;
  try { bytes = await readFile(dest); } catch {
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
        bytes = Buffer.from(await r.arrayBuffer()); JSON.parse(bytes.toString());
        await writeFile(dest, bytes); break;
      } catch (e) { if (i === 3) throw e; console.error(`retry ${name}: ${e.message}`); }
    }
  }
  sources.push({ name, url, sha256: sha256(bytes), bytes: bytes.length });
  console.log(`${name}: ${bytes.length} bytes ${sha256(bytes)}`);
  return JSON.parse(bytes.toString());
}
const charTable = await table('character_table');
const skillTable = await table('skill_table');
const rangeTable = await table('range_table');
const uniequip = await table('uniequip_table');
const battleEquip = await table('battle_equip_table');
const chars = Object.fromEntries(ids.map(id => {
  if (!charTable[id]) throw new Error(`missing official character ${id}`);
  return [id, charTable[id]];
}));
const skillIds = [...new Set(Object.values(chars).flatMap(ch => ch.skills.map(s => s.skillId)))];
const skills = Object.fromEntries(skillIds.map(id => [id, skillTable[id]]));
const rangeIds = new Set(Object.values(chars).flatMap(ch => ch.phases.map(p => p.rangeId)));
for (const s of Object.values(skills)) for (const level of s.levels) if (level.rangeId) rangeIds.add(level.rangeId);
const equips = Object.fromEntries(Object.entries(uniequip.equipDict).filter(([, e]) => ids.includes(e.charId)));
for (const [id, e] of Object.entries(battleEquip)) if (equips[id]) {
  for (const p of e.phases || []) for (const cand of p.addOrOverrideTalentDataBundle?.candidates || []) if (cand.rangeId) rangeIds.add(cand.rangeId);
}
const result = { schema: 1, version: 'act2autochess', commit, ids, sources,
  charTable: chars, skillTable: skills, rangeTable: Object.fromEntries([...rangeIds].filter(Boolean).map(id => [id, rangeTable[id]])),
  uniequip: { equipDict: equips, charEquip: Object.fromEntries(ids.map(id => [id, uniequip.charEquip[id] || []])),
    subProfDict: Object.fromEntries(Object.values(chars).map(ch => [ch.subProfessionId, uniequip.subProfDict[ch.subProfessionId]])) },
  battleEquip: Object.fromEntries(Object.keys(equips).filter(id => battleEquip[id]).map(id => [id, battleEquip[id]])) };
await writeFile(resolve(root, 'docs/research/new-operators-20261101.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`scoped extension: ${ids.length} characters, ${skillIds.length} skills, ${Object.keys(equips).length} equips`);
