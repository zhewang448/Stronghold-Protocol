import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { getRoomCreation, setRoomCreation, resetHostSettings, ROOM_CONFIG_FIELDS } from '../../server/match/hostSettings.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('settings search filters without losing drafts and the merged defaults table saves permissions', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async t => {
  resetHostSettings();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-room-config-ui-'));
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const admin = await startAdmin({ lobby: server.lobby, network: server.network, port: 0,
    settingsFile: path.join(dir, 'settings.json'), resultsDir: dir, log: { info() {}, error() {} } });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await admin.close(); await server.close(); resetHostSettings(); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
  await page.click('[data-tab="settings"]');
  await page.waitForSelector('#room-defaults-settings', { visible: true });
  assert.equal(await page.$$eval('[data-room-config-row]', rows => rows.length), ROOM_CONFIG_FIELDS.length);
  assert.equal(await page.$('#ai-takeover-settings'), null, 'legacy controls are merged, not duplicated');
  assert.equal(await page.$('#unite-settings'), null);
  await page.$eval('[data-room-default="enemyHpMultiplier"]', element => { element.value = '1.6'; });
  await page.type('#settings-search', '头像');
  assert.equal(await page.$$eval('[data-room-config-row]:not([hidden])', rows => rows.length), 1);
  await page.click('#seat-avatars-enabled');
  await page.click('[data-room-control="seatAvatars"]');
  await page.click('#settings-search-clear');
  assert.equal(await page.$eval('[data-room-default="enemyHpMultiplier"]', element => element.value), '1.6');
  await page.type('#settings-search', '无匹配的配置 xyz');
  assert.match(await page.$eval('#settings-search-status', element => element.textContent), /没有匹配/);
  await page.click('#settings-search-clear');
  await page.click('[data-room-creation-save]');
  await page.waitForFunction(() => document.querySelector('#room-creation-saved').textContent.includes('已保存'));
  assert.equal(getRoomCreation().defaults.seatAvatars, true);
  assert.equal(getRoomCreation().hostControls.seatAvatars, false);
  assert.equal(getRoomCreation().defaults.enemyHpMultiplier, 1.6);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.click('[data-tab="settings"]');
  await page.waitForFunction(() => document.querySelector('#seat-avatars-enabled')?.checked === true);
  assert.equal(await page.$eval('[data-room-control="seatAvatars"]', element => element.checked), false);
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewport({ width, height });
    await page.type('#settings-search', '头像');
    await page.waitForSelector('#room-defaults-settings', { visible: true });
    assert.ok(await page.$eval('#settings', element => element.scrollWidth <= element.clientWidth + 1));
    fs.mkdirSync('test/e2e/out', { recursive: true });
    await page.screenshot({ path: `test/e2e/out/room-creation-settings-${width}.png` });
    await page.click('#settings-search-clear');
  }
  assert.deepEqual(errors, []);
});

test('creation screens show locked defaults and solo rooms retain version-specific restrictions', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async t => {
  resetHostSettings();
  setRoomCreation({ defaults: { version: 'act1autochess', difficulty: 'NORMAL', private: true,
    'convenience.soloUnlimited': false, independentPools: true, rescueEnabled: true, aiTakeoverEnabled: true },
  hostControls: { version: false, difficulty: false, private: false, 'convenience.soloUnlimited': false } });
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await server.close(); resetHostSettings(); });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.title-login input');
  await page.type('.title-login input', 'Creation defaults');
  await page.evaluate(() => [...document.querySelectorAll('.title-login button')].find(button => button.textContent.includes('开始')).click());
  await page.waitForSelector('.lobby-screen');
  await page.evaluate(() => globalThis.__SP__.store.set({ lobbyVersion: 'act2autochess' }));
  await page.click('.hub-entry[aria-label="独立模拟"]');
  await page.waitForSelector('[data-testid="solo-unlimited"] input');
  assert.deepEqual(await page.$eval('[data-testid="solo-unlimited"] input', input => ({ checked: input.checked, disabled: input.disabled })), { checked: false, disabled: true });
  assert.equal(await page.$$eval('.pcard', buttons => buttons.every(button => button.disabled)), true);
  await page.waitForFunction(() => !document.querySelector('.proto-start').disabled);
  await page.click('.proto-start');
  await page.waitForSelector('.room-screen');
  const solo = [...server.lobby.rooms.values()][0];
  assert.equal(solo.version, 'act1autochess');
  assert.equal(solo.difficulty, 'NORMAL');
  assert.equal(solo.convenience.soloUnlimited, false);
  for (const key of ['private', 'independentPools', 'rescueEnabled', 'aiTakeoverEnabled']) assert.equal(solo[key], false, key);
  await page.click('.rs-exit');
  await page.waitForSelector('.lobby-screen');
  await page.click('.hub-entry[aria-label="同盟模拟"]');
  await page.waitForSelector('[data-testid="create-alliance"]');
  await page.click('[data-testid="create-alliance"]');
  await page.waitForSelector('.proto-private input');
  assert.deepEqual(await page.$eval('.proto-private input', input => ({ checked: input.checked, disabled: input.disabled })), { checked: true, disabled: true });
  assert.deepEqual(errors, []);
});

test('room reset confirms server defaults, preserves difficulty and shows the combined version vote on desktop and mobile', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async testContext => {
  resetHostSettings();
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false, heavyBurst: 100 });
  server.lobby.opts.versionProposeGapMs = 0;
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  testContext.after(async () => { await browser.close(); await server.close(); resetHostSettings(); });
  const errors = [];
  const open = async name => {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.title-login input'); await page.type('.title-login input', name);
    await page.evaluate(() => [...document.querySelectorAll('.title-login button')].find(button => button.textContent.includes('开始')).click());
    await page.waitForSelector('.lobby-screen'); return page;
  };
  const host = await open('Reset host'), guest = await open('Reset guest');
  await host.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
  const room = [...server.lobby.rooms.values()][0];
  await guest.evaluate(code => globalThis.__SP__.net.request('room.join', { code }), room.code);
  await host.evaluate(() => globalThis.__SP__.net.request('room.setEnemyHpMultiplier', { multiplier: 3 }));
  setRoomCreation({ defaults: { difficulty: 'ABYSS', private: true, capacity: 8, spectatorLimit: 6,
    enemyHpMultiplier: 1.5, seatAvatars: true, 'convenience.unequip': true },
  hostControls: Object.fromEntries(ROOM_CONFIG_FIELDS.map(field => [field.key, true])) });
  const resetButton = '[data-testid="room-reset-settings"]';
  const options = async page => {
    await page.bringToFront(); await page.click('.rs-pill__gear');
    await page.waitForSelector('.rs-opts:not(.is-leaving)');
  };
  const answer = async agree => {
    await host.waitForSelector('.modal__actions');
    await host.evaluate(agree => [...document.querySelectorAll('.modal__actions button')]
      .find(button => button.textContent.includes(agree ? '恢复默认' : '取消')).click(), agree);
    await host.waitForFunction(() => !document.querySelector('.modal__actions'));
  };
  await options(guest);
  assert.equal(await guest.$eval(resetButton, button => button.disabled), true);
  await guest.click('.rs-pill__gear');
  await options(host); await host.click(resetButton); await answer(false);
  assert.equal(room.enemyHpMultiplier, 3); assert.equal(room.private, false);
  await options(host); await host.click(resetButton); await answer(true);
  await guest.waitForFunction(() => globalThis.__SP__.store.get().room.enemyHpMultiplier === 1.5);
  assert.equal(room.difficulty, 'NORMAL'); assert.equal(room.private, true); assert.equal(room.capacity, 8);
  assert.equal(room.spectatorLimit, 6); assert.equal(room.seatAvatars, true); assert.equal(room.convenience.unequip, true);
  await host.setViewport({ width: 844, height: 390 });
  await options(host);
  await host.$eval(resetButton, button => button.scrollIntoView({ block: 'center' }));
  await host.$eval('.rs-opts', element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
  assert.ok(await host.$eval(resetButton, button => { const bounds = button.getBoundingClientRect(); return bounds.height >= 32 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight; }));
  fs.mkdirSync('test/e2e/out', { recursive: true });
  await host.screenshot({ path: 'test/e2e/out/room-reset-defaults-mobile.png' });
  setRoomCreation({ defaults: { version: 'act1autochess', enemyHpMultiplier: 1.25 } });
  await host.click(resetButton); await answer(true);
  await guest.waitForSelector('[data-testid="version-vote"]');
  assert.match(await guest.$eval('.vervote__hint', element => element.textContent), /恢复默认配置.*难度保持不变/);
  assert.equal(room.version, 'act2autochess'); assert.equal(room.enemyHpMultiplier, 1.5);
  await guest.bringToFront(); await guest.click('[data-testid="version-agree"]');
  await host.waitForFunction(() => globalThis.__SP__.store.get().room.version === 'act1autochess');
  assert.equal(room.difficulty, 'NORMAL'); assert.equal(room.enemyHpMultiplier, 1.25);
  assert.equal(room.versionVote, null);
  assert.deepEqual(errors, []);
});
