// Optional cosmetic catalogue. Official tables define names/skins; the existing art dump defines available images.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
export async function buildSeatArt({ root, cache, out, download = false }) {
  const read = p => readFile(p, 'utf8').then(JSON.parse);
  const skinFile = join(cache, 'excel/skin_table.json');
  try { await readFile(skinFile); } catch {
    if (!download) throw Error('Offline seat art build requires cached excel/skin_table.json');
    const response = await fetch('https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/skin_table.json');
    if (!response.ok) throw Error(`skin_table: ${response.status}`);
    await mkdir(join(cache, 'excel'), { recursive: true });
    await writeFile(skinFile, await response.text());
  }
  const characters = await read(join(cache, 'excel/character_table.json'));
  // Explicit current extension only; leave the historical official cache unchanged.
  const extension = await read(join(root, 'docs/research/new-operators-20261101.json')).catch(() => null);
  if (extension?.charTable) Object.assign(characters, extension.charTable);
  const skins = await read(skinFile);
  const available = new Set(await read(join(root, 'docs/research/seat-art-portraits.json')));
  const catalogue = { version: 1, chars: {} }, jobs = new Map();
  for (const [id, c] of Object.entries(characters).sort(([a], [b]) => a.localeCompare(b))) {
    if (c.isNotObtainable || ['TOKEN', 'TRAP'].includes(c.profession) || !id.startsWith('char_')) continue;
    const choices = [];
    for (const s of Object.values(skins.charSkins)) {
      if (s.charId !== id || !s.portraitId || !available.has(`${s.portraitId}.png`)) continue;
      const file = `${s.portraitId}.png`, local = file.replaceAll('#', '_').replaceAll('+', '_plus');
      const portrait = `/assets/seat-portrait/${local}`;
      choices.push({ id: s.skinId, name: s.displaySkin.skinName || s.displaySkin.skinGroupName || c.name, portrait });
      jobs.set(local, `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/portrait/${encodeURIComponent(file)}`);
    }
    if (extension?.ids?.includes(id)) for (const ph of [1, 2]) if (!choices.some(s => s.id === `${id}#${ph}`)) {
      choices.push({ id: `${id}#${ph}`, name: c.name, portrait: `/assets/char/portrait/${id}_${ph}.png` });
    }
    if (choices.length) catalogue.chars[id] = { charId: id, name: c.name, appellation: c.appellation, rarity: Number(String(c.rarity).split('_').at(-1)), choices };
  }
  await mkdir(out, { recursive: true });
  const dest = join(out, 'seat-art.json'), tmp = dest + '.tmp-' + process.pid;
  await writeFile(tmp, JSON.stringify(catalogue)); await rename(tmp, dest);
  if (download) {
    await installSeatPortraits(root, jobs);
  }
  console.log(`Seat art: ${Object.keys(catalogue.chars).length} operators, ${jobs.size} portraits`);
  return catalogue;
}

export async function installSeatPortraits(root, jobs) {
    const assetRoot = join(root, 'public/assets/seat-portrait'); await mkdir(assetRoot, { recursive: true });
    const queue = [...jobs], failed = []; let completed = 0;
    await Promise.all(Array.from({ length: 10 }, async () => {
      while (queue.length) {
        const [file, url] = queue.shift(), target = join(assetRoot, file);
        try {
          const bytes = await readFile(target);
          if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') { completed++; continue; }
        } catch { /* download */ }
        let ok = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw Error(String(r.status));
            const bytes = Buffer.from(await r.arrayBuffer());
            if (bytes.length < 8 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw Error('not PNG');
            await writeFile(target + '.tmp', bytes); await rename(target + '.tmp', target); ok = true; break;
          } catch { /* retry */ }
        }
        if (ok) completed++; else failed.push(file);
      }
    }));
    console.log(`Seat art: ${completed}/${jobs.size} images; ${failed.length} failed`);
    if (failed.length) throw Error(`Missing seat art: ${failed.join(', ')}`);
}
