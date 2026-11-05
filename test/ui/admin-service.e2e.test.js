import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('service buttons: desktop/mobile, cancellation, failure recovery, restart reload and shutdown status', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 30000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-service-ui-'));
  let admin, browser, actions = [], fail = true;
  const options = { lobby: { rooms: new Map(), onMatchEnd() {}, safeData: () => ({}) }, port: 0,
    resultsDir: root, settingsFile: path.join(root, 'settings.json'), log: { error() {}, warn() {}, info() {} },
    updateOptions: { fetchImpl: async () => new Response('[]') }, service: {
      prepare: async (action) => {
        if (fail) throw new Error('测试准备失败');
        return { run: async () => {
          actions.push(action);
          const port = admin.port;
          await admin.close();
          if (action === 'restart') admin = await startAdmin({ ...options, port });
        } };
      },
    } };
  try {
    admin = await startAdmin(options);
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run', ...(CHROME.toLowerCase().includes('msedge') ? ['--edge-skip-compat-layer-relaunch'] : [])] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.click('[data-tab="server"]');
    await page.waitForSelector('[data-service="restart"]:not([disabled])');
    const shots = path.resolve('.impeccable/review'); fs.mkdirSync(shots, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} fits viewport`);
      assert.ok(await page.$eval('.service-bar', (el) => el.getBoundingClientRect().bottom < innerHeight));
      assert.ok(await page.$eval('[data-service="shutdown"]', (el) => el.getBoundingClientRect().height >= 36));
      await page.screenshot({ path: path.join(shots, `service-${name}.png`), fullPage: true });
    }
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.click('[data-service="shutdown"]');
    assert.deepEqual(actions, []);
    assert.equal(await page.$eval('[data-service="restart"]', (el) => el.disabled), false);
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('[data-service="restart"]');
    await page.waitForFunction(() => document.querySelector('#service-status').textContent.includes('测试准备失败'));
    await page.waitForSelector('[data-service="restart"]:not([disabled])');
    fail = false;
    const token = await page.$eval('script:last-of-type', (script) => script.textContent.match(/const TOKEN = '([^']+)'/)[1]);
    await page.click('[data-tab="server"]');
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('[data-service="restart"]');
    await page.waitForFunction((old) => !document.querySelector('script:last-of-type').textContent.includes(`const TOKEN = '${old}'`), {}, token);
    assert.deepEqual(actions, ['restart']);
    await page.click('[data-tab="server"]');
    await page.waitForSelector('[data-service="shutdown"]:not([disabled])');
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('[data-service="shutdown"]');
    await page.waitForFunction(() => document.querySelector('#service-status').textContent.includes('服务已关闭'));
    assert.deepEqual(actions, ['restart', 'shutdown']);
    assert.equal(await page.$eval('[data-service="restart"]', (el) => el.disabled), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(shots, 'service-closed.png'), fullPage: true });
  } finally {
    if (browser) await browser.close();
    if (admin) await admin.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
