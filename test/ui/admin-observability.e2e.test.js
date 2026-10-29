import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { CONVENIENCE_DEFAULTS } from '../../shared/roomConvenience.js';

test('console shows rules, blockers, battles, stock, events and filtered records', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-console-observe-'));
  const harness = makeMatch({ humans: 2, independentPools: true, fake: true, clientCombat: true, clients: false, instant: false }).start().toPrep();
  assert.ok(harness.drive(() => harness.m.phase === 'COMBAT'));
  const seats = harness.m.order.map((player) => ({ playerId: player.playerId, seat: player.seat, name: player.name, isBot: false, connected: true, ready: true }));
  const active = { code: 'PLAY', mode: 'coop', difficulty: 'NORMAL', hostId: 'p_0', enemyHpMultiplier: 2, independentPools: true,
    uniteLayerGains: false, test: false, content: { vanilla: true, plugins: [] }, seats, spectators: [], match: harness.m };
  const waiting = { code: 'WAIT', mode: 'coop', difficulty: 'NORMAL', hostId: 'host', enemyHpMultiplier: 1,
    independentPools: false, uniteLayerGains: false, test: false, needsContent: true,
    content: { vanilla: false, plugins: [{ id: 'fixture', version: '1' }] },
    seats: [{ playerId: 'host', name: 'Host', connected: true, ready: false, content: 'ready' },
      { playerId: 'guest', name: 'Guest', connected: true, ready: false, content: 'failed' }], spectators: [], match: null };
  const rules = { enemyHpMultiplier: 1, independentPools: false, uniteLayerGains: false, aiPicksLast: true, gameplayPlugins: false, adminModified: false, plugins: [], convenience: { ...CONVENIENCE_DEFAULTS } };
  const record = { savedAt: Date.now(), room: 'PLAY', mode: 'coop', difficulty: 'NORMAL', result: { victory: true, roundsPassed: 1, players: [] }, history: [] };
  fs.writeFileSync(path.join(dir, 'standard.json'), JSON.stringify({ ...record, rules }));
  fs.writeFileSync(path.join(dir, 'custom.json'), JSON.stringify({ ...record, rules: { ...rules, enemyHpMultiplier: 2 } }));
  fs.writeFileSync(path.join(dir, 'legacy.json'), JSON.stringify(record));
  const lobby = { rooms: new Map([['WAIT', waiting], ['PLAY', active]]), safeData: () => harness.m.data, onMatchEnd() {}, broadcastState() {} };
  const admin = await startAdmin({ lobby, port: 0, resultsDir: dir, replaysDir: path.join(dir, 'replays'), settingsFile: path.join(dir, 'settings.json'),
    updateOptions: { fetchImpl: async () => new Response('[]') }, log: { info() {}, error() {} } });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await admin.close(); harness.m.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  fs.mkdirSync('.cache/console-observability', { recursive: true });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-open-room="WAIT"]');
  await page.click('[data-open-room="WAIT"]');
  assert.match(await page.$eval('#rooms', (element) => element.innerText), /Guest 未准备.*Guest 的插件加载失败/s);
  await page.click('[data-open-room="PLAY"]');
  assert.match(await page.$eval('#rooms', (element) => element.innerText), /敌人血量 ×2.*独立卡池/s);
  assert.match(await page.$eval('#rooms', (element) => element.innerText), /战场状态.*等待 P0 的战斗结果/s);
  await page.click('[data-room-tab="data"]');
  await page.click('details[data-stock] summary');
  await page.click('[data-stock-load]');
  await page.waitForSelector('[data-stock-rows] tr');
  await page.screenshot({ path: '.cache/console-observability/stock-desktop.png', fullPage: true });
  assert.equal(await page.$$eval('[data-stock-group] option', (options) => options.length), 2);
  await page.select('[data-stock-group]', '2');
  await page.waitForFunction(() => document.querySelector('[data-stock-group]')?.value === '2');
  await page.$eval('[data-stock-filter]', (input) => { input.value = '不存在的干员'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.match(await page.$eval('[data-stock-rows]', (element) => element.innerText), /没有匹配的库存/);
  await page.click('[data-room-tab="operations"]');
  await page.click('[data-toggle="p_0"]');
  await page.type('[data-act="funds"][data-player="p_0"]', '7');
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/action') && response.request().method() === 'POST'),
    page.keyboard.press('Enter'),
  ]);
  harness.m.reportError('fixture', new Error('测试异常'));
  await page.click('[data-tab="events"]');
  await page.waitForFunction(() => document.querySelector('#events-list')?.innerText.includes('金币'));
  await page.waitForFunction(() => document.querySelector('#events-list')?.innerText.includes('测试异常'), { timeout: 10000 });
  await page.click('[data-tab="records"]');
  await page.waitForFunction(() => document.querySelector('#summary-data')?.innerText.includes('已确认默认 1 局'));
  assert.match(await page.$eval('#summary-data', (element) => element.innerText), /1 局 · 1 胜/);
  await page.setViewport({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.cache/console-observability/records-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
});
