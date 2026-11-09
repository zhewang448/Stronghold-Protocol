import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('room artwork framing follows its owner across browsers, dynamic/static looks, custom images and reconnect', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 180000,
}, async t => {
  const out = path.resolve('.cache/transactions/upstream-battle-ai-room-art/ui');
  fs.mkdirSync(out, { recursive: true });
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false,
    versions: { default: 'act2autochess' } });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--edge-skip-compat-layer-relaunch', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  t.after(async () => { await browser.close(); await server.close(); });
  const errors = [];
  const login = async name => {
    const page = await (await browser.createBrowserContext()).newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(server.url);
    await page.waitForSelector('.title-login input');
    await page.type('.title-login input', name);
    await page.evaluate(() => [...document.querySelectorAll('.title-login button')].find(button => button.textContent.includes('开始')).click());
    await page.waitForSelector('.lobby-screen');
    return page;
  };
  const host = await login('Frame host'), guest = await login('Frame guest');
  await host.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
  const room = [...server.lobby.rooms.values()][0];
  await guest.evaluate(code => globalThis.__SP__.net.request('room.join', { code }), room.code);
  const charId = 'char_113_cqbw', skinId = 'char_113_cqbw#2', key = charId + ':' + skinId;
  for (const page of [host, guest]) {
    await page.evaluate(async (charId, skinId) => (await import('/js/ui/seatArt.js')).setCard(charId, skinId), charId, skinId);
  }
  await guest.evaluate(async key => {
    const art = await import('/js/ui/cardArt.js');
    art.setCardArt(key, { zoom: 0.6, ox: -12, oy: 8 });
    art.setCardArt('custom', { zoom: 0.7, ox: -70, oy: 60 });
  }, key);
  const own = '.rseat.is-me .rseat__art';
  const peer = '.rseat:not(.is-me) .rseat__art';
  await host.waitForSelector(own + ' .dyn-cover[data-state="ready"]');
  await guest.waitForSelector(peer + ' .dyn-cover[data-state="ready"]');
  await host.click('.rseat.is-me .rseat__pick');
  await host.click('[data-testid="operator-art-adjust"]');
  const setSlider = async (selector, value) => {
    await host.$eval(selector, (input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  };
  await setSlider('[data-testid="operator-art-zoom"]', 1.7);
  await setSlider('[data-testid="operator-art-x"]', 23);
  await setSlider('[data-testid="operator-art-y"]', -19);
  await host.click('[data-testid="operator-art-done"]');
  await host.keyboard.press('Escape');
  const transform = (page, selector) => page.$eval(selector + ' img.cardart__still', image => image.style.transform);
  await host.waitForFunction(selector => document.querySelector(selector + ' img.cardart__still')?.style.transform.includes('1.7'), {}, own);
  const expected = await transform(host, own);
  await guest.waitForFunction((selector, expected) => document.querySelector(selector + ' img.cardart__still')?.style.transform === expected, {}, peer, expected);
  assert.notEqual(await transform(guest, own), expected, 'the viewer keeps its independent framing of the same outfit');
  assert.deepEqual(room.seats.filter(Boolean).find(seat => seat.name === 'Frame host').cardArt.frame, { zoom: 1.7, ox: 23, oy: -19 });
  await host.screenshot({ path: path.join(out, 'dynamic-host-desktop.png') });
  await guest.screenshot({ path: path.join(out, 'dynamic-peer-desktop.png') });

  for (const page of [host, guest]) {
    await page.evaluate(async () => (await import('/js/ui/settingsStore.js')).settingsStore.set({ dynamicIllustrations: 'static' }));
  }
  await guest.waitForFunction(selector => document.querySelector(selector + ' .dyn-cover')?.dataset.state === 'static', {}, peer);
  assert.equal(await transform(guest, peer), expected);
  await guest.screenshot({ path: path.join(out, 'static-peer-desktop.png') });
  await guest.reload();
  await guest.waitForSelector('.room-screen');
  await guest.waitForFunction((selector, expected) => document.querySelector(selector + ' img.cardart__still')?.style.transform === expected, {}, peer, expected);
  await guest.waitForFunction(() => !document.getElementById('boot'));
  await guest.setViewport({ width: 640, height: 360, hasTouch: true });
  await guest.waitForSelector(peer + ' img.cardart__still');
  await guest.waitForFunction((selector, expected) => document.querySelector(selector + ' img.cardart__still')?.style.transform === expected, {}, peer, expected);
  await guest.screenshot({ path: path.join(out, 'peer-mobile.png') });
  assert.equal(await transform(guest, peer), expected);

  await host.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 480;
    const paint = canvas.getContext('2d');
    paint.fillStyle = '#244a74'; paint.fillRect(0, 0, 240, 480);
    paint.fillStyle = '#ffd36b'; paint.fillRect(60, 80, 120, 280);
    paint.fillStyle = '#eb6558'; paint.fillRect(0, 0, 240, 35);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await (await import('/js/ui/customIllust.js')).uploadOwnIllust(blob);
  });
  await host.waitForSelector(own + ' img[data-art="custom"]');
  await guest.waitForSelector(peer + ' img[data-art="custom"]');
  await host.click('.rseat.is-me .rseat__pick');
  await host.click('[data-testid="custom-illust-entry"]');
  await host.waitForSelector('[data-testid="card-art-frame"]');
  await setSlider('[data-testid="card-art-zoom"]', 1.4);
  const box = await (await host.$('[data-testid="card-art-frame"]')).boundingBox();
  await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.mouse.down();
  await host.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 12, { steps: 4 });
  await host.mouse.up();
  await host.click('[data-testid="illust-done"]');
  await host.keyboard.press('Escape');
  const custom = await transform(host, own);
  await guest.waitForFunction((selector, expected) => document.querySelector(selector + ' img[data-art="custom"]')?.style.transform === expected, {}, peer, custom);
  assert.equal(await host.$(own + ' .dyn-cover'), null);
  await host.screenshot({ path: path.join(out, 'custom-host-desktop.png') });
  await guest.screenshot({ path: path.join(out, 'custom-peer-mobile.png') });
  const frame = await host.evaluate(async () => (await import('/js/ui/cardArt.js')).cardArtOf('custom'));
  assert.ok(frame.zoom > 1 && frame.ox > 0 && frame.oy < 0, JSON.stringify(frame));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ operator: { key, frame: { zoom: 1.7, ox: 23, oy: -19 }, transform: expected },
    custom: { frame, transform: custom }, reconnect: true, peerViewport: { width: 640, height: 360 }, errors }, null, 2));
  assert.deepEqual(errors, []);
});
