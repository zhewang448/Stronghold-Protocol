// SP_E2E=1 CHROME_PATH=<Chrome> node --test test/ui/cursor.e2e.test.js
// Native pointer styles, real game drags and accessibility fallback. Synthetic
// cursor art keeps this suite independent of the optional third-party download.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { crc32 } from '../../server/plugins/zip.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.SP_E2E === '1' && existsSync(CHROME);
function syntheticPng(size) {
  const chunk = (type, bytes) => {
    const out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); out.write(type, 4); bytes.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, -4)) >>> 0, out.length - 4); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const stride = size * 4 + 1, pixels = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) for (let x = 0; x <= y / 2; x++) pixels.fill(255, y * stride + 1 + x * 4, y * stride + 5 + x * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

describe('native Arknights cursor', { skip: !enabled && 'set SP_E2E=1 with Chrome' }, () => {
  let srv, browser, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
    base = `http://127.0.0.1:${srv.port}`;
    const puppeteer = (await import('puppeteer-core')).default;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  });
  after(async () => { await browser?.close(); await srv?.close(); });
  async function pageFor({ missing = false, touch = false, missingSizes = [], delays = {} } = {}) {
    const page = await (await browser.createBrowserContext()).newPage();
    await page.setViewport({ width: 1440, height: 900, hasTouch: touch, isMobile: touch });
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (!req.url().includes('/assets/cursor/')) { req.continue(); return; }
      const size = Number(/\/(\d+)\/[^/]+\.png$/.exec(req.url())?.[1]) || 32;
      const respond = () => req.respond(missing || missingSizes.includes(size) ? { status: 404, body: '' }
        : { status: 200, contentType: 'image/png', body: syntheticPng(size) });
      if (delays[size]) setTimeout(respond, delays[size]); else respond();
    });
    await page.goto(`${base}/dev/game-mock.html?phase=PREP&render=fallback&shot=1`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.ff-piece.is-draggable');
    return page;
  }
  async function choose(page, theme) {
    await page.evaluate(async theme => { const { updateSettings } = await import('/js/ui/settings.js'); updateSettings({ cursorTheme: theme }); }, theme);
    if (theme === 'arknights') await page.waitForFunction(async () => (await import('/js/ui/cursor.js')).cursorState.get().status !== 'loading');
  }
  const cursor = (page, selector) => page.$eval(selector, el => getComputedStyle(el).cursor);
  test('96 px default, live size slider, proportional hotspots, persistence and host lock', async () => {
    const page = await pageFor();
    try {
      await choose(page, 'arknights');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.cursorSize), '96');
      assert.match(await cursor(page, 'body'), /\/96\/normal\.png.*28 20/);
      await page.click('[data-testid="settings-btn"]'); await page.waitForSelector('[data-testid="cursor-size"]');
      assert.equal(await page.$eval('[data-testid="cursor-size"]', el => el.value), '96');
      await page.focus('[data-testid="cursor-size"]'); await page.keyboard.press('End');
      await page.waitForFunction(() => document.documentElement.dataset.cursorSize === '128');
      assert.match(await cursor(page, 'body'), /\/128\/normal\.png.*37 27/);
      assert.ok(Math.abs((await page.$eval('[data-testid="cursor-size-preview"]', el => el.getBoundingClientRect().width)) - 128) < 0.5);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).cursorSize), 128);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForFunction(() => document.documentElement.dataset.cursorSize === '128');
      await page.click('[data-testid="settings-btn"]'); await page.focus('[data-testid="cursor-size"]'); await page.keyboard.press('Home');
      await page.waitForFunction(() => document.documentElement.dataset.cursorSize === '32');
      assert.match(await cursor(page, 'body'), /\/32\/normal\.png.*9 7/);
      await page.evaluate(async () => (await import('/js/clientPreferences.js')).setClientPreferencePolicy({ defaults: { 'settings.cursorSize': 64 }, userControls: { 'settings.cursorSize': false } }));
      await page.waitForFunction(() => document.documentElement.dataset.cursorSize === '64');
      assert.equal(await page.$eval('[data-testid="cursor-size"]', el => el.matches(':disabled')), true);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).cursorSize), 32);
      await page.evaluate(async () => (await import('/js/clientPreferences.js')).setClientPreferencePolicy(null));
      await page.waitForFunction(() => document.documentElement.dataset.cursorSize === '32');
    } finally { await page.close(); }
  });
  test('size loads stay atomic during dragging, stale completion cannot override latest size, missing size falls back', async () => {
    const page = await pageFor({ delays: { 112: 180, 128: 400 }, missingSizes: [80] });
    try {
      await choose(page, 'arknights');
      await page.evaluate(async () => {
        (await import('/js/ui/cursor.js')).setCursorDragging(true);
        (await import('/js/ui/settings.js')).updateSettings({ cursorSize: 128 });
        (await import('/js/ui/settings.js')).updateSettings({ cursorSize: 112 });
      });
      assert.equal(await page.evaluate(() => document.documentElement.dataset.cursorSize), '96');
      assert.match(await cursor(page, 'body'), /\/96\/grabbing\.png/);
      await page.waitForFunction(() => document.documentElement.dataset.cursorSize === '112');
      await page.waitForNetworkIdle();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.cursorSize), '112');
      assert.match(await cursor(page, 'body'), /\/112\/grabbing\.png.*33 79/);
      await page.evaluate(async () => {
        (await import('/js/ui/cursor.js')).setCursorDragging(false);
        (await import('/js/ui/settings.js')).updateSettings({ cursorSize: 80 });
      });
      await page.waitForFunction(async () => (await import('/js/ui/cursor.js')).cursorState.get().status === 'unavailable');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.cursorTheme), undefined);
      assert.equal(await cursor(page, '.ff-piece.is-draggable'), 'grab');
    } finally { await page.close(); }
  });
  test('opt-in, real settings controls, preserved text/disabled feedback, press reset and persisted choice', async () => {
    const page = await pageFor();
    try {
      assert.equal(await page.evaluate(() => document.documentElement.dataset.cursorTheme), undefined);
      assert.equal(await cursor(page, '.ff-piece.is-draggable'), 'grab');
      await page.click('[data-testid="settings-btn"]'); await page.waitForSelector('[data-testid="cursor-theme"]');
      const radios = await page.$$('[data-testid="cursor-theme"] [role="radio"]');
      assert.equal(await radios[0].evaluate(el => el.getAttribute('aria-checked')), 'true');
      await radios[1].click(); await page.waitForFunction(() => document.documentElement.dataset.cursorTheme === 'arknights');
      assert.match(await cursor(page, '[data-testid="cursor-theme"] button'), /pointer\.png.*pointer$/);
      const button = await radios[0].boundingBox();
      await page.mouse.move(button.x + 5, button.y + 5); await page.mouse.down();
      assert.match(await cursor(page, '[data-testid="cursor-theme"] button'), /pointer-pressed\.png/);
      await page.mouse.up(); await page.waitForFunction(() => !document.documentElement.dataset.cursorPressed);
      await choose(page, 'arknights');
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        const input = document.createElement('input'); input.id = 'cursor-input'; document.body.append(input);
        const button = document.createElement('button'); button.disabled = true; button.id = 'cursor-disabled'; document.body.append(button);
      });
      assert.match(await cursor(page, '#cursor-input'), /text\.png.*text$/);
      assert.match(await cursor(page, '#cursor-disabled'), /disabled\.png.*not-allowed$/);
      await page.mouse.move(700, 350); await page.mouse.down();
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.equal(await page.evaluate(() => document.documentElement.dataset.cursorPressed), undefined);
      await page.mouse.up();
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForFunction(() => document.documentElement.dataset.cursorTheme === 'arknights');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).cursorTheme), 'arknights');
      assert.equal(await page.$('#cursor-outer, .sp-cursor-overlay'), null);
      await choose(page, 'system');
      assert.equal(await cursor(page, '.ff-piece.is-draggable'), 'grab');
    } finally { await page.close(); }
  });
  test('accepted operator drag changes globally to claw, release/cancel restores hover cursor', async () => {
    const page = await pageFor();
    try {
      await choose(page, 'arknights');
      assert.match(await cursor(page, '.ff-piece.is-draggable'), /\/96\/grab\.png.*28 68/);
      const piece = await page.$('.ff-piece.is-draggable'), box = await piece.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 4 });
      await page.waitForFunction(() => !!document.documentElement.dataset.cursorDragging);
      assert.match(await cursor(page, 'body'), /\/96\/grabbing\.png.*28 68, grabbing$/);
      await page.mouse.up(); await page.waitForFunction(() => !document.documentElement.dataset.cursorDragging);
      assert.match(await cursor(page, '.ff-piece.is-draggable'), /grab\.png.*grab$/);
      await page.evaluate(() => {
        document.documentElement.dataset.cursorDragging = 'true';
        window.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'mouse' }));
      });
      assert.equal(await page.evaluate(() => document.documentElement.dataset.cursorDragging), undefined);
    } finally { await page.close(); }
  });
  test('missing art, touch, high contrast and reduced motion keep a usable cursor', async () => {
    const page = await pageFor({ missing: true });
    try {
      await choose(page, 'arknights');
      assert.equal(await cursor(page, '.ff-piece.is-draggable'), 'grab');
      await page.click('[data-testid="settings-btn"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="cursor-status"]')?.textContent.includes('尚未提供'));
    } finally { await page.close(); }
    const mouse = await pageFor();
    try {
      await choose(mouse, 'arknights');
      await mouse.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await mouse.mouse.move(700, 350); await mouse.mouse.down();
      assert.equal(await mouse.evaluate(() => document.documentElement.dataset.cursorPressed), undefined);
      await mouse.mouse.up();
      await mouse.evaluate(() => {
        document.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', button: 0, bubbles: true }));
      });
      assert.equal(await mouse.evaluate(() => document.documentElement.dataset.cursorTheme), undefined);
      await mouse.mouse.move(701, 350);
      assert.equal(await mouse.evaluate(() => document.documentElement.dataset.cursorTheme), 'arknights');
      const cdp = await mouse.createCDPSession();
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
      await mouse.waitForFunction(() => !document.documentElement.dataset.cursorTheme);
      assert.equal(await cursor(mouse, '.ff-piece.is-draggable'), 'grab');
    } finally { await mouse.close(); }
    const touch = await pageFor({ touch: true });
    try {
      await choose(touch, 'arknights');
      assert.equal(await touch.evaluate(() => document.documentElement.dataset.cursorTheme), undefined);
    } finally { await touch.close(); }
  });
});
