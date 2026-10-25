import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { resetHostSettings } from '../../server/match/hostSettings.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('host console AI switch persists and updates room capability without a restart', { skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000 }, async t => {
  const prior = process.env.SP_AI_TAKEOVER; delete process.env.SP_AI_TAKEOVER; resetHostSettings();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ai-policy-ui-')), file = path.join(dir, 'settings.json');
  fs.mkdirSync('.cache/ui-fixes-20261026', { recursive: true });
  const mark = text => fs.appendFileSync('.cache/ui-fixes-20261026/admin-progress.log', text + '\n');
  let srv, admin, browser;
  try {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    mark('server started');
    admin = await startAdmin({ lobby: srv.lobby, network: srv.network, port: 0, settingsFile: file, resultsDir: dir, log: { info() {}, error() {} } });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
    mark('browser started');
    const host = await browser.newPage(), consolePage = await browser.newPage(), errors = [];
    host.setDefaultTimeout(15000); consolePage.setDefaultTimeout(15000);
    for (const p of [host, consolePage]) { p.on('pageerror', e => errors.push(e.message)); await p.setViewport({ width: 1440, height: 900 }); }
    await host.bringToFront();
    await host.goto(srv.url, { waitUntil: 'domcontentloaded' });
    mark('page loaded');
    await host.waitForSelector('.title-login input'); mark('title ready'); await host.click('.title-login input'); await host.keyboard.type('AI Policy');
    await host.evaluate(() => [...document.querySelectorAll('.title-login button')].find(e => e.textContent.includes('开始')).click()); mark('start clicked');
    await host.waitForSelector('.lobby-screen');
    mark('lobby visible');
    t.diagnostic('host entered lobby');
    await host.waitForFunction(() => globalThis.__SP__?.store.get().me.playerId);
    await host.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
    await host.waitForSelector('.rs-pill__gear'); await host.click('.rs-pill__gear');
    assert.equal(await host.$eval('[name=ai-takeover]', e => e.disabled), false, 'default host policy allows opting in');
    await consolePage.bringToFront(); await consolePage.goto(admin.url, { waitUntil: 'domcontentloaded' }); await consolePage.click('[data-tab=settings]');
    await consolePage.waitForSelector('#ai-takeover-allowed');
    assert.equal(await consolePage.$eval('#ai-takeover-allowed', e => e.checked), true, 'host console defaults checked');
    mark('console ready');
    t.diagnostic('console setting opened');
    assert.equal(await consolePage.$eval('#ai-takeover-settings', e => e.closest('.settings-group').id), 'settings-game');
    const save = async value => {
      await consolePage.bringToFront();
      await consolePage.waitForFunction(() => !document.querySelector('[data-ai-takeover-save]').disabled);
      if (await consolePage.$eval('#ai-takeover-allowed', e => e.checked) !== value) await consolePage.click('#ai-takeover-allowed');
      const response = consolePage.waitForResponse(r => r.url().endsWith('/api/settings') && r.request().method() === 'POST');
      await consolePage.evaluate(() => document.querySelector('[data-ai-takeover-save]').click());
      assert.equal((await (await response).json()).allowAiTakeover, value);
      await consolePage.waitForFunction(() => document.querySelector('#ai-takeover-saved').textContent.startsWith('已保存'));
    };
    await save(true);
    mark('saved on');
    t.diagnostic('host policy enabled');
    await host.bringToFront();
    await host.waitForFunction(() => document.querySelector('[name=ai-takeover]')?.disabled === false);
    await host.click('[name=ai-takeover]');
    await host.waitForFunction(() => globalThis.__SP__.store.get().room.aiTakeoverEnabled === true);
    mark('room enabled'); await consolePage.bringToFront();
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).allowAiTakeover, true);
    await consolePage.reload({ waitUntil: 'domcontentloaded' }); await consolePage.click('[data-tab=settings]');
    await consolePage.waitForSelector('#ai-takeover-allowed'); assert.equal(await consolePage.$eval('#ai-takeover-allowed', e => e.checked), true);
    await save(false); await host.bringToFront(); await host.waitForFunction(() => document.querySelector('[name=ai-takeover]')?.disabled === true);
    mark('saved off');
    assert.equal(await host.$eval('[name=ai-takeover]', e => e.checked), false);
    await consolePage.bringToFront(); await save(true); await host.bringToFront();
    mark('re-enabled');
    await host.evaluate(() => globalThis.__SP__.net.request('room.leave'));
    mark('left room');
    await host.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL', version: 'act1autochess' }));
    mark('historical room created');
    await host.waitForSelector('.rs-pill__gear');
    if (!await host.$('.rs-opts')) await host.click('.rs-pill__gear');
    assert.equal(await host.$eval('[name=ai-takeover]', e => e.disabled), true);
    assert.match(await host.$eval('[name=ai-takeover]', e => e.closest('label').textContent), /仅第二期下半/);
    await consolePage.bringToFront();
    await consolePage.setRequestInterception(true);
    const fail = req => req.url().endsWith('/api/settings') && req.method() === 'POST' ? req.abort() : req.continue(); consolePage.on('request', fail);
    await consolePage.click('#ai-takeover-allowed'); await consolePage.click('[data-ai-takeover-save]');
    await consolePage.waitForFunction(() => document.querySelector('#ai-takeover-saved').textContent.startsWith('保存失败'));
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).allowAiTakeover, true);
    await consolePage.setRequestInterception(false); consolePage.off('request', fail);
    await consolePage.click('[data-ai-takeover-reset]'); assert.equal(await consolePage.$eval('#ai-takeover-allowed', e => e.checked), true);
    fs.mkdirSync('.cache/ui-fixes-20261026', { recursive: true });
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await consolePage.setViewport({ width: w, height: h });
      await consolePage.$eval('#ai-takeover-settings', e => e.scrollIntoView({ block: 'center' }));
      assert.equal(await consolePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await consolePage.screenshot({ path: '.cache/ui-fixes-20261026/admin-ai-' + w + '.png' });
    }
    assert.deepEqual(errors, []);
  } catch (error) {
    mark('ERROR: ' + error.stack); throw error;
  } finally { if (srv) for (const c of srv.network.conns.values()) c.ws.terminate(); await browser?.close(); await admin?.close(); srv?.server.closeAllConnections(); await srv?.close(); resetHostSettings(); if (prior === undefined) delete process.env.SP_AI_TAKEOVER; else process.env.SP_AI_TAKEOVER = prior; fs.rmSync(dir, { recursive: true, force: true }); }
});
