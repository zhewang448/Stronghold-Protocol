import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('choosing an operator appearance opens framing and keeps the separate adjustment button', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, illustDir: null });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await server.close(); });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900 }); await page.goto(server.url);
  await page.waitForSelector('.title-login input'); await page.type('.title-login input', 'Choice frame');
  await page.evaluate(() => [...document.querySelectorAll('.title-login button')].find(button => button.textContent.includes('开始')).click());
  await page.waitForSelector('.lobby-screen');
  await page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
  const charId = 'char_113_cqbw';
  const openPicker = async () => {
    await page.waitForSelector('.rseat.is-me [aria-label="更换名片干员"]');
    await page.click('.rseat.is-me [aria-label="更换名片干员"]');
    await page.waitForSelector('.cardpick__search input');
    assert.ok(await page.$('[data-testid="operator-art-adjust"]'), 'the manual adjustment entry is retained');
  };
  for (const skinId of [charId + '#1', charId + '#2', charId + '@epoque#7', '']) {
    await openPicker(); await page.type('.cardpick__search input', 'W'); await page.click('.cardpick__op[title="W"]');
    await page.waitForSelector('.cardpick__grid--skins');
    await page.evaluate(async ({ charId, skinId }) => {
      const { data } = await import('/js/data.js');
      const { cardOperators } = await import('/js/ui/seatArt.js');
      const record = cardOperators(data.list('chess'), data.get('seat-art'), data.get('assets'), data.get('skins')).find(row => row.charId === charId);
      const index = skinId ? record.choices.findIndex(row => row.id === skinId) + 1 : 0;
      if (skinId && index === 0) throw new Error('Appearance absent from the picker');
      document.querySelectorAll('.cardpick__grid--skins button')[index].click();
    }, { charId, skinId });
    await page.waitForSelector('.operator-art-editor', { timeout: 5000 });
    assert.equal(await page.$('.cardpick'), null, 'the choice hands off directly to framing');
    assert.equal(await page.$eval('.operator-art-editor h3', element => element.textContent.trim()), 'W');
    await page.waitForFunction(async expected => (await import('/js/ui/seatArt.js')).cardStore.get().cardSkin === expected, {}, skinId);
    await page.click('[data-testid="operator-art-done"]');
    await page.waitForSelector('.operator-art-editor', { hidden: true });
    assert.equal(await page.$('.cardpick'), null, 'finishing the automatic editor returns to the room');
  }
  await openPicker(); await page.click('.cardpick__op--auto:not(.cardpick__op--custom)');
  await page.waitForSelector('.operator-art-editor'); await page.click('[data-testid="operator-art-done"]');
  await openPicker(); await page.click('[data-testid="operator-art-adjust"]'); await page.waitForSelector('.operator-art-editor');
  await page.click('[data-testid="operator-art-done"]'); await page.waitForSelector('.cardpick'); await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.room-screen');
  assert.equal(await page.$('.operator-art-editor'), null, 'restoring a saved choice does not open the editor');
  assert.deepEqual(errors, []);
});

test('room operator artwork supports persistent framing for static originals and animated outfits', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000,
}, async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, illustDir: null });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  t.after(async () => { await browser.close(); await server.close(); });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900 }); await page.goto(server.url);
  await page.waitForSelector('.title-login input'); await page.type('.title-login input', 'Frame doctor');
  await page.evaluate(() => [...document.querySelectorAll('.title-login button')].find(button => button.textContent.includes('开始')).click());
  await page.waitForSelector('.lobby-screen');
  await page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
  const charId = 'char_113_cqbw', normal = charId + '#1', elite = charId + '#2', outfit = charId + '@epoque#7';
  const select = async skin => {
    await page.evaluate(async (charId, skin) => (await import('/js/ui/seatArt.js')).setCard(charId, skin), charId, skin);
    await page.waitForFunction(skin => import('/js/store.js').then(({ store }) => store.get().room?.seats?.some(seat => seat?.cardSkin === skin)), {}, skin);
    await page.waitForSelector('.rseat.is-me img[data-art="operator"]');
  };
  const frame = skin => page.evaluate(async (charId, skin) => {
    const { cardArtKey, cardArtOf } = await import('/js/ui/cardArt.js'); return cardArtOf(cardArtKey(charId, skin));
  }, charId, skin);
  await select(normal);
  await page.$eval('.rseat.is-me', element => Promise.all(element.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  const drag = async () => {
    const box = await (await page.$('.rseat.is-me .rseat__art')).boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4); await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.46, { steps: 8 }); await page.mouse.up();
  };
  await drag();
  assert.equal(await page.$('.cardpick'), null, 'dragging ordinary artwork adjusts framing without opening the picker');
  const normalFrame = await frame(normal); assert.ok(normalFrame.ox > 0 && normalFrame.oy > 0);
  await page.mouse.wheel({ deltaY: -100 });
  await page.waitForFunction(async ({ charId, skin }) => {
    const { cardArtKey, cardArtOf } = await import('/js/ui/cardArt.js'); return cardArtOf(cardArtKey(charId, skin)).zoom > 1;
  }, {}, { charId, skin: normal });
  const saved = await frame(normal);
  await select(elite); await page.waitForSelector('.rseat.is-me .rseat__art .dyn-cover[data-state="ready"]');
  assert.deepEqual(await frame(elite), { zoom: 1, ox: 0, oy: 0 }, 'elite artwork has its own framing');
  await drag(); const eliteFrame = await frame(elite); assert.ok(eliteFrame.ox > 0);
  assert.equal(await page.$('.cardpick'), null, 'animated artwork accepts input while its static fallback is hidden');
  await select(outfit); await page.waitForSelector('.rseat.is-me .rseat__art .dyn-cover[data-state="ready"]');
  assert.deepEqual(await frame(outfit), { zoom: 1, ox: 0, oy: 0 }, 'outfit framing is independent');
  await page.click('.rseat.is-me [aria-label="更换名片干员"]');
  await page.click('[data-testid="operator-art-adjust"]'); await page.waitForSelector('.operator-art-editor');
  const slider = '[data-testid="operator-art-zoom"]';
  await page.$eval(slider, input => { input.value = '1.5'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('[data-testid="operator-art-x"]', input => { input.value = '20'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('[data-testid="operator-art-y"]', input => { input.value = '-15'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('[data-testid="operator-art-zoom"]')?.value === '1.5');
  assert.deepEqual(await frame(outfit), { zoom: 1.5, ox: 20, oy: -15 });
  const output = path.resolve('.impeccable/review/operator-framing'); fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'desktop.png') });
  await page.setViewport({ width: 844, height: 390 });
  assert.ok(await page.$eval('.operator-art-editor', element => {
    const rect = element.getBoundingClientRect(); return element.scrollWidth <= element.clientWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1;
  }));
  const touch = await page.createCDPSession();
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const box = await (await page.$('[data-testid="operator-art-frame"]')).boundingBox();
  const points = distance => [0, 1].map((id) => ({ id, x: box.x + box.width / 2 + (id ? distance : -distance), y: box.y + box.height / 2 }));
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(14) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(22) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok((await frame(outfit)).zoom > 1.5, 'two fingers zoom the animated preview');
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await touch.detach();
  await page.$eval(slider, input => { input.value = '1.5'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.screenshot({ path: path.join(output, 'mobile.png') });
  await page.click('[data-testid="operator-art-done"]'); await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.room-screen');
  assert.deepEqual(await frame(outfit), { zoom: 1.5, ox: 20, oy: -15 }, 'framing survives reload');
  await select(normal); assert.deepEqual(await frame(normal), saved);
  await select(elite); assert.deepEqual(await frame(elite), eliteFrame);
  await select(outfit); await page.click('.rseat.is-me [aria-label="更换名片干员"]');
  await page.click('[data-testid="operator-art-adjust"]'); await page.click('[data-testid="operator-art-reset"]');
  assert.deepEqual(await frame(outfit), { zoom: 1, ox: 0, oy: 0 });
  await page.focus('[data-testid="operator-art-frame"]'); await page.keyboard.press('ArrowRight');
  assert.equal((await frame(outfit)).ox, 2, 'the preview supports keyboard panning');
  assert.deepEqual(errors, []);
});
