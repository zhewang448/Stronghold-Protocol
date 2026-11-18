import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HERO_SCREENSHOTS, readCatalogue, render, escapeHtml } from '../site/render.mjs';
import { buildSite } from '../tools/build-site.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('showcase covers every chapter with unique deep links, provenance and explicit comparison boundaries', async () => {
  const catalogue = await readCatalogue();
  assert.equal(catalogue.groups.length, 7);
  assert.equal(catalogue.features.length, 44);
  assert.equal(new Set(catalogue.features.map(f => f.id)).size, 44);
  const chapters = new Set(catalogue.groups.map(g => g.id));
  for (const f of catalogue.features) {
    assert(chapters.has(f.group));
    for (const key of ['title', 'benefit', 'upstream', 'entry', 'default', 'scope', 'origin', 'imageUse', 'forkSource']) assert(f[key], `${f.id}: ${key}`);
    assert(f.audiences.length > 0 && f.audiences.every(role => ['player', 'host'].includes(role)));
    assert(f.forkSource.includes(catalogue.forkCommit));
    assert(f.upstreamSource.includes(catalogue.upstreamCommit));
  }
  const equipment = catalogue.features.find(f => f.id === 'historical-equipment');
  assert.match(equipment.upstream, /规程本来就有/);
  assert.match(equipment.default, /默认关闭/);
});

test('showcase output is readable without JavaScript and every image and anchor resolves under a repository subpath', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'stronghold-site-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const { destination, metadata } = await buildSite({ outDir: path.join(temp, 'Stronghold-Protocol') });
  const html = await fs.readFile(path.join(destination, 'index.html'), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  assert.equal([...html.matchAll(/data-feature="/g)].length, 44);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert(ids.has(id), id);
  const base = new URL('https://example.org/Stronghold-Protocol/');
  for (const [, src] of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|png|webp|svg))"/g)) {
    if (new URL(src, base).origin !== base.origin) continue;
    assert(new URL(src, base).pathname.startsWith('/Stronghold-Protocol/'), src);
    assert((await fs.stat(path.join(destination, src))).isFile());
  }
  const actual = [];
  async function list(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await list(path.join(directory, entry.name));
      else actual.push(path.relative(destination, path.join(directory, entry.name)).replaceAll('\\', '/'));
    }
  }
  await list(destination);
  assert.deepEqual(actual.sort(), [...metadata.files].sort());
  assert(!actual.some(name => /(?:logs|node_modules|public\/assets|design\/|admin|token|\.spdata)/i.test(name)));
  assert.match(html, /我是玩家/);
  assert.match(html, /我要开服/);
  assert.match(html, /releases\/latest/);
  const csproj = await fs.readFile(path.join(root, 'launcher/StrongholdProtocolLauncher.csproj'), 'utf8');
  const [, version] = csproj.match(/<Version>([^<]+)<\/Version>/);
  assert.equal(metadata.versions.launcher, version);
  assert(html.includes(`启动器 ${version}`));
});

test('showcase validates its screenshots before replacing managed output and removes obsolete assets', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'stronghold-site-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const fixture = path.join(temp, 'src');
  const outDir = path.join(temp, 'dist');
  for (const file of ['site/assets', 'site/styles.css', 'site/app.js', 'shared/i18n.js', 'shared/i18nPacks.js', 'launcher/StrongholdProtocolLauncher.csproj', 'package.json', 'NOTICE.md', 'LICENSE']) {
    await fs.cp(path.join(root, file), path.join(fixture, file), { recursive: true });
  }
  const catalogue = await readCatalogue();
  const save = () => fs.writeFile(path.join(fixture, 'site/catalogue.json'), JSON.stringify(catalogue));
  const build = () => buildSite({ sourceRoot: fixture, outDir });
  const hero = Object.values(HERO_SCREENSHOTS);
  const usage = catalogue.features.flatMap(feature => [feature.picture.file, feature.comparisonPicture?.file]);
  const unusedNext = catalogue.features.find(feature => !hero.includes(feature.picture.file) && usage.filter(file => file === feature.picture.file).length === 1);
  const { picture } = unusedNext;
  await save();
  await build();
  const originalHtml = await fs.readFile(path.join(outDir, 'index.html'), 'utf8');
  unusedNext.picture = { ...picture, file: 'assets/screenshots/absent.webp' };
  await save();
  await assert.rejects(build, /missing from the manifest/);
  assert.equal(await fs.readFile(path.join(outDir, 'index.html'), 'utf8'), originalHtml);
  assert((await fs.stat(path.join(outDir, picture.file))).isFile());

  const replacement = catalogue.features.find(feature => feature !== unusedNext).picture;
  unusedNext.picture = replacement;
  await save();
  const { metadata } = await build();
  assert(!metadata.files.includes(picture.file));
  await assert.rejects(fs.stat(path.join(outDir, picture.file)), { code: 'ENOENT' });

  await fs.writeFile(path.join(outDir, 'unrelated.txt'), 'keep me');
  await assert.rejects(build, /files outside a previous site build/);
  assert.equal(await fs.readFile(path.join(outDir, 'unrelated.txt'), 'utf8'), 'keep me');
});

test('showcase rendering escapes source text and preserves original screenshot hashes', async () => {
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
  const catalogue = await readCatalogue();
  const poisoned = structuredClone(catalogue);
  poisoned.features[0].title = '<img src=x onerror=alert(1)>';
  const html = render(poisoned, { game: '0.4.0', extension: 'v0.4.0-extended.1', launcher: '1.4.1' });
  assert(!html.includes('<img src=x'));
  for (const record of JSON.parse(await fs.readFile(path.join(root, 'site/assets/sources.json'), 'utf8'))) {
    const bytes = await fs.readFile(path.join(root, 'site', record.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
  }
});
