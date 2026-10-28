import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'ui-preview');
const publicRoot = path.join(root, 'public');

export function previewBase(repository = '', explicit) {
  if (explicit !== undefined) {
    if (!/^\/(?:[\w.-]+\/)*$/.test(explicit) || explicit.split('/').some((part) => part === '.' || part === '..')) {
      throw new Error('PREVIEW_BASE must be an absolute path ending in /');
    }
    return explicit;
  }
  const [owner, name] = repository.split('/');
  if (!owner || !name || name.toLowerCase() === `${owner.toLowerCase()}.github.io`) return '/';
  if (!/^[\w.-]+$/.test(name)) throw new Error('Invalid repository name');
  return `/${name}/`;
}

export function rewritePreviewPaths(text, base, depth = 0) {
  if (base === '/') return text;
  return text
    .replace(/(["'`(=])\/(js|vendor|css|fonts|shared|data|i18n|icons|assets|media|sim|dev|packs)\//g, `$1${base}$2/`)
    .replace(/(["'`])((?:\.\.\/)+)(shared|vendor)\//g, (match, quote, parents, directory) =>
      parents.length / 3 > depth ? `${quote}${base}${directory}/` : match);
}

function rewriteDirectory(directory, base, siteRoot = directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) rewriteDirectory(filename, base, siteRoot);
    else if (/\.(?:js|mjs|css|html)$/.test(entry.name)) {
      const relative = path.relative(siteRoot, directory);
      const depth = relative ? relative.split(path.sep).length : 0;
      writeFileSync(filename, rewritePreviewPaths(readFileSync(filename, 'utf8'), base, depth));
    }
  }
}

export function buildPreview({ base = previewBase(process.env.GITHUB_REPOSITORY || '', process.env.PREVIEW_BASE) } = {}) {
  if (!existsSync(path.join(publicRoot, 'vendor', 'preact.module.js'))) {
    throw new Error('Preview dependencies are missing; run npm ci or npm run vendor first');
  }
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const directory of ['js', 'css', 'vendor', 'i18n', 'icons']) {
    cpSync(path.join(publicRoot, directory), path.join(output, directory), { recursive: true });
  }
  cpSync(path.join(root, 'shared'), path.join(output, 'shared'), { recursive: true });
  cpSync(path.join(root, 'server', 'sim'), path.join(output, 'sim'), {
    recursive: true,
    filter: (source) => statSync(source).isDirectory()
      || (source.endsWith('.js') && path.basename(source).toLowerCase() !== 'nodedata.js'),
  });
  mkdirSync(path.join(output, 'data'), { recursive: true });
  for (const file of ['config', 'chess', 'bonds', 'items', 'bands', 'enemies', 'bosses', 'stages', 'tokens',
    'choices', 'effects', 'garrisons', 'factions', 'backups', 'seat-art', 'skins', 'waves']) {
    cpSync(path.join(root, 'data', `${file}.json`), path.join(output, 'data', `${file}.json`));
  }
  mkdirSync(path.join(output, 'dev'), { recursive: true });
  for (const file of ['game-mock.html', 'game-mock.js', 'settle-fixture.js']) {
    cpSync(path.join(publicRoot, 'dev', file), path.join(output, 'dev', file));
  }
  cpSync(path.join(publicRoot, 'preview', 'index.html'), path.join(output, 'index.html'));
  mkdirSync(path.join(output, 'media', 'features'), { recursive: true });
  for (const file of ['online-players.webp', 'expanded-coop-groups.webp', 'round-chart.webp', 'host-console.webp', 'mobile-hub.webp']) {
    cpSync(path.join(root, 'docs', 'img', 'features', file), path.join(output, 'media', 'features', file));
  }
  mkdirSync(path.join(output, 'fonts'), { recursive: true });
  writeFileSync(path.join(output, 'fonts', 'fonts.css'), '');
  writeFileSync(path.join(output, 'data', 'assets.json'), JSON.stringify({ version: 1, chars: {}, enemies: {}, tokens: {}, bonds: {}, items: {}, bands: {}, skills: {}, modules: {}, ui: {} }));
  writeFileSync(path.join(output, 'data', 'local-assets.json'), JSON.stringify({ groups: {} }));
  writeFileSync(path.join(output, 'data.js'), "import { getSimData } from './sim/simdata.js';\nexport function getData() { return getSimData() || {}; }\nexport function resetData() {}\n");
  rewriteDirectory(output, base);
  return { output, base };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildPreview();
  console.log(`Preview built: ${result.output} (base ${result.base})`);
}
