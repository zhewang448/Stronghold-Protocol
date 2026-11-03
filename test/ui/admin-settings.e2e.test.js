// Real console settings controls: save/reset, restart-visible state, error recovery and narrow layouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { getUniteLayerGains, getAllowRoomUniteLayerGains, resetHostSettings, setPrep } from '../../server/match/hostSettings.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, OUT, hasChrome } from '../e2e/client.mjs';
import { getChatSettings, setChatSettings, DEFAULT_CHAT_SETTINGS } from '../../server/chat.js';

test('console room prep: follows settings, room-only modes, errors, reset and responsive controls', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-room-prep-'));
  const h = makeMatch({ humans: 2, fake: true }).start().toPrep();
  let admin, browser;
  resetHostSettings();
  try {
    const room = { code: 'TEST', mode: 'coop', difficulty: 'NORMAL', seats: [], spectators: [], match: h.m };
    admin = await startAdmin({ lobby: { rooms: new Map([['TEST', room]]), safeData: () => h.m.data, onMatchEnd() {} }, port: 0,
      resultsDir: dir, settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
    setPrep({ mode: 'scale', scale: 2 });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    const mode = '[data-room-prep-mode]';
    await page.waitForSelector('[data-open-room]'); await page.click('[data-open-room]');
    const apply = () => page.click('[data-room-prep-save]');
    const current = text => page.waitForFunction(text => document.querySelector('[data-room-prep-current]')?.textContent.includes(text), {}, text);
    await page.waitForSelector(mode);
    assert.equal(await page.$eval(mode, e => e.value), 'inherit');
    await current('继承控制台：默认时长 × 2');
    await page.select(mode, 'scale');
    await page.$eval('[data-room-prep-scale] input', e => { e.value = '1.5'; });
    await apply(); await current('本房间：默认时长 × 1.5');
    assert.deepEqual(h.m.prepOverride, { mode: 'scale', scale: 1.5 });
    assert.equal(h.m.timerScale, 1);
    await page.select(mode, 'fixed');
    await page.$eval('[data-room-prep-seconds] input', e => { e.value = '1'; });
    await apply(); await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('5–3600'));
    assert.deepEqual(h.m.prepOverride, { mode: 'scale', scale: 1.5 });
    await page.waitForFunction(() => document.querySelector('[data-room-prep-mode]').value === 'scale');
    await page.select(mode, 'fixed');
    await page.$eval('[data-room-prep-seconds] input', e => { e.value = '45'; });
    await apply(); await current('本房间：每回合 45 秒');
    await page.select(mode, 'perRound');
    await page.$eval('[data-room-prep-round="2"]', e => { e.value = '80'; });
    await apply(); await current('本房间：按回合指定');
    assert.deepEqual(h.m.prepOverride, { mode: 'perRound', rounds: { 2: 80 } });
    mkdirSync(OUT, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      assert.ok(await page.$eval('[data-room-prep]', el => {
        const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth;
      }), name);
      await page.screenshot({ path: path.join(OUT, `admin-room-prep-${name}.png`), fullPage: true });
    }
    await page.select(mode, 'untimed'); await apply(); await current('本房间：不限时');
    setPrep({ mode: 'fixed', seconds: 70 });
    await page.select(mode, 'inherit'); await apply(); await current('继承控制台：每回合 70 秒');
    assert.equal(h.m.prepOverride, null);
    setPrep({ mode: 'fixed', seconds: 90 });
    await current('继承控制台：每回合 90 秒');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (admin) await admin.close();
    h.m.dispose(); resetHostSettings(); rmSync(dir, { recursive: true, force: true });
  }
});

test('console 联防 layers: save, undo, reload, failure recovery and desktop/mobile layout', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-admin-settings-'));
  let srv, admin, browser;
  resetHostSettings();
  try {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    admin = await startAdmin({ lobby: srv.lobby, port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
    const P = (await import('puppeteer-core')).default;
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    const open = async () => { await page.click('[data-tab="settings"]'); await page.waitForSelector('#unite-layers-enabled'); };
    page.setDefaultTimeout(10000);
    const checked = () => page.$eval('#unite-layers-enabled', (el) => el.checked);
    await open();
    assert.equal(await page.$eval('#rooms', (el) => el.getBoundingClientRect().height), 0, 'other tabs stay hidden');
    assert.equal(await checked(), false);
    assert.equal(await page.$eval('#unite-layers-host-control', e => e.checked), false);
    await page.click('#unite-layers-enabled');
    await page.click('#unite-layers-host-control');
    await page.click('[data-room-creation-reset]');
    assert.equal(await checked(), false, 'undo restores the saved value');
    assert.equal(await page.$eval('#unite-layers-host-control', e => e.checked), false, 'undo restores the permission');
    await page.click('#unite-layers-enabled');
    await page.click('#unite-layers-host-control');
    await page.click('[data-room-creation-save]');
    await page.waitForFunction(() => document.querySelector('#room-creation-saved').textContent.includes('已保存'));
    assert.equal(getUniteLayerGains(), true);
    assert.equal(getAllowRoomUniteLayerGains(), true);
    await page.click('[data-prep-save]');
    await page.waitForFunction(() => document.querySelector('#prep-saved')?.textContent === '已保存');
    assert.equal(getUniteLayerGains(), true, 'saving timers preserves the custom rule');
    assert.equal(getAllowRoomUniteLayerGains(), true, 'saving timers preserves permission');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await open();
    assert.equal(await checked(), true, 'reload reads the saved state');
    assert.equal(await page.$eval('#unite-layers-host-control', e => e.checked), true, 'reload reads saved permission');
    assert.equal(await page.$eval('#chat-enabled', (e) => e.checked), true);
    await page.click('#chat-enabled');
    await page.$eval('#chat-cooldown', (e) => { e.value = '3'; });
    await page.$eval('#chat-history-limit', (e) => { e.value = '20'; });
    await page.click('[data-chat-policy-save]');
    await page.waitForFunction(() => document.querySelector('#chat-policy-saved').textContent.includes('已保存'));
    assert.deepEqual(getChatSettings(), { enabled: false, cooldownMs: 3000, historyLimit: 20 });
    await page.reload({ waitUntil: 'domcontentloaded' }); await open();
    assert.equal(await page.$eval('#chat-enabled', (e) => e.checked), false);
    await page.$eval('#chat-history-limit', (e) => { e.value = '51'; });
    await page.click('[data-chat-policy-save]');
    await page.waitForFunction(() => document.querySelector('#chat-policy-saved').textContent.includes('保存失败'));
    assert.equal(getChatSettings().historyLimit, 20);
    await page.click('[data-chat-policy-reset]');
    assert.equal(await page.$eval('#chat-history-limit', (e) => e.value), '20');

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/api/settings')) req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: '测试保存失败' }) });
      else req.continue();
    });
    await page.click('#unite-layers-enabled');
    await page.click('#unite-layers-host-control');
    await page.click('[data-room-creation-save]');
    await page.waitForFunction(() => document.querySelector('#room-creation-saved').textContent.includes('保存失败'));
    assert.equal(getUniteLayerGains(), true, 'failed save leaves the server unchanged');
    assert.equal(getAllowRoomUniteLayerGains(), true, 'failed save preserves server permission');
    assert.equal(await page.$eval('[data-room-creation-save]', (el) => el.disabled), false, 'can retry');
    await page.click('[data-room-creation-reset]');
    assert.equal(await checked(), true);
    assert.equal(await page.$eval('#unite-layers-host-control', e => e.checked), true);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#msg')).display === 'none');

    mkdirSync(OUT, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      const fits = await page.$eval('#room-defaults-settings', (form) => {
        const rect = form.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && form.scrollWidth <= form.clientWidth;
      });
      assert.ok(fits, `${name}: controls stay within the viewport`);
      await page.screenshot({ path: path.join(OUT, `admin-unite-layers-${name}.png`) });
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (admin) await admin.close();
    if (srv) await srv.close();
    resetHostSettings();
    setChatSettings(DEFAULT_CHAT_SETTINGS);
    rmSync(dir, { recursive: true, force: true });
  }
});
