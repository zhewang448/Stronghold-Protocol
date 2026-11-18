#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASE_TAG } from '../server/release-version.js';
import { HERO_SCREENSHOTS, readCatalogue, render } from '../site/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const heroAssets = ['assets/mark.svg', 'assets/plates/strategy.png', 'assets/plates/namecard.png', 'assets/plates/report.png'];
const staticFiles = ['index.html', 'styles.css', 'app.js', 'runtime/i18n.js', 'runtime/i18nPacks.js', '.nojekyll', 'robots.txt', 'NOTICE.md', 'LICENSE', 'build.json'];
const assetPath = file => typeof file === 'string' && /^assets\/(?:[\w.-]+\/)*[\w.-]+$/.test(file) && !file.split('/').some(part => part === '.' || part === '..');
const contains = (dir, file) => {
  const relative = path.relative(dir, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
};

function screenshotHashes(catalogue, records) {
  const indexed = new Map();
  for (const { file, sha256 } of records) {
    if (!assetPath(file) || !/^[0-9a-f]{64}$/.test(sha256) || indexed.has(file)) throw new Error(`Invalid screenshot record: ${file}`);
    indexed.set(file, sha256);
  }
  const used = new Map();
  for (const file of Object.values(HERO_SCREENSHOTS)) {
    if (!indexed.has(file)) throw new Error(`Hero screenshot is missing from the manifest: ${file}`);
    used.set(file, indexed.get(file));
  }
  for (const feature of catalogue.features) {
    for (const picture of [feature.picture, ...(feature.comparisonPicture ? [feature.comparisonPicture] : [])]) {
      if (!indexed.has(picture?.file)) throw new Error(`${feature.id}: screenshot is missing from the manifest: ${picture?.file}`);
      const hash = indexed.get(picture.file);
      if (picture.sha256 !== hash) throw new Error(`${feature.id}: screenshot hash disagrees with the manifest: ${picture.file}`);
      used.set(picture.file, hash);
    }
  }
  return used;
}

/** Return whether a directory can be replaced. A prior build must account for all its files. */
async function inspectDestination(destination) {
  const info = await fs.lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!info) return false;
  if (!info.isDirectory()) throw new Error('Output must be a real directory.');
  const top = await fs.readdir(destination, { withFileTypes: true });
  if (top.length === 0) return true;
  const invalid = () => new Error('Output contains files outside a previous site build. Use an empty output directory.');
  if (!top.some(entry => entry.isFile() && entry.name === 'build.json')) throw invalid();
  const { schema, files } = JSON.parse(await fs.readFile(path.join(destination, 'build.json'), 'utf8'));
  const entries = await fs.readdir(destination, { withFileTypes: true, recursive: true });
  if (entries.some(entry => !entry.isFile() && !entry.isDirectory())) throw invalid();
  const actual = entries.filter(entry => entry.isFile()).map(entry => path.relative(destination, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
  if (schema !== 1 || !Array.isArray(files) || !staticFiles.every(file => files.includes(file))
    || files.some(file => !staticFiles.includes(file) && !assetPath(file))
    || actual.length !== files.length || new Set(files).size !== files.length || actual.some(file => !files.includes(file))) throw invalid();
  return true;
}

export async function buildSite({ outDir = path.join(root, '.cache/site-dist'), sourceRoot = root } = {}) {
  sourceRoot = await fs.realpath(sourceRoot);
  const source = await fs.realpath(path.join(sourceRoot, 'site'));
  const requested = path.resolve(outDir);
  const outsideSources = file => !contains(file, sourceRoot) && !contains(source, file);
  if (!outsideSources(requested)) throw new Error('Output must be outside the site source directory.');
  const parentPath = path.dirname(requested);
  if (parentPath === requested) throw new Error('Output must not be the root of a drive.');
  await fs.mkdir(parentPath, { recursive: true });
  const parent = await fs.realpath(parentPath);
  const name = path.basename(requested);
  const destination = path.join(parent, name);
  if (!outsideSources(destination)) throw new Error('Output must be outside the site source directory.');

  const catalogue = await readCatalogue(pathToFileURL(source + path.sep));
  const pkg = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  const launcher = await fs.readFile(path.join(sourceRoot, 'launcher/StrongholdProtocolLauncher.csproj'), 'utf8');
  const launcherVersion = /<Version>([^<]+)<\/Version>/.exec(launcher)?.[1];
  if (!launcherVersion) throw new Error('Launcher version is missing.');
  const versions = { game: pkg.version, extension: RELEASE_TAG, launcher: launcherVersion };
  if (catalogue.forkRelease !== RELEASE_TAG) throw new Error('Re-audit the catalogue for the new extension release before publishing.');
  const records = JSON.parse(await fs.readFile(path.join(source, 'assets/sources.json'), 'utf8'));
  const screenshots = screenshotHashes(catalogue, records);
  const assets = new Set([...screenshots.keys(), ...heroAssets]);
  const metadata = { schema: 1, versions, upstreamCommit: catalogue.upstreamCommit, forkCommit: catalogue.forkCommit,
    comparisonDate: catalogue.date, chapters: catalogue.groups.length, features: catalogue.features.length,
    files: [...assets, ...staticFiles] };

  const lockPath = path.join(parent, `.${name}.build-lock`);
  const lock = await fs.open(lockPath, 'wx');
  let scratch;
  let preserveScratch = false;
  try {
    const created = await fs.mkdtemp(path.join(parent, '.site-build-'));
    const resolved = await fs.realpath(created);
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('.site-build-')) throw new Error(`Unexpected staging path: ${resolved}`);
    scratch = resolved;
    const stage = path.join(scratch, 'site');
    const previous = path.join(scratch, 'previous');
    for (const relative of assets) {
      const bytes = await fs.readFile(path.join(source, relative));
      const hash = screenshots.get(relative);
      if (hash && createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Screenshot bytes do not match the manifest: ${relative}`);
      await fs.mkdir(path.dirname(path.join(stage, relative)), { recursive: true });
      await fs.writeFile(path.join(stage, relative), bytes);
    }
    await fs.writeFile(path.join(stage, 'index.html'), render(catalogue, versions));
    for (const file of ['styles.css', 'app.js']) await fs.copyFile(path.join(source, file), path.join(stage, file));
    await fs.mkdir(path.join(stage, 'runtime'), { recursive: true });
    for (const file of ['i18n.js', 'i18nPacks.js']) await fs.copyFile(path.join(sourceRoot, 'shared', file), path.join(stage, 'runtime', file));
    await fs.writeFile(path.join(stage, '.nojekyll'), '');
    await fs.writeFile(path.join(stage, 'robots.txt'), 'User-agent: *\nAllow: /\n');
    for (const file of ['NOTICE.md', 'LICENSE']) await fs.copyFile(path.join(sourceRoot, file), path.join(stage, file));
    await fs.writeFile(path.join(stage, 'build.json'), JSON.stringify(metadata, null, 2) + '\n');

    // Both directories are direct descendants of the resolved parent.
    const exists = await inspectDestination(destination);
    if (exists) await fs.rename(destination, previous);
    try {
      await fs.rename(stage, destination);
    } catch (error) {
      if (exists) {
        preserveScratch = true;
        try { await fs.rename(previous, destination); }
        catch (restoreError) { throw new AggregateError([error, restoreError], `Previous output is at ${previous}`, { cause: restoreError }); }
        preserveScratch = false;
      }
      throw error;
    }
  } finally {
    try {
      if (!preserveScratch && scratch) await fs.rm(scratch, { recursive: true, force: true });
    } finally {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
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
