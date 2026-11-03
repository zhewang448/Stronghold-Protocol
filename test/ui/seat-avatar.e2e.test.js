import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { Room } from '../../server/lobby.js';
import { getSeatAvatars, resetHostSettings } from '../../server/match/hostSettings.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('avatar preference affects every seat, tooltips work by tap/focus, and default mode stays unchanged', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await server.close(); });
  fs.mkdirSync('test/e2e/out', { recursive: true });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(server.url + '/dev/game-mock.html?phase=PREP&render=fallback&shot=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__SP_VIEW__);
  await page.evaluate(async () => {
    const [{ render, h }, { store }, { RoomScreen }, { UiHosts }, { data }] = await Promise.all([
      import('/vendor/preact.module.js'), import('/js/store.js'), import('/js/screens/room.js'),
      import('/js/ui/components.js'), import('/js/data.js'),
    ]);
    await data.load('bonds');
    await Promise.all(['/css/screens/lobby.css', '/css/screens/room.css'].map(href => new Promise(resolve => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.onload = resolve; document.head.appendChild(link);
    })));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    canvas.getContext('2d').fillRect(0, 0, 128, 128);
    localStorage.setItem('sp.pref.localAccount', JSON.stringify({ tag: '4567', avatar: canvas.toDataURL() }));
    dispatchEvent(new StorageEvent('storage', { key: 'sp.pref.localAccount' }));
    store.set({ me: { playerId: 'self', name: 'Self' }, conn: { status: 'online' }, room: {
      code: 'AVAT', mode: 'coop', difficulty: 'NORMAL', hostId: 'self', maxSeats: 4, seatAvatars: true,
      seats: [{ playerId: 'self', name: 'Self', connected: true, seat: 0, bondPlan: 'yanShip' },
        { playerId: 'guest', name: 'Guest', connected: true, seat: 1 }, { playerId: 'ai', name: 'AI', isBot: true, seat: 2 }],
    } });
    render(h('div', {}, h(RoomScreen), h(UiHosts)), document.getElementById('app'));
  });
  await page.waitForSelector('.rseat.is-me .avatar img');
  assert.equal(await page.$$eval('.rseat:not(.is-me) .avatar img', elements => elements.length), 0);
  assert.equal(await page.$$eval('.rseat.is-bot .avatar__bot', elements => elements.length), 1);
  await page.click('.rseat__avatar-help');
  await page.waitForSelector('.rseat__avatar-tooltip.is-shown');
  assert.match(await page.$eval('.rseat__avatar-tooltip', element => element.textContent), /炎/);
  assert.ok(await page.$eval('.rseat__avatar-tooltip', element => !!element.querySelector('.bglyph') && element.textContent.length > 40));
  await page.keyboard.press('Escape');
  await page.$eval('.rseat__avatar-help', element => element.focus());
  await page.keyboard.press('Enter');
  await page.waitForSelector('.rseat__avatar-tooltip.is-shown');
  await page.screenshot({ path: 'test/e2e/out/seat-avatar-tooltip.png' });
  await page.evaluate(async () => {
    const { store } = await import('/js/store.js'); store.set({ room: { ...store.get().room, seatAvatars: false } });
  });
  await page.waitForFunction(() => !document.querySelector('.rseat__avatar-help'));
  assert.equal(await page.$$eval('.rseat.is-me .avatar img', elements => elements.length), 1);
  await page.evaluate(async () => {
    const [{ render, h }, { store }, { PlayerAvatar }, { data }] = await Promise.all([
      import('/vendor/preact.module.js'), import('/js/store.js'), import('/js/ui/gameComponents.js'), import('/js/data.js'),
    ]);
    await data.load('bands');
    store.set({ room: { ...store.get().room, seatAvatars: true } });
    render(h('section', {}, h(PlayerAvatar, { player: { playerId: 'ai', name: 'AI', seat: 2, isBot: true, bandId: 'band_amiya' } })), document.getElementById('app'));
  });
  await page.waitForSelector('.pavatar.is-bot .pavatar__img img');
  assert.ok(await page.$eval('.pavatar.is-bot .pavatar__img img', element => !element.src.startsWith('data:')));
  assert.deepEqual(errors, []);
});

test('console settings navigation exposes the avatar default and saving affects new rooms only', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async t => {
  resetHostSettings();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-avatar-default-ui-'));
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const existing = new Room('OLD', 'coop', 'NORMAL', 0);
  server.lobby.rooms.set(existing.code, existing);
  const admin = await startAdmin({ lobby: server.lobby, port: 0, settingsFile: path.join(dir, 'settings.json'), resultsDir: dir, log: { info() {}, error() {} } });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await admin.close(); await server.close(); resetHostSettings(); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
  await page.click('[data-tab="settings"]');
  await page.waitForSelector('#settings-game #seat-avatars-enabled', { visible: true });
  assert.equal(await page.$eval('#seat-avatars-enabled', element => element.checked), false);
  await page.click('#seat-avatars-enabled'); await page.click('[data-room-creation-save]');
  await page.waitForFunction(() => document.querySelector('#room-creation-saved').textContent.includes('已保存'));
  assert.equal(getSeatAvatars(), true);
  assert.equal(existing.seatAvatars, false);
  assert.equal(new Room('NEW', 'coop', 'NORMAL', 0).seatAvatars, true);
  await page.$eval('#seat-avatars-settings', element => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'test/e2e/out/admin-avatar-default.png' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.click('[data-tab="settings"]');
  await page.waitForFunction(() => document.querySelector('#seat-avatars-enabled')?.checked === true);
});
