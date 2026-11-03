import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { resetHostSettings } from '../../server/match/hostSettings.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('room unite layers: host switches, guest sees the room rule on desktop and touch layouts', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000,
}, async t => {
  resetHostSettings();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-unite-permission-'));
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, studio: false });
  const admin = await startAdmin({ lobby: srv.lobby, port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  mkdirSync('.cache/room-unite-layers', { recursive: true });
  try {
    const consolePage = await browser.newPage();
    await consolePage.setViewport({ width: 1440, height: 900 });
    await consolePage.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await consolePage.click('[data-tab="settings"]');
    await consolePage.waitForSelector('#unite-layers-host-control');
    assert.equal(await consolePage.$eval('#unite-layers-host-control', e => e.checked), false);
    for (const [width, height, touch] of [[1280, 720, false], [844, 390, true], [640, 360, true]]) {
      await t.test(`${width}x${height}`, async () => {
        const contexts = [], errors = [];
        const pageIn = async name => {
          const context = await browser.createBrowserContext();
          contexts.push(context);
          const page = await context.newPage();
          page.setDefaultTimeout(60000);
          await page.setRequestInterception(true);
          page.on('request', request => request.resourceType() === 'media' ? request.abort() : request.continue());
          page.on('pageerror', e => errors.push(e.message));
          await page.setViewport({ width, height, hasTouch: touch, isMobile: touch });
          await page.evaluateOnNewDocument(name => { localStorage.setItem('sp.name', name); sessionStorage.setItem('sp.entered', '1'); }, name);
          await page.goto(srv.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online');
          return page;
        };
        try {
          const host = await pageIn('Host');
          await host.evaluate(async () => (await import('/js/net.js')).net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
          await host.waitForSelector('.rs-pill__gear');
          const code = await host.evaluate(() => globalThis.__SP__.store.get().room.code);
          const guest = await pageIn('Guest');
          await guest.evaluate(async code => (await import('/js/net.js')).net.request('room.join', { code }), code);
          await guest.waitForSelector('.rs-pill__gear');
          const press = (page, selector) => touch ? page.tap(selector) : page.click(selector);
          await press(host, '.rs-pill__gear');
          await press(guest, '.rs-pill__gear');
          const input = '[name="unite-layer-gains"]';
          await host.waitForSelector(input);
          await guest.waitForSelector(input);
          assert.equal(await guest.$eval(input, e => e.disabled), true);
          assert.equal(await host.$eval(input, e => e.disabled), true, 'permission defaults off');
          await consolePage.click('#unite-layers-host-control');
          await consolePage.click('[data-room-creation-save]');
          await host.waitForFunction(() => !document.querySelector('[name="unite-layer-gains"]').disabled);
          assert.equal(await host.$eval(input, e => e.checked), false);
          await press(host, input);
          await guest.waitForFunction(() => document.querySelector('[name="unite-layer-gains"]').checked);
          await host.waitForFunction(() => !document.querySelector('[name="unite-layer-gains"]').disabled);
          assert.equal(srv.lobby.rooms.get(code).uniteLayerGains, true);
          const geometry = await host.$eval(input, e => {
            const r = e.closest('.rs-opts').getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight };
          });
          assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.top >= 0 && geometry.bottom <= geometry.height, JSON.stringify(geometry));
          await host.screenshot({ path: `.cache/room-unite-layers/${width}x${height}.png` });
          await press(host, input);
          await guest.waitForFunction(() => !document.querySelector('[name="unite-layer-gains"]').checked);
          assert.equal(srv.lobby.rooms.get(code).uniteLayerGains, false);
          await consolePage.click('#unite-layers-host-control');
          await consolePage.click('[data-room-creation-save]');
          await host.waitForFunction(() => document.querySelector('[name="unite-layer-gains"]').disabled);
          const denied = await host.evaluate(async () => {
            try { await (await import('/js/net.js')).net.request('room.setUniteLayerGains', { on: true }); return null; }
            catch (e) { return e.code; }
          });
          assert.equal(denied, 'UNITE_LAYERS_LOCKED');
          assert.deepEqual(errors, []);
        } finally { await Promise.all(contexts.map(c => c.close())); }
      });
    }
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await consolePage.setViewport({ width, height });
      assert.ok(await consolePage.$eval('#room-defaults-settings', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && e.scrollWidth <= e.clientWidth; }));
      await consolePage.$eval('[data-room-config-row="uniteLayerGains"]', e => e.scrollIntoView());
      await consolePage.screenshot({ path: `.cache/room-unite-layers/permission-console-${width}.png` });
    }
  } finally {
    await browser.close();
    await admin.close();
    srv.server.closeAllConnections();
    await srv.close();
    resetHostSettings();
    rmSync(dir, { recursive: true, force: true });
  }
});
