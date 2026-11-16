import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { buildSite } from '../../tools/build-site.mjs';

const chrome = process.env.CHROME_PATH;
const enabled = process.env.SP_E2E === '1' && !!chrome;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };

test('showcase: repository subpath, responsive navigation, filtering, image focus and script-free content', { skip: !enabled, timeout: 120000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stronghold-site-browser-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { destination } = await buildSite({ outDir: path.join(root, 'dist') });
  const prefix = '/Stronghold-Protocol/';
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!pathname.startsWith(prefix)) { res.writeHead(404); res.end(); return; }
      const relative = pathname.slice(prefix.length) || 'index.html';
      const file = path.resolve(destination, relative);
      if (!file.startsWith(destination + path.sep)) { res.writeHead(403); res.end(); return; }
      const bytes = await fs.readFile(file);
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--mute-audio'] });
  t.after(() => browser.close());
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const out = process.env.SITE_SCREENSHOT_DIR;
  if (out) await fs.mkdir(out, { recursive: true });
  for (const width of [1440, 1920, 390, 768]) {
    const height = width < 800 ? 844 : 960;
    await page.setViewport({ width, height });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.filters:not([hidden])');
    assert.equal(await page.$$eval('[data-feature]', nodes => nodes.length), 44);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}`);
    assert(await page.$eval('.hero h1', node => node.getBoundingClientRect().right <= innerWidth));
    assert(await page.$$eval('.zoomable img', images => images.every(image => {
      const bounds = image.getBoundingClientRect();
      const frame = image.parentElement.getBoundingClientRect();
      return bounds.top >= frame.top - 1 && bounds.bottom <= frame.bottom + 1;
    })), `image escapes its frame at ${width}`);
    if (width === 1440) assert(await page.$eval('.hero-secondary-pictures', node => node.getBoundingClientRect().bottom < 960), 'approved hero collage must fit the first viewport');
    if (out) await page.screenshot({ path: path.join(out, `site-${width}.png`) });
    if (width === 1440 && out) {
      await page.locator('#strategy-map').scroll();
      await page.waitForFunction(() => [...document.querySelectorAll('#strategy-map img')].every(img => img.complete && img.naturalWidth > 0));
      await page.screenshot({ path: path.join(out, 'site-desktop-comparison.png') });
    }
    if (width < 800) {
      assert.equal(await page.$eval('.sidebar', node => node.hidden), true);
      await page.click('.directory-toggle');
      assert.equal(await page.$eval('.directory-toggle', node => node.getAttribute('aria-expanded')), 'true');
      if (out && width === 390) await page.screenshot({ path: path.join(out, 'site-mobile-directory.png') });
      await page.click('.sidebar a[href="#hosting"]');
      assert.equal(await page.$eval('.sidebar', node => node.hidden), true);
      assert.equal(new URL(page.url()).hash, '#hosting');
    }
  }
  await page.setViewport({ width: 1440, height: 960 });
  await page.goto(base + '?audience=host#summary', { waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('[data-filter="host"]', node => node.getAttribute('aria-pressed')), 'true');
  assert(await page.$$eval('tbody tr:not([hidden])', nodes => nodes.length > 0 && nodes.every(node => node.dataset.audience.includes('host'))));
  await page.click('[data-filter="player"]');
  assert(await page.$$eval('tbody tr:not([hidden])', nodes => nodes.every(node => node.dataset.audience.includes('player'))));
  await page.click('[data-filter="all"]');
  assert.equal(await page.$$eval('tbody tr:not([hidden])', nodes => nodes.length), 44);
  await page.goto(base + '#strategy-map', { waitUntil: 'networkidle0' });
  await page.click('#strategy-map [data-zoom]');
  assert.equal(await page.$eval('.lightbox', node => node.open), true);
  assert(await page.$eval('.lightbox img', node => node.complete && node.naturalWidth > 0));
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('.lightbox', node => node.open), false);
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-feature]')?.id), 'strategy-map');
  if (out) {
    for (const feature of await page.$$('[data-feature]')) {
      await feature.evaluate(node => node.scrollIntoView({ behavior: 'instant', block: 'start' }));
      await page.waitForFunction(() => [...document.querySelectorAll('img')].filter(image => {
        const rect = image.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      }).every(image => image.complete && image.naturalWidth > 0));
    }
    const tiles = [];
    for (const id of ['top', 'loadout', 'named-presets', 'historical-equipment', 'battle', 'strategy-map', 'team-flyout', 'deploy-snap', 'appearance', 'dynamic-art', 'native-cursor', 'art-retry', 'cooperation', 'expanded-coop', 'chat-and-pings', 'small-screen', 'training', 'dummy-test', 'same-condition-ab', 'host-replays', 'personal', 'profile-backup', 'domain-transfer', 'hosting', 'windows-launcher', 'monitor-wall', 'match-recovery', 'summary', 'download', 'credits']) {
      await page.$eval('#' + id, node => node.scrollIntoView({ behavior: 'instant', block: 'start' }));
      await page.waitForFunction(() => [...document.querySelectorAll('img')].filter(image => {
        const rect = image.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      }).every(image => image.complete && image.naturalWidth > 0));
      const file = `tile-${id}.png`;
      await page.screenshot({ path: path.join(out, file) });
      tiles.push({ id, file, scrollY: await page.evaluate(() => scrollY), width: 1440, height: 960 });
    }
    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let offset = 0, index = 0; offset < documentHeight; offset += 800, index++) {
      await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), offset);
      const file = `contiguous-${String(index).padStart(2, '0')}.png`;
      await page.screenshot({ path: path.join(out, file) });
      tiles.push({ kind: 'contiguous', file, scrollY: await page.evaluate(() => scrollY), width: 1440, height: 960, documentHeight });
    }
    await fs.writeFile(path.join(out, 'tiles.json'), JSON.stringify(tiles, null, 2));
  }
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
  await page.setJavaScriptEnabled(false);
  await page.goto(base, { waitUntil: 'networkidle0' });
  assert.equal(await page.$$eval('[data-feature]', nodes => nodes.length), 44);
  assert(await page.$eval('a[href$="/releases/latest"]', node => node.offsetWidth > 0));
  assert.deepEqual(errors, []);
});
