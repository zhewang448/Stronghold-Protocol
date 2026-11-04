import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('barrage sends selected bursts and settings fit short landscape screens', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await server.close(); });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(server.url + '/dev/game-mock.html?shot=1&render=fallback&phase=PREP', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gm__ping-btn--barrage-settings');
  await page.click('.gm__ping-btn--barrage-settings');
  await page.click('.gbar__emote[data-emote="custom_battle_kaguya_cheer"]');
  await page.evaluate(() => {
    const button = document.querySelector('.gm__ping-btn--barrage'); button.click(); button.click(); button.click();
  });
  await page.waitForFunction(() => globalThis.__MOCK__.store.get().emotes.at(-1)?.count === 3);
  assert.equal(await page.evaluate(() => globalThis.__MOCK__.store.get().emotes.at(-1).id), 'custom_battle_kaguya_cheer');
  await page.click('.gbar__x');
  for (const [width, height] of [[844, 390], [640, 360]]) {
    await page.setViewport({ width, height, isMobile: true, hasTouch: true, isLandscape: true });
    await page.click('.gm__ping-btn--barrage-settings');
    await page.waitForSelector('.gbar__panel');
    const fits = await page.$eval('.gbar__panel', panel => { const r = panel.getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
    assert.equal(fits, true, `${width}×${height}: the whole settings panel stays visible`);
    await page.click('.gbar__x');
  }
  await page.evaluate(() => globalThis.__MOCK__.store.set({ emoteBarrage: false }));
  await page.waitForFunction(() => !document.querySelector('.gm__ping-btn--barrage, [data-watch-rain]'));
  assert.equal(await page.$$eval('.gm__ping-btn--question, .gm__ping-btn--heart', elements => elements.length), 2);
  assert.deepEqual(errors, []);
});
