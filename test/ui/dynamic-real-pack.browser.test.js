import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, hasChrome, waitForFunctionLong } from '../e2e/client.mjs';
import { startServer } from '../../server/index.js';
const pack = process.env.SP_REAL_ASSET_PACK;

test('generated real asset ZIP imports through the UI and replays a dynamic illustration with resource requests blocked',
  { skip: process.env.SP_E2E !== '1' || !hasChrome() || !pack || !fs.existsSync(pack), timeout: 600000 }, async t => {
    const output = path.resolve('.cache/dynamic-illustrations-new-operators/followup/asset-pack-import'); fs.mkdirSync(output, { recursive: true });
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    await srv.assetIndex.whenReady();
    const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--edge-skip-compat-layer-relaunch'] });
    t.after(async () => { await browser.close(); await srv.close(); });
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900 }); await page.goto(srv.url);
    await page.waitForSelector('.title-preload .res-pill__head'); await page.click('.title-preload .res-pill__head');
    await page.waitForSelector('[data-testid="asset-import"]'); await page.click('[data-testid="asset-import"]');
    const file = await page.waitForSelector('[data-testid="asset-import-zip-input"]'); await file.uploadFile(pack);
    const started = Date.now();
    await waitForFunctionLong(page, async () => ['complete', 'partial', 'empty', 'error'].includes((await import('/js/assetPack.js')).assetImport.get().phase), { timeout: 550000, slice: 30000 });
    const result = await page.evaluate(async () => (await import('/js/assetPack.js')).assetImport.get());
    fs.writeFileSync(path.join(output, 'import-result.json'), JSON.stringify({ pack, bytes: fs.statSync(pack).size, ms: Date.now() - started, result }, null, 2));
    assert.equal(result.phase, 'complete', JSON.stringify(result)); assert.ok(result.accepted > 40000);
    await page.screenshot({ path: path.join(output, 'complete.png') });
    await page.waitForFunction(() => navigator.serviceWorker.controller != null);
    await page.evaluate(async () => {
      const manifest = await (await fetch('/data/assets.json')).json();
      const art = manifest.chars.char_472_pasngr.skins['char_472_pasngr@epoque#17'];
      const [{ h, render }, { DynamicIllustration }] = await Promise.all([import('/vendor/preact.module.js'), import('/js/ui/dynamicIllustration.js')]);
      const host = document.createElement('div'); host.id = 'offline-preview'; Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: 99999, background: '#17201c' }); document.body.appendChild(host);
      window.showOfflineArt = () => render(h(DynamicIllustration, { entry: art.dynamic, staticSrc: art.illust, name: 'Offline Passenger' }), host);
      window.closeOfflineArt = () => { render(null, host); host.remove(); };
    });
    await page.setRequestInterception(true); page.on('request', request => /^\/(?:assets|media|fonts)\//.test(new URL(request.url()).pathname) ? request.abort() : request.continue());
    await page.evaluate(() => window.showOfflineArt());
    await page.waitForSelector('.dyn-cover[data-state="ready"]');
    await page.screenshot({ path: path.join(output, 'offline-dynamic.png') }); await page.evaluate(() => window.closeOfflineArt());
    fs.writeFileSync(path.join(output, 'offline-result.json'), JSON.stringify({ imported: result.accepted, resourceNetworkBlocked: true, dynamicReady: true, errors }, null, 2));
    assert.deepEqual(errors, []);
  });
