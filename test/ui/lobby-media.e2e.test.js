import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

const ready = page => page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.hub-bg'));
const theme = (page, scene) => page.waitForSelector(`.hub-bg[data-scene="${scene}"]`);
async function openSettings(page) {
  await page.click('.hub-bg-btn');
  await page.waitForSelector('.bgset', { visible: true });
}
const openPicker = async page => {
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('.bgset__theme:last-child')]);
  await chooser.cancel();
};
const dispatchImage = (page, width, valid = true) => page.evaluate((width, valid) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = width;
  const context = canvas.getContext('2d');
  context.fillStyle = width === 4 ? 'red' : 'blue';
  context.fillRect(0, 0, width, width);
  const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([valid ? bytes : 'invalid'], `fixture-${width}.png`, { type: 'image/png' }));
  const input = document.querySelector('.bgset input[type=file]');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, width, valid);

// Check the same IndexedDB record used by profile backups, including after reloading.
const persistedWidth = async () => {
  const blob = await (await import('/js/ui/personalData.js')).readBackdrop();
  if (!blob) return null;
  const image = await createImageBitmap(blob);
  const width = image.width;
  image.close();
  return width;
};

async function client(t, viewport) {
  const previous = process.env.SP_TEST_MODE;
  process.env.SP_TEST_MODE = '1';
  t.after(() => { if (previous === undefined) delete process.env.SP_TEST_MODE; else process.env.SP_TEST_MODE = previous; });
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, studio: false });
  let browser;
  t.after(async () => { await browser?.close(); srv.server.closeAllConnections(); await srv.close(); });
  browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('sp.name', 'Backdrop QA');
    sessionStorage.setItem('sp.entered', '1');
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (this.width === 4 && this.height === 4 && type === 'image/jpeg') {
        globalThis.finishBackdropFixture = () => new Promise(resolve => encode.call(this, blob => { callback(blob); resolve(); }, type, quality));
      } else encode.call(this, callback, type, quality);
    };
    const open = IDBFactory.prototype.open;
    globalThis.backdropOpens = 0;
    IDBFactory.prototype.open = function (name, ...args) {
      if (name === 'sp-hub-backdrop') globalThis.backdropOpens++;
      return open.call(this, name, ...args);
    };
  });
  await page.goto(`${srv.url}?render=fallback`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await openSettings(page);
  return { page, errors };
}

const enabled = process.env.SP_E2E === '1' && hasChrome();
test('the recent background choice wins over a pending upload and stays selected after reload', { skip: !enabled, timeout: 60000 }, async t => {
  const { page, errors } = await client(t, { width: 1440, height: 900 });
  await openPicker(page);
  await dispatchImage(page, 4);
  await page.waitForFunction(() => typeof globalThis.finishBackdropFixture === 'function');
  // The Custom tile can open the picker again while the first picture is converting.
  await openPicker(page);
  await dispatchImage(page, 5);
  await theme(page, 'photo');
  assert.equal(await page.evaluate(persistedWidth), 5);
  const opens = await page.evaluate(() => globalThis.backdropOpens);
  await page.evaluate(() => globalThis.finishBackdropFixture());
  assert.equal(await page.evaluate(() => globalThis.backdropOpens), opens, 'an obsolete upload never reaches IndexedDB');
  assert.equal(await page.evaluate(persistedWidth), 5);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await theme(page, 'photo');
  assert.equal(await page.evaluate(persistedWidth), 5);
  assert.deepEqual(errors, []);
});

test('a preset change cancels a pending background, leaves the live settings usable on a phone, and rejects bad images', { skip: !enabled, timeout: 60000 }, async t => {
  const { page, errors } = await client(t, { width: 844, height: 390, hasTouch: true });
  await dispatchImage(page, 4);
  await page.waitForFunction(() => typeof globalThis.finishBackdropFixture === 'function');
  assert.notEqual(await page.$('.bgset [role="status"]'), null);
  await page.click('.bgset__theme:nth-child(2)');
  await theme(page, 'frost');
  const opens = await page.evaluate(() => globalThis.backdropOpens);
  await page.evaluate(() => globalThis.finishBackdropFixture());
  assert.equal(await page.evaluate(() => globalThis.backdropOpens), opens);
  assert.equal(await page.evaluate(persistedWidth), null);
  await dispatchImage(page, 8, false);
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(node => node.textContent.includes('背景读取失败')));
  await theme(page, 'frost');
  assert.equal(await page.evaluate(persistedWidth), null);
  await dispatchImage(page, 6);
  await theme(page, 'photo');
  assert.equal(await page.evaluate(persistedWidth), 6);
  await page.click('.bgset__custom .btn--ghost');
  await theme(page, 'night');
  assert.equal(await page.evaluate(persistedWidth), null);
  await page.click('.bgset__theme:nth-child(2)');
  await theme(page, 'frost');
  assert(await page.$eval('.bgset', node => node.scrollWidth <= node.clientWidth + 1));
  if (process.env.SP_LOBBY_FIX_QA) {
    await fs.mkdir(process.env.SP_LOBBY_FIX_QA, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SP_LOBBY_FIX_QA, 'lobby-settings-mobile.png') });
  }
  assert.deepEqual(errors, []);
});
