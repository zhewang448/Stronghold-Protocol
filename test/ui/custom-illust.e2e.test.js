import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { png } from '../helpers/pluginFixtures.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('PR24 custom illustration compresses, shares, frames, disables, restores and removes on two real clients', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000,
}, async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-illust-ui-'));
  const file = path.join(directory, 'large.png'); fs.writeFileSync(file, png(4000, 6000, [40, 150, 90, 255]));
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, illustDir: path.join(directory, 'server'), heavyBurst: 100 });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  testContext.after(async () => { await browser.close(); await server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const errors = [];
  const login = async name => {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message)); await page.setViewport({ width: 1440, height: 900 });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.title-login input');
    await page.type('.title-login input', name);
    await page.evaluate(() => [...document.querySelectorAll('.title-login button')].find(button => button.textContent.includes('开始')).click());
    await page.waitForSelector('.lobby-screen'); return page;
  };
  const host = await login('Illust host'), guest = await login('Illust guest');
  const patterned = await host.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 4000; canvas.height = 6000;
    const context = canvas.getContext('2d');
    for (const [left, width, color] of [[0, 1500, '#ee2020'], [1500, 1000, '#20dd20'], [2500, 1500, '#2020ee']]) {
      context.fillStyle = color; context.fillRect(left, 0, width, 6000);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  fs.writeFileSync(file, Buffer.from(patterned, 'base64'));
  await host.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
  const room = [...server.lobby.rooms.values()][0];
  await guest.evaluate(code => globalThis.__SP__.net.request('room.join', { code }), room.code);
  const openPicker = async () => {
    await host.bringToFront(); await host.click('.rseat.is-me [aria-label="更换名片干员"]');
    await host.waitForSelector('[data-testid="custom-illust-entry"]');
  };
  await openPicker();
  assert.equal(await host.$eval('.cardpick__grid > button:first-child', button => button.dataset.testid), 'custom-illust-entry');
  assert.equal(await host.$$eval('[data-testid="custom-illust-entry"] .cardpick__img img', images => images.length), 0);
  const entryIcon = await host.$eval('[data-testid="custom-illust-entry"] .icon', element => {
    const slot = element.parentElement, auto = slot.closest('.cardpick__grid').querySelector('.cardpick__op--auto:not(.cardpick__op--custom) .cardpick__img');
    return { ratio: element.getBoundingClientRect().width / slot.getBoundingClientRect().width,
      color: getComputedStyle(element).color, referenceColor: getComputedStyle(auto).color, background: getComputedStyle(slot).backgroundColor, referenceBackground: getComputedStyle(auto).backgroundColor };
  });
  assert.ok(entryIcon.ratio > 0.4 && entryIcon.ratio < 0.5);
  assert.equal(entryIcon.color, entryIcon.referenceColor); assert.equal(entryIcon.background, entryIcon.referenceBackground);
  fs.mkdirSync('test/e2e/out', { recursive: true });
  await host.screenshot({ path: 'test/e2e/out/pr24-entry-icon-empty.png' });
  await host.click('[data-testid="custom-illust-entry"]');
  const chooser = host.waitForFileChooser(); await host.click('[data-testid="illust-choose"]');
  await (await chooser).accept([file]);
  await host.waitForSelector('[data-testid="illust-crop"]', { timeout: 3000 });
  await host.waitForFunction(() => !document.querySelector('[data-testid="illust-confirm"]').disabled);
  assert.match(await host.$eval('.illust-picker', element => element.textContent), /768 × 1536/);
  const crop = await (await host.$('[data-testid="illust-crop"]')).boundingBox();
  const importSlider = await (await host.$('[data-testid="illust-crop-zoom"]')).boundingBox();
  const originalWidth = await host.$eval('[data-testid="illust-crop"] img', image => image.getBoundingClientRect().width);
  await host.mouse.click(importSlider.x + importSlider.width / 2, importSlider.y + importSlider.height / 2);
  await host.waitForFunction(width => document.querySelector('[data-testid="illust-crop"] img').getBoundingClientRect().width > width * 1.5, {}, originalWidth);
  await host.mouse.move(crop.x + crop.width / 2, crop.y + crop.height / 2); await host.mouse.down();
  await host.mouse.move(crop.x + crop.width * 1.1, crop.y + crop.height / 2, { steps: 8 }); await host.mouse.up();
  assert.ok(await host.$eval('[data-testid="illust-crop"] img', image => parseFloat(image.style.left) > 100));
  await host.mouse.move(crop.x + crop.width / 2, crop.y + crop.height / 2);
  const beforeWheel = await host.$eval('[data-testid="illust-crop-zoom"]', input => Number(input.value));
  await host.mouse.wheel({ deltaY: -100 });
  await host.waitForFunction(zoom => Number(document.querySelector('[data-testid="illust-crop-zoom"]').value) > zoom, {}, beforeWheel);
  assert.equal(server.lobby.illusts.get(room.hostId), null, 'import edits upload nothing before confirmation');
  await host.waitForFunction(() => !document.querySelector('[data-testid="illust-confirm"]').disabled);
  fs.mkdirSync('test/e2e/out', { recursive: true });
  await host.screenshot({ path: 'test/e2e/out/pr24-import-crop.png' });
  await host.click('[data-testid="illust-confirm"]');
  await host.waitForSelector('.cardpick__custom-status');
  assert.equal(await host.$eval('.cardpick__custom-status', badge => badge.classList.contains('cardpick__star')), true);
  await host.screenshot({ path: 'test/e2e/out/pr24-entry-icon-uploaded.png' });
  await host.click('.cardpick .modal__actions button');
  const selfImage = '.rseat.is-me .rseat__art img[data-art="custom"]';
  const otherImage = '.rseat:not(.is-me) .rseat__art img[data-art="custom"]';
  await host.waitForSelector(selfImage); await guest.waitForSelector(otherImage);
  assert.deepEqual(await guest.$eval(otherImage, image => ({ width: image.naturalWidth, height: image.naturalHeight, fit: getComputedStyle(image).objectFit })), { width: 768, height: 1536, fit: 'cover' });
  const sharedPixel = await guest.$eval(otherImage, image => {
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return [...context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data];
  });
  assert.ok(sharedPixel[0] > 200 && sharedPixel[1] < 80, 'the other client receives the chosen red crop, rather than the original green center');
  const stored = server.lobby.illusts.get(room.hostId);
  assert.ok(stored.bytes.length <= 2 * 1024 * 1024); assert.equal(stored.type, 'image/webp');
  const seatArt = await (await host.$('.rseat.is-me .rseat__art')).boundingBox();
  await host.mouse.move(seatArt.x + seatArt.width / 2, seatArt.y + seatArt.height * 0.4);
  await host.mouse.wheel({ deltaY: -100 });
  await host.waitForFunction(selector => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(selector)).transform).a > 1, {}, selfImage);
  await host.mouse.down(); await host.mouse.move(seatArt.x + seatArt.width * 0.7, seatArt.y + seatArt.height * 0.4, { steps: 5 }); await host.mouse.up();
  assert.equal(await host.$('.cardpick'), null, 'dragging the room picture does not open its picker');
  await host.waitForFunction(selector => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(selector)).transform).e > 0, {}, selfImage);
  await host.click('[data-testid="seat-card-art"]');
  await host.waitForSelector('[data-testid="card-art-frame"]');
  await host.$eval('.cardart-dialog', element => Promise.all([...element.getAnimations(), ...element.parentElement.getAnimations()]
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  const frame = await (await host.$('[data-testid="card-art-frame"]')).boundingBox();
  assert.ok(Math.abs(frame.height / frame.width - 2) < 0.03);
  const slider = await (await host.$('[data-testid="card-art-zoom"]')).boundingBox();
  await host.mouse.click(slider.x + slider.width / 2, slider.y + slider.height / 2);
  const chosenZoom = await host.$eval('[data-testid="card-art-zoom"]', input => Number(input.value));
  assert.ok(chosenZoom > 1.2, 'a native slider click changes the zoom');
  await host.waitForFunction(zoom => Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.cardart-frame img')).transform).a - zoom) < 0.01, {}, chosenZoom);
  await host.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2); await host.mouse.down();
  await host.mouse.move(frame.x + frame.width * 0.7, frame.y + frame.height / 2, { steps: 5 }); await host.mouse.up();
  const savedFrame = await host.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.room.cardArt')).custom);
  assert.equal(savedFrame.zoom, chosenZoom); assert.ok(savedFrame.ox > 0);
  await host.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.cardart-frame img')).transform).e > 0);
  await host.click('.cardart-dialog .modal__actions button:last-child');
  await host.waitForFunction(selector => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(selector)).transform).e > 0, {}, selfImage);
  const priorEtag = stored.etag;
  await openPicker(); await host.click('[data-testid="custom-illust-entry"]');
  const cancelledChooser = host.waitForFileChooser(); await host.click('[data-testid="illust-choose"]');
  await (await cancelledChooser).accept([file]); await host.waitForSelector('[data-testid="illust-crop-zoom"]');
  await host.click('.illust-picker .modal__actions button:nth-last-child(2)');
  assert.equal(server.lobby.illusts.get(room.hostId).etag, priorEtag);
  assert.deepEqual(await host.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.room.cardArt')).custom), savedFrame);
  await host.click('.cardpick .modal__actions button');
  await host.evaluate(() => globalThis.__SP__.net.request('room.setCustomIllust', { on: false }));
  await guest.waitForFunction(selector => !document.querySelector(selector), {}, otherImage);
  await host.evaluate(() => globalThis.__SP__.net.request('room.setCustomIllust', { on: true }));
  await guest.waitForSelector(otherImage);
  await host.reload({ waitUntil: 'domcontentloaded' }); await host.waitForSelector(selfImage);
  assert.ok(Math.abs(await host.$eval(selfImage, image => new DOMMatrixReadOnly(getComputedStyle(image).transform).a) - chosenZoom) < 0.01);
  await host.setViewport({ width: 844, height: 390 });
  await host.click('[data-testid="seat-card-art"]'); await host.waitForSelector('.cardart-dialog');
  await host.$eval('.cardart-dialog', element => Promise.all([...element.getAnimations(), ...element.parentElement.getAnimations()]
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  assert.ok(await host.$eval('.cardart-dialog', element => element.scrollWidth <= element.clientWidth + 1));
  fs.mkdirSync('test/e2e/out', { recursive: true });
  await host.screenshot({ path: 'test/e2e/out/pr24-framing-mobile.png' });
  await host.click('.cardart-dialog .modal__actions button:last-child');
  await openPicker(); await host.click('[data-testid="custom-illust-entry"]');
  await host.click('[data-testid="illust-remove"]');
  await guest.waitForFunction(selector => !document.querySelector(selector), {}, otherImage);
  assert.equal(server.lobby.illusts.get(room.hostId), null);
  await host.waitForSelector('[data-testid="custom-illust-entry"]');
  await host.click('[data-testid="custom-illust-entry"]');
  const secondChooser = host.waitForFileChooser(); await host.click('[data-testid="illust-choose"]');
  await (await secondChooser).accept([file]);
  await host.waitForSelector('[data-testid="illust-crop-zoom"]');
  await host.$eval('.illust-picker', element => Promise.all([...element.getAnimations(), ...element.parentElement.getAnimations()]
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  const mobileCrop = await (await host.$('[data-testid="illust-crop"]')).boundingBox();
  const touch = await host.createCDPSession();
  const centerX = mobileCrop.x + mobileCrop.width / 2, centerY = mobileCrop.y + mobileCrop.height / 2;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centerX - 10, y: centerY, id: 1 }, { x: centerX + 10, y: centerY, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centerX - 18, y: centerY, id: 1 }, { x: centerX + 18, y: centerY, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await host.waitForFunction(() => Number(document.querySelector('[data-testid="illust-crop-zoom"]').value) > 1.5);
  await host.focus('[data-testid="illust-crop"]'); await host.keyboard.press('ArrowUp');
  assert.ok(await host.$eval('[data-testid="illust-crop"] img', image => parseFloat(image.style.top) < 50));
  assert.ok(await host.$eval('.illust-picker', element => element.scrollWidth <= element.clientWidth + 1));
  await host.screenshot({ path: 'test/e2e/out/pr24-import-crop-mobile.png' });
  await host.waitForFunction(() => !document.querySelector('[data-testid="illust-confirm"]').disabled);
  await host.click('[data-testid="illust-confirm"]'); await host.waitForSelector('.cardpick__custom-status');
  await host.click('.cardpick .modal__actions button');
  await host.evaluate(() => globalThis.__SP__.net.request('room.addBot'));
  await guest.evaluate(() => globalThis.__SP__.net.request('room.ready', { ready: true }));
  await host.evaluate(() => globalThis.__SP__.net.request('room.start'));
  room.match.enterBandDraft(); room.match.flush(true);
  await host.waitForSelector('.dorder.is-self img[data-art="custom"]');
  assert.equal(await host.$$eval('.dorder .pavatar.is-bot', elements => elements.some(element => element.closest('.dorder').querySelector('img[data-art="custom"]'))), false);
  await host.screenshot({ path: 'test/e2e/out/pr24-draft-custom.png' });
  assert.deepEqual(errors, []);
});

test('PR24 strategy tooltips show the actual strategy and touch text follows only the expanded row', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async testContext => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, illustDir: null });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  testContext.after(async () => { await browser.close(); await server.close(); });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message)); await page.setViewport({ width: 1440, height: 900 });
  await page.goto(server.url + '/dev/game-mock.html?shot=1&phase=PREP&render=fallback', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__MOCK__);
  const strategyName = await page.evaluate(async () => {
    const [{ render, h }, { UiHosts }, { TeamPanel }, { data }] = await Promise.all([
      import('/vendor/preact.module.js'), import('/js/ui/components.js'), import('/js/ui/teamPanel.js'), import('/js/data.js'),
    ]);
    const { store } = globalThis.__MOCK__, state = store.get(), pub = state.match.public;
    store.set({ room: { ...state.room, seatAvatars: true } });
    render(h('div', {}, h(TeamPanel, { pub, myId: state.me.playerId, watching: null, bubbles: new Map(),
      onWatch() {}, observe: { observing: false, canObserve: player => ({ fieldId: 'n:' + player.playerId }), onBack() {} } }), h(UiHosts)), document.getElementById('app'));
    return data.lookup('bands', pub.players.find(player => player.playerId === 'p3').bandId).name;
  });
  await page.hover('.team__row[data-player-id="p3"] .team__name');
  await page.waitForSelector('.team-strategy-tip.is-shown');
  assert.match(await page.$eval('.team-strategy-tip', element => element.textContent), new RegExp(strategyName));
  assert.doesNotMatch(await page.$eval('.team-strategy-tip', element => element.textContent), /预选/);
  await page.mouse.move(1000, 700);
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  const visible = () => page.$$eval('[data-testid="team-touch-strategy"]', elements => elements.filter(element => getComputedStyle(element).display !== 'none').length);
  assert.equal(await visible(), 0);
  await page.click('.team__row[data-player-id="p3"] .team__btn');
  await page.waitForSelector('.team__row[data-player-id="p3"] [data-testid="team-touch-strategy"]');
  assert.equal(await visible(), 1);
  await page.click('.team__row[data-player-id="ai_2"] .team__btn');
  await page.waitForSelector('.team__row[data-player-id="ai_2"] [data-testid="team-touch-strategy"]');
  assert.equal(await visible(), 1);
  await page.waitForFunction(() => !document.querySelector('.pbanner--overlay'));
  await page.screenshot({ path: 'test/e2e/out/pr24-touch-strategy.png' });
  assert.deepEqual(errors, []);
});
