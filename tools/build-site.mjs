#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASE_TAG } from '../server/release-version.js';
import { readCatalogue, render } from '../site/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildSite({ outDir = path.join(root, '.cache/site-dist'), sourceRoot = root } = {}) {
  const destination = path.resolve(outDir);
  const source = path.join(sourceRoot, 'site');
  if (destination === sourceRoot || destination === source || destination.startsWith(source + path.sep)) throw new Error('Output must be outside the site source directory.');
  const catalogue = await readCatalogue(pathToFileURL(source + path.sep));
  const pkg = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  const launcher = await fs.readFile(path.join(sourceRoot, 'launcher/StrongholdProtocolLauncher.csproj'), 'utf8');
  const launcherVersion = /<Version>([^<]+)<\/Version>/.exec(launcher)?.[1];
  if (!launcherVersion) throw new Error('Launcher version is missing.');
  const versions = { game: pkg.version, extension: RELEASE_TAG, launcher: launcherVersion };
  if (catalogue.forkRelease !== RELEASE_TAG) throw new Error('Re-audit the catalogue for the new extension release before publishing.');
  await fs.mkdir(destination, { recursive: true });
  const sources = JSON.parse(await fs.readFile(path.join(source, 'assets/sources.json'), 'utf8'));
  const files = [...new Set([...sources.map(record => record.file), 'assets/mark.svg', 'assets/plates/strategy.png', 'assets/plates/namecard.png', 'assets/plates/report.png'])];
  for (const relative of files) {
    if (!relative.startsWith('assets/') || relative.includes('..') || path.isAbsolute(relative)) throw new Error('Invalid public asset path.');
    await fs.mkdir(path.dirname(path.join(destination, relative)), { recursive: true });
    await fs.copyFile(path.join(source, relative), path.join(destination, relative));
  }
  await fs.writeFile(path.join(destination, 'index.html'), render(catalogue, versions));
  for (const file of ['styles.css', 'app.js']) await fs.copyFile(path.join(source, file), path.join(destination, file));
  await fs.mkdir(path.join(destination, 'runtime'), { recursive: true });
  for (const file of ['i18n.js', 'i18nPacks.js']) await fs.copyFile(path.join(sourceRoot, 'shared', file), path.join(destination, 'runtime', file));
  await fs.writeFile(path.join(destination, '.nojekyll'), '');
  await fs.writeFile(path.join(destination, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  await fs.copyFile(path.join(sourceRoot, 'NOTICE.md'), path.join(destination, 'NOTICE.md'));
  await fs.copyFile(path.join(sourceRoot, 'LICENSE'), path.join(destination, 'LICENSE'));
  const metadata = { schema: 1, versions, upstreamCommit: catalogue.upstreamCommit, forkCommit: catalogue.forkCommit,
    comparisonDate: catalogue.date, chapters: catalogue.groups.length, features: catalogue.features.length,
    files: [...files, 'index.html', 'styles.css', 'app.js', 'runtime/i18n.js', 'runtime/i18nPacks.js', '.nojekyll', 'robots.txt', 'NOTICE.md', 'LICENSE', 'build.json'] };
  await fs.writeFile(path.join(destination, 'build.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(`site: ${metadata.chapters} chapters, ${metadata.features} features; ${versions.extension}; launcher ${versions.launcher}`);
  console.log(`site output: ${destination}`);
  return { destination, metadata };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) {
    console.error('Usage: node tools/build-site.mjs [--out DIRECTORY]');
    process.exitCode = 2;
  } else {
    try { await buildSite({ outDir: args[1] }); } catch (error) { console.error(`site: ${error.message}`); process.exitCode = 1; }
  }
}
