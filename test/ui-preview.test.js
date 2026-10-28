import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { buildPreview, previewBase, rewritePreviewPaths } from '../tools/build-preview.mjs';
import { CHROME, hasChrome } from './e2e/client.mjs';

const root = path.resolve('.');
const read = (file) => readFileSync(file, 'utf8');
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('preview base supports project and account sites and rejects unsafe paths', () => {
  assert.equal(previewBase('owner/Stronghold-Protocol', undefined), '/Stronghold-Protocol/');
  assert.equal(previewBase('Owner/owner.github.io', undefined), '/');
  assert.equal(previewBase('owner/repo', '/custom/'), '/custom/');
  assert.throws(() => previewBase('owner/repo', '/../'), /PREVIEW_BASE/);
  assert.throws(() => previewBase('owner/invalid name', undefined), /repository/);
});

test('path rewriting preserves in-tree relative imports', () => {
  assert.equal(rewritePreviewPaths('src="/js/main.js"', '/repo/', 0), 'src="/repo/js/main.js"');
  assert.equal(rewritePreviewPaths("import '../../shared/cdn.js'", '/repo/', 1), "import '/repo/shared/cdn.js'");
  assert.equal(rewritePreviewPaths("import '../../shared/tier1.js'", '/repo/', 4), "import '../../shared/tier1.js'");
  assert.equal(rewritePreviewPaths('src="/js/main.js"', '/', 0), 'src="/js/main.js"');
});

test('static preview copies the real mock without local art or modifying its source', () => {
  const original = path.join(root, 'public', 'dev', 'game-mock.html');
  const before = hash(original);
  const { output, base } = buildPreview({ base: '/Stronghold-Protocol/' });
  assert.equal(base, '/Stronghold-Protocol/');
  assert.equal(hash(original), before);
  assert.match(read(path.join(output, 'dev', 'game-mock.html')), /src="\/Stronghold-Protocol\/dev\/game-mock\.js"/);
  assert.match(read(path.join(output, 'index.html')), /dev\/game-mock\.html/);
  assert.equal(existsSync(path.join(output, 'media', 'features', 'online-players.webp')), true);
  assert.equal(existsSync(path.join(output, 'assets')), false);
  assert.equal(existsSync(path.join(output, 'sim', 'nodeData.js')), false);
  assert.deepEqual(JSON.parse(read(path.join(output, 'data', 'local-assets.json'))), { groups: {} });
  assert.deepEqual(JSON.parse(read(path.join(output, 'data', 'assets.json'))).chars, {});
});

test('static preview supports phase changes, purchases and screenshots in the browser',
  { skip: process.env.SP_E2E !== '1' || !hasChrome() }, async (context) => {
    const output = path.join(root, 'dist', 'ui-preview');
    const base = '/Stronghold-Protocol/';
    const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    const server = createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (!pathname.startsWith(base)) { response.writeHead(404).end(); return; }
      const file = path.resolve(output, pathname.slice(base.length) || 'index.html');
      if (!file.startsWith(`${output}${path.sep}`)) { response.writeHead(403).end(); return; }
      try {
        const content = await readFile(file);
        response.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream' }).end(content);
      } catch { response.writeHead(404).end(); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    context.after(async () => {
      if (browser) await browser.close();
      await new Promise((resolve) => server.close(resolve));
    });
    const puppeteer = (await import('puppeteer-core')).default;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN'] }));
    const failed = [];
    page.on('response', (response) => { if (response.status() >= 400) failed.push(response.url()); });
    page.on('pageerror', (error) => failed.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}${base}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelector('#demo')?.contentWindow?.__MOCK__);
    await page.$eval('#demo', (element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const frame = await (await page.$('#demo')).contentFrame();
    const funds = await frame.evaluate(() => globalThis.__MOCK__.S().priv.funds);
    await frame.click('[data-shop-slot="0"]');
    await frame.click('[data-shop-slot="0"]');
    await frame.waitForFunction(() => globalThis.__MOCK__.S().priv.shop.slots[0].sold);
    assert.ok(await frame.evaluate(() => globalThis.__MOCK__.S().priv.funds) < funds);
    for (const phase of ['INFO_CHECK', 'BAND_DRAFT', 'SP_DRAFT', 'COMBAT', 'RESULT']) {
      await page.click(`[data-phase="${phase}"]`);
      await page.waitForFunction((expected) => document.querySelector('#demo')?.contentWindow?.__MOCK__?.store.get().match.public.phase === expected, {}, phase);
    }
    await page.click('[data-image="round-chart.webp"]');
    assert.equal(await page.$eval('#gallery-caption', (element) => element.textContent), '回合统计');
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.deepEqual(failed, []);
  });
