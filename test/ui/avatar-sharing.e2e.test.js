import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('two browsers see avatar updates and numeric spectator limits accept drafts before confirmation', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, heavyBurst: 100 });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await server.close(); });
  const errors = [];
  const open = async (name, color) => {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluateOnNewDocument(color => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const drawing = canvas.getContext('2d'); drawing.fillStyle = color; drawing.fillRect(0, 0, 128, 128);
      localStorage.setItem('sp.pref.localAccount', JSON.stringify({ tag: '4567', avatar: canvas.toDataURL('image/jpeg', 0.86) }));
    }, color);
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.title-login input'); await page.type('.title-login input', name);
    await page.evaluate(() => [...document.querySelectorAll('.title-login button')].find(button => button.textContent.includes('开始')).click());
    await page.waitForSelector('.lobby-screen');
    return page;
  };
  const host = await open('Host', '#c12528'), guest = await open('Guest', '#245fc9');
  await host.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
  const room = [...server.lobby.rooms.values()][0];
  await host.evaluate(() => globalThis.__SP__.net.request('room.setSeatAvatars', { on: true }));
  await guest.evaluate(code => globalThis.__SP__.net.request('room.join', { code }), room.code);
  const remote = '.rseat:not(.is-me):not(.is-bot) .avatar img';
  for (const page of [host, guest]) {
    await page.waitForFunction(selector => document.querySelector(selector)?.naturalWidth === 128, {}, remote);
    assert.ok(await page.$eval(remote, image => image.src.startsWith('data:image/jpeg;base64,')));
    assert.equal(await page.$$eval('.rseat:not(.is-me) .acct-tag', tags => tags.length), 0);
  }
  const hostAvatar = await host.$eval('.rseat.is-me .avatar img', image => image.src);
  assert.equal(await guest.$eval(remote, image => image.src), hostAvatar);
  fs.mkdirSync('test/e2e/out', { recursive: true });
  await host.screenshot({ path: 'test/e2e/out/avatars-shared-host.png' });
  await guest.screenshot({ path: 'test/e2e/out/avatars-shared-guest.png' });
  await host.click('.rs-pill__gear');
  const limit = '[name="spectator-limit"]';
  await host.waitForSelector(limit);
  const replaceLimit = async value => {
    await host.bringToFront(); await host.focus(limit);
    await host.keyboard.down('Control'); await host.keyboard.press('KeyA'); await host.keyboard.up('Control');
    await host.keyboard.press('Backspace'); if (value) await host.keyboard.type(value);
  };
  assert.ok(await host.$eval(limit, input => input.getBoundingClientRect().width >= 60));
  await replaceLimit('1');
  assert.equal(await host.$eval(limit, input => input.value), '1');
  assert.equal(room.spectatorLimit, 2);
  await guest.evaluate(() => globalThis.__SP__.net.request('room.ready', { ready: true }));
  assert.equal(await host.$eval(limit, input => input.value), '1', 'ordinary room state preserves the numeric draft');
  await host.keyboard.type('0');
  assert.equal(await host.$eval(limit, input => input.value), '10');
  await host.keyboard.press('Enter');
  await guest.waitForFunction(() => globalThis.__SP__.store.get().room.spectatorLimit === 10);
  for (const value of ['', '1', '21']) {
    await replaceLimit(value); await host.keyboard.press('Enter');
    assert.equal(await host.$eval(limit, input => input.checkValidity()), false);
    assert.equal(room.spectatorLimit, 10);
  }
  await host.setViewport({ width: 844, height: 390 });
  await replaceLimit('20');
  assert.equal(await host.$eval(limit, input => input.value), '20');
  await host.$eval(limit, input => input.closest('form').querySelector('button').click());
  await guest.waitForFunction(() => globalThis.__SP__.store.get().room.spectatorLimit === 20, { timeout: 5000 }).catch(async error => {
    t.diagnostic(JSON.stringify(await host.$eval(limit, input => ({ value: input.value, disabled: input.disabled,
      valid: input.checkValidity(), buttonDisabled: input.closest('form').querySelector('button').disabled,
      room: globalThis.__SP__.store.get().room.spectatorLimit, toast: document.querySelector('.toast')?.textContent }))));
    throw error;
  });
  await host.$eval(limit, input => input.scrollIntoView({ block: 'center' }));
  assert.ok(await host.$eval(limit, input => { const bounds = input.getBoundingClientRect(); return bounds.width >= 60 && bounds.right <= innerWidth; }));
  fs.mkdirSync('test/e2e/out', { recursive: true });
  await host.screenshot({ path: 'test/e2e/out/spectator-limit-mobile.png' });
  await host.reload({ waitUntil: 'domcontentloaded' });
  await host.waitForSelector('.room-screen');
  await host.waitForFunction(selector => document.querySelector(selector)?.naturalWidth === 128, {}, remote);
  await host.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const drawing = canvas.getContext('2d'); drawing.fillStyle = '#279c54'; drawing.fillRect(0, 0, 128, 128);
    localStorage.setItem('sp.pref.localAccount', JSON.stringify({ tag: '4567', avatar: canvas.toDataURL('image/jpeg', 0.86) }));
    dispatchEvent(new StorageEvent('storage', { key: 'sp.pref.localAccount' }));
  });
  await guest.waitForFunction((selector, old) => document.querySelector(selector)?.src !== old && document.querySelector(selector)?.naturalWidth === 128, {}, remote, hostAvatar);
  await guest.evaluate(async () => {
    const [{ render, h }, { PlayerAvatar }, { store }, { data }] = await Promise.all([
      import('/vendor/preact.module.js'), import('/js/ui/gameComponents.js'), import('/js/store.js'), import('/js/data.js'),
    ]);
    await data.load('bands');
    const other = store.get().room.seats.find(seat => seat && seat.playerId !== store.get().me.playerId);
    render(h('div', {}, h(PlayerAvatar, { player: other }), h(PlayerAvatar, { player: {
      playerId: 'bot', name: 'AI', isBot: true, seat: 2, bandId: 'band_amiya',
    } })), document.getElementById('app'));
  });
  await guest.waitForSelector('.pavatar:not(.is-bot) img[src^="data:image/jpeg"]');
  await guest.waitForSelector('.pavatar.is-bot img');
  assert.equal(await guest.$eval('.pavatar.is-bot img', image => image.src.startsWith('data:')), false);
  await host.evaluate(async () => { const { openAccountPanel } = await import('/js/ui/accounts.js'); openAccountPanel(); });
  await host.waitForSelector('.lacct__btns');
  await host.evaluate(() => [...document.querySelectorAll('.lacct__btns button')].find(button => button.textContent.includes('移除头像')).click());
  await guest.waitForFunction(() => !document.querySelector('.pavatar:not(.is-bot) img'));
  assert.deepEqual(errors, []);
});
