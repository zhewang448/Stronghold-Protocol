import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { png } from '../helpers/pluginFixtures.js';

test('three local avatar and illustration presets survive reload, isolate slots, confirm replacement and share only the applied image', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 180000,
}, async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-picture-presets-'));
  const files = [[240, 30, 30, 255], [30, 220, 30, 255], [30, 30, 240, 255]].map((color, slot) => {
    const file = path.join(directory, 'picture-' + slot + '.png'); fs.writeFileSync(file, png(128, 256, color)); return file;
  });
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, illustDir: path.join(directory, 'pictures'), heavyBurst: 100 });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  testContext.after(async () => { await browser.close(); await server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const errors = [], posts = [], consoleErrors = [], uploadResults = [];
  const login = async name => {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/illust')) posts.push(request.url()); });
    page.on('response', response => { if (response.request().method() === 'POST' && response.url().endsWith('/illust')) uploadResults.push(response.status()); });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.title-login input');
    await page.type('.title-login input', name);
    await page.evaluate(() => [...document.querySelectorAll('.title-login button')].find(button => button.textContent.includes('开始')).click());
    await page.waitForSelector('.lobby-screen'); return page;
  };
  const host = await login('Preset host'), guest = await login('Preset guest');
  await host.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
  const room = [...server.lobby.rooms.values()][0];
  await host.evaluate(() => globalThis.__SP__.net.request('room.setSeatAvatars', { on: true }));
  await guest.evaluate(code => globalThis.__SP__.net.request('room.join', { code }), room.code);
  const openAccount = () => host.evaluate(async () => (await import('/js/ui/accounts.js')).openAccountPanel());
  const avatarValue = () => host.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.localAccount')).avatar);
  const waitPreset = kind => host.waitForFunction(value => !document.querySelector('[data-testid="' + value + '-preset-0"]').disabled, {}, kind);
  const saved = async (kind, slot) => {
    await host.click('[data-testid="' + kind + '-preset-' + slot + '"]');
    await host.click('[data-testid="' + kind + '-preset-save"]');
    try {
      await host.waitForFunction(({ type, index }) => document.querySelector('[data-testid="' + type + '-preset-' + index + '"] img') && !document.querySelector('[data-testid="' + type + '-preset-save"]').disabled, { timeout: 8000 }, { type: kind, index: slot });
    } catch (error) {
      throw new Error(JSON.stringify({ kind, slot, ui: await host.$eval('[data-testid="' + kind + '-presets"]', element => element.textContent), consoleErrors }), { cause: error });
    }
  };
  const respond = async (title, confirm) => {
    await host.waitForFunction(text => [...document.querySelectorAll('[role="dialog"]')].some(element => element.querySelector('h2')?.textContent === text), {}, title);
    await host.evaluate(({ text, accept }) => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find(element => element.querySelector('h2')?.textContent === text);
      dialog.querySelector('.modal__actions button:' + (accept ? 'last-child' : 'first-child')).click();
    }, { text: title, accept: confirm });
  };
  const avatars = [];
  await openAccount(); await waitPreset('avatar');
  assert.equal(await host.$$eval('[data-testid="avatar-presets"] .picture-presets__slot', elements => elements.length), 3);
  for (let slot = 0; slot < 3; slot++) {
    const chooser = host.waitForFileChooser();
    await host.evaluate(() => [...document.querySelectorAll('.lacct__btns button')].find(button => button.textContent === '更换头像').click());
    await (await chooser).accept([files[slot]]); await host.waitForSelector('[data-testid="avatar-crop"]');
    await host.evaluate(() => [...document.querySelectorAll('.lacct-crop-modal button')].find(button => button.textContent === '使用头像').click());
    await host.waitForSelector('.lacct__pic img'); await waitPreset('avatar'); avatars.push(await avatarValue());
    await saved('avatar', slot);
  }
  await host.click('[data-testid="avatar-preset-0"]');
  assert.equal(await avatarValue(), avatars[2], 'selection previews without applying');
  await host.click('[data-testid="avatar-preset-save"]'); await respond('覆盖预设', false); await waitPreset('avatar');
  await host.click('[data-testid="avatar-preset-use"]');
  await host.waitForFunction(expected => JSON.parse(localStorage.getItem('sp.pref.localAccount')).avatar === expected, {}, avatars[0]);
  await guest.waitForFunction(({ playerId, avatar }) => import('/js/store.js').then(({ store }) => store.get().roomAvatars?.avatars?.[playerId] === avatar), {}, { playerId: room.hostId, avatar: avatars[0] });
  await host.reload({ waitUntil: 'domcontentloaded' }); await host.waitForSelector('.room-screen'); await openAccount(); await waitPreset('avatar');
  assert.equal(await host.$$eval('[data-testid="avatar-presets"] img', images => images.length), 3);
  await host.click('[data-testid="avatar-preset-2"]'); await host.click('[data-testid="avatar-preset-clear"]'); await respond('清空预设', true); await waitPreset('avatar');
  assert.equal(await avatarValue(), avatars[0]);
  assert.equal(await host.$('[data-testid="avatar-preset-2"] img'), null);
  await host.keyboard.press('Escape');
  const openIllustration = async () => {
    await host.click('.rseat.is-me [aria-label="更换名片干员"]'); await host.waitForSelector('[data-testid="custom-illust-entry"]');
    await host.click('[data-testid="custom-illust-entry"]'); await waitPreset('illust');
  };
  const closeIllustration = async () => { await host.keyboard.press('Escape'); await host.waitForSelector('.cardpick'); await host.keyboard.press('Escape'); };
  const images = [];
  for (let slot = 0; slot < 3; slot++) {
    await openIllustration();
    const chooser = host.waitForFileChooser(); await host.click('[data-testid="illust-choose"]'); await (await chooser).accept([files[slot]]);
    await host.waitForFunction(() => !document.querySelector('[data-testid="illust-confirm"]').disabled);
    if (slot > 0) await new Promise(resolve => setTimeout(resolve, 1600));
    await host.click('[data-testid="illust-confirm"]');
    try { await host.waitForSelector('.cardpick__custom-status', { timeout: 8000 }); }
    catch (error) { throw new Error(JSON.stringify({ slot, uploadResults, ui: await host.$eval('.illust-picker', element => element.textContent) }), { cause: error }); }
    await host.keyboard.press('Escape');
    images.push(server.lobby.illusts.get(room.hostId).etag);
    await host.evaluate(async index => (await import('/js/ui/cardArt.js')).setCardArt('custom', { zoom: 1 + index * 0.2, ox: index * 5, oy: -index * 3 }), slot);
    await openIllustration();
    const beforeSave = posts.length; await saved('illust', slot); assert.equal(posts.length, beforeSave, 'saving a local slot does not upload another server image');
    await closeIllustration();
  }
  await host.reload({ waitUntil: 'domcontentloaded' }); await host.waitForSelector('.room-screen'); await openIllustration();
  assert.equal(await host.$$eval('[data-testid="illust-presets"] img', elements => elements.length), 3);
  await host.click('[data-testid="illust-preset-1"]');
  assert.equal(server.lobby.illusts.get(room.hostId).etag, images[2]);
  const failUpload = request => request.url().endsWith('/illust') && request.method() === 'POST'
    ? request.respond({ status: 503, contentType: 'application/json', body: '{"error":"temporary"}' }) : request.continue();
  await host.setRequestInterception(true); host.on('request', failUpload);
  await host.click('[data-testid="illust-preset-use"]');
  await host.waitForSelector('[data-testid="illust-presets"] [role="alert"]');
  assert.equal(server.lobby.illusts.get(room.hostId).etag, images[2], 'a failed application keeps the active image');
  host.off('request', failUpload); await host.setRequestInterception(false); await waitPreset('illust');
  await new Promise(resolve => setTimeout(resolve, 1600));
  await host.click('[data-testid="illust-preset-use"]'); await host.waitForSelector('.cardpick'); await host.keyboard.press('Escape');
  assert.equal(server.lobby.illusts.get(room.hostId).etag, images[1]);
  assert.deepEqual(await host.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.room.cardArt')).custom), { zoom: 1.2, ox: 5, oy: -3 });
  await guest.waitForFunction(expected => import('/js/store.js').then(({ store }) => store.get().room?.seats?.some(seat => seat?.illust === expected)), {}, images[1]);
  await openIllustration(); await host.click('[data-testid="illust-preset-1"]');
  await host.click('[data-testid="illust-preset-clear"]'); await respond('清空预设', true); await waitPreset('illust');
  assert.equal(server.lobby.illusts.get(room.hostId).etag, images[1], 'clearing a preset keeps the active picture');
  const counts = await host.evaluate(async () => {
    const { readPicturePresets, savePicturePreset } = await import('/js/ui/picturePresets.js');
    const scope = (await import('/js/ui/accounts.js')).currentAccount().id;
    let refused = false;
    try { await savePicturePreset(scope, 'illust', 3, {}); } catch { refused = true; }
    return { avatars: (await readPicturePresets(scope, 'avatar')).filter(Boolean).length,
      illusts: (await readPicturePresets(scope, 'illust')).filter(Boolean).length,
      other: (await readPicturePresets('another-local-account', 'illust')).filter(Boolean).length, refused };
  });
  assert.deepEqual(counts, { avatars: 2, illusts: 2, other: 0, refused: true });
  await host.setViewport({ width: 844, height: 390 });
  await host.click('[data-testid="illust-preset-0"]');
  assert.ok(await host.$eval('.illust-picker', element => element.scrollWidth <= element.clientWidth + 1));
  fs.mkdirSync('test/e2e/out', { recursive: true }); await host.screenshot({ path: 'test/e2e/out/picture-presets-mobile.png' });
  assert.deepEqual(errors, []);
});

test('preset storage denial is visible and retry recovers without changing the current avatar', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async testContext => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, illustDir: null });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  testContext.after(async () => { await browser.close(); await server.close(); });
  const page = await browser.newPage(); await page.setViewport({ width: 844, height: 390 });
  await page.goto(server.url + '/dev/game-mock.html?phase=PREP&render=fallback&shot=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__SP_VIEW__);
  await page.evaluate(async () => {
    const original = indexedDB.open.bind(indexedDB);
    globalThis.__DENY_PRESET_STORAGE__ = true;
    indexedDB.open = (...args) => {
      if (args[0] === 'sp-picture-presets' && globalThis.__DENY_PRESET_STORAGE__) throw new DOMException('Storage denied', 'SecurityError');
      return original(...args);
    };
    (await import('/js/ui/accounts.js')).openAccountPanel();
  });
  await page.waitForSelector('[data-testid="avatar-presets"] [role="alert"]');
  const before = await page.evaluate(() => localStorage.getItem('sp.pref.localAccount'));
  assert.equal(await page.$eval('[data-testid="avatar-preset-use"]', button => button.disabled), true);
  await page.evaluate(() => { globalThis.__DENY_PRESET_STORAGE__ = false; });
  await page.evaluate(() => [...document.querySelectorAll('[data-testid="avatar-presets"] button')].find(button => button.textContent === '重试').click());
  await page.waitForFunction(() => !document.querySelector('[data-testid="avatar-preset-0"]').disabled);
  assert.equal(await page.$('[data-testid="avatar-presets"] [role="alert"]'), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('sp.pref.localAccount')), before);
  assert.ok(await page.$eval('[data-testid="avatar-presets"]', element => element.scrollWidth <= element.clientWidth + 1));
  await page.click('[data-testid="avatar-preset-2"]');
  fs.mkdirSync('test/e2e/out', { recursive: true }); await page.screenshot({ path: 'test/e2e/out/avatar-presets-mobile.png' });
});
