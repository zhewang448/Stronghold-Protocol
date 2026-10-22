import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('backup console shows one responsive section, persists retention and reports rejected saves', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-backups-ui-'));
  let server, admin, browser;
  try {
    for (const [id, state, at] of [['release-good', 'verified', 2], ['release-restored', 'restored', 1]]) {
      const dir = path.join(root, 'logs/update-backups', id); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'restore.json'), JSON.stringify({ format: 2, files: [], existing: [], target: {}, state, at, from: 'v0.3.1-extended.6', to: 'v0.3.1-extended.7' }));
    }
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
    server.lobby.staticOptions = { ...server.lobby.staticOptions, publicDir: path.resolve('public'), dataDir: path.resolve('data'), sharedDir: path.resolve('shared') };
    admin = await startAdmin({ root, lobby: server.lobby, port: 0, resultsDir: root, settingsFile: path.join(root, 'settings.json'),
      log: { info() {}, warn() {}, error() {} }, updateOptions: { fetchImpl: async () => new Response('[]') } });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.click('[data-tab=settings]');
    await page.waitForSelector('#update-backup-keep');
    assert.equal(await page.$$eval('#update-backups-settings', (els) => els.length), 1);
    assert.equal(await page.$eval('#update-backup-keep', (el) => el.value), '2');
    assert.equal(await page.$eval('[data-update-backup-delete=release-good]', (el) => el.disabled), true);
    assert.equal(await page.$eval('[data-update-backup-delete=release-restored]', (el) => el.disabled), false);
    await page.$eval('#update-backup-keep', (el) => { el.value = '4'; });
    await page.click('[data-update-backup-save]');
    await page.waitForFunction(() => document.querySelector('#update-backups-feedback')?.textContent.includes('已保存'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'logs/update-backup-settings.json'))).keep, 4);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.click('[data-update-backup-delete=release-restored]');
    assert.equal(fs.existsSync(path.join(root, 'logs/update-backups/release-restored')), true);
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('[data-update-backup-delete=release-restored]');
    await page.waitForFunction(() => !document.querySelector('[data-update-backup-delete=release-restored]'));
    assert.equal(fs.existsSync(path.join(root, 'logs/update-backups/release-restored')), false);
    await page.$eval('#update-backup-keep', (el) => { el.value = '0'; });
    await page.click('[data-update-backup-save]');
    await page.waitForFunction(() => document.querySelector('#update-backups-feedback')?.textContent.includes('操作失败'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'logs/update-backup-settings.json'))).keep, 4);
    const shots = path.resolve('.cache/update-backups'); fs.mkdirSync(shots, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      await page.$eval('#update-backups-settings', (el) => el.scrollIntoView());
      assert.equal(await page.$eval('#update-backups-settings', (el) => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: path.join(shots, `${name}.png`) });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await admin?.close(); await server?.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
