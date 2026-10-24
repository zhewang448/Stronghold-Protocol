// SP_E2E=1 CHROME_PATH=<chrome> node --test test/ui/asset-download.browser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('one primary download action automatically uses HTTP compatibility, retry, pause, cache reuse, and responsive entry', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async (t) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const image = '/assets/~1234567890abcdef/download-test.png';
  const missing = '/assets/download-test-missing.png';
  let fixed = false, hanging = false;
  const counts = new Map();
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
  // Keep synthetic responses on the actual HTTP server so browser caching stays enabled.
  const serve = srv.server.listeners('request')[0];
  srv.server.removeAllListeners('request');
  srv.server.on('request', (req, res) => {
    const url = req.url;
    if (url === '/data/assets.json' || url === '/data/local-assets.json' || url === '/data/local-fx.json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      // (local-fx.json: the host's official battle effects, DESIGN §33 — none in this fixture)
      res.end(JSON.stringify(url === '/data/assets.json' ? { files: [image, missing] } : { groups: {} }));
      return;
    }
    if (url === image || url === missing) {
      counts.set(url, (counts.get(url) || 0) + 1);
      if (hanging) return;
      const ok = url === image || fixed;
      res.writeHead(ok ? 200 : 404, { 'Content-Type': 'image/png', 'Cache-Control': ok ? 'public, max-age=3600' : 'no-store' });
      res.end(ok ? png : 'missing');
      return;
    }
    serve.call(srv.server, req, res);
  });
  t.after(() => srv.close());
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false }));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(srv.url);
  await page.waitForSelector('.title-preload .res-pill__head');
  assert.equal(await page.$('.title-assets'), null, 'the homepage has no duplicate asset actions');
  assert.equal(counts.size, 0, 'opening the homepage does not download the asset pack');
  if (process.env.SP_ASSET_SCREENSHOTS) {
    fs.mkdirSync(process.env.SP_ASSET_SCREENSHOTS, { recursive: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: path.join(process.env.SP_ASSET_SCREENSHOTS, 'title.png') });
  }
  await page.click('.title-preload .res-pill__head');
  await page.waitForSelector('[data-testid="resource-download"]');
  assert.equal(await page.$('[data-testid="asset-download"]'), null, 'there is no second download action');
  assert.equal(counts.size, 0, 'opening the manager never starts downloads');
  if (process.env.SP_ASSET_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SP_ASSET_SCREENSHOTS, 'manager.png') });
  await page.click('[data-testid="resource-download"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="asset-download-status"]')?.textContent.includes('1 个素材下载失败'));
  assert.equal(await page.$('.resource-modal'), null, 'opening a dedicated asset action closes the resource manager');
  assert.equal(await page.$eval('.asset-download [role="progressbar"]', (el) => el.getAttribute('aria-valuenow')), '1');
  assert.equal(counts.get(image), 1);
  fixed = true;
  await page.click('[data-testid="asset-download-resume"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="asset-download-status"]')?.textContent.includes('本次素材下载完成'));
  assert.equal(counts.get(image), 1, 'retry does not transfer a successful file again');
  assert.equal(await page.evaluate((url) => new Promise((resolve) => {
    const img = new Image(); img.onload = () => resolve(img.naturalWidth); img.onerror = () => resolve(0); img.src = url;
  }), image), 1);
  assert.equal(counts.get(image), 1, 'the renderer Image request reuses the downloaded HTTP cache');
  if (process.env.SP_ASSET_SCREENSHOTS) {
    fs.mkdirSync(process.env.SP_ASSET_SCREENSHOTS, { recursive: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: path.join(process.env.SP_ASSET_SCREENSHOTS, 'complete.png') });
  }
  await page.keyboard.press('Escape');
  // The single homepage resource entry remains inside the viewport and uncovered on desktop and landscape phone.
  for (const viewport of [{ width: 1280, height: 900 }, { width: 844, height: 390 }]) {
    await page.setViewport(viewport);
    const box = (sel) => page.$eval(sel, (el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom,
        visible: el.contains(document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2)) };
    });
    const entry = await box('.title-preload .res-pill__head');
    assert.ok(entry.left >= 0 && entry.right <= viewport.width && entry.top >= 0 && entry.bottom <= viewport.height, JSON.stringify(entry));
    assert.ok(entry.visible, 'the resource manager entry is not covered');
    assert.equal(await page.$('[data-testid="asset-download"]'), null, 'separate asset actions stay inside the manager');
    assert.equal(await page.$('[data-testid="asset-import"]'), null, 'separate asset actions stay inside the manager');
    if (process.env.SP_ASSET_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SP_ASSET_SCREENSHOTS, `title-${viewport.width}.png`) });
    await page.click('.title-preload .res-pill__head');
    await page.waitForSelector('[data-testid="asset-import"]');
    await page.$eval('[data-testid="asset-import"]', (el) => el.scrollIntoView({ block: 'center' }));
    const importer = await box('[data-testid="asset-import"]');
    assert.ok(importer.visible && importer.left >= 0 && importer.right <= viewport.width, 'the local import action remains reachable');
    if (process.env.SP_ASSET_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SP_ASSET_SCREENSHOTS, `manager-${viewport.width}.png`) });
    await page.keyboard.press('Escape');
  }
  // A new browser context has an empty HTTP cache. Closing the dialog must stop a hanging request.
  const context = await browser.createBrowserContext();
  const other = await context.newPage();
  await other.evaluateOnNewDocument(() => Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false }));
  hanging = true;
  await other.goto(srv.url);
  await other.click('.title-preload .res-pill__head');
  await other.click('[data-testid="resource-download"]');
  await other.waitForFunction(async () => (await import('/js/assetDownload.js')).assetDownload.get().phase === 'downloading');
  await other.keyboard.press('Escape');
  await other.waitForFunction(async () => (await import('/js/assetDownload.js')).assetDownload.get().phase === 'paused');
  hanging = false;
  await other.click('.title-preload .res-pill__head');
  await other.click('[data-testid="resource-download"]');
  await other.waitForFunction(() => document.querySelector('[data-testid="asset-download-status"]')?.textContent.includes('本次素材下载完成'));
  assert.deepEqual(errors, []);
});
