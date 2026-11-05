import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('elite original and newly installed limited outfits animate in a real room and respect ordinary, static and custom artwork', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000,
}, async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  t.after(async () => { await browser.close(); await server.close(); });
  const login = async name => {
    const page = await (await browser.createBrowserContext()).newPage();
    await page.setViewport({ width: 1440, height: 900 }); await page.goto(server.url);
    await page.waitForSelector('.title-login input'); await page.type('.title-login input', name);
    await page.evaluate(() => [...document.querySelectorAll('.title-login button')].find(button => button.textContent.includes('开始')).click());
    await page.waitForSelector('.lobby-screen'); return page;
  };
  const host = await login('Dynamic host'), guest = await login('Dynamic guest');
  await host.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
  const room = [...server.lobby.rooms.values()][0];
  await guest.evaluate(code => globalThis.__SP__.net.request('room.join', { code }), room.code);
  const select = (charId, skinId) => host.evaluate(async (charId, skinId) => (await import('/js/ui/seatArt.js')).setCard(charId, skinId), charId, skinId);
  const ready = async (page, own) => {
    const selector = (own ? '.rseat.is-me' : '.rseat:not(.is-me)') + ' .rseat__art .dyn-cover[data-state="ready"]';
    await page.waitForSelector(selector);
    const sample = () => page.$eval(selector + ' canvas', canvas => {
      const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261; for (let i = 0; i < bytes.length; i += 17) hash = Math.imul(hash ^ bytes[i], 16777619);
      return hash >>> 0;
    });
    const before = await sample();
    await page.waitForFunction(async (selector, before) => {
      const canvas = document.querySelector(selector + ' canvas');
      const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261; for (let i = 0; i < bytes.length; i += 17) hash = Math.imul(hash ^ bytes[i], 16777619);
      return (hash >>> 0) !== before;
    }, {}, selector, before);
  };
  await select('char_113_cqbw', 'char_113_cqbw#2'); await ready(host, true); await ready(guest, false);
  await host.waitForSelector('.rseat.is-me .avatar .dyn-cover[data-state="ready"]');
  await select('char_113_cqbw', 'char_113_cqbw#1');
  await host.waitForFunction(() => !document.querySelector('.rseat.is-me .rseat__art .dyn-cover'));
  await guest.waitForFunction(() => !document.querySelector('.rseat:not(.is-me) .rseat__art .dyn-cover'));
  await select('char_113_cqbw', 'char_113_cqbw@epoque#7'); await ready(host, true); await ready(guest, false);
  await host.evaluate(async () => (await import('/js/ui/settingsStore.js')).settingsStore.set({ dynamicIllustrations: 'static' }));
  await host.waitForFunction(() => document.querySelector('.rseat.is-me .rseat__art .dyn-cover')?.dataset.state === 'static');
  await host.evaluate(async () => (await import('/js/ui/settingsStore.js')).settingsStore.set({ dynamicIllustrations: 'auto' })); await ready(host, true);
  await host.evaluate(async () => {
    const { uploadOwnIllust } = await import('/js/ui/customIllust.js');
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 256;
    canvas.getContext('2d').fillRect(0, 0, 128, 256);
    await uploadOwnIllust(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
  });
  await host.waitForSelector('.rseat.is-me img[data-art="custom"]');
  assert.equal(await host.$('.rseat.is-me .rseat__art .dyn-cover'), null);
});
