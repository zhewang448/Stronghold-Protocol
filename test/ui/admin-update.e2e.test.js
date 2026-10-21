// Real browser controls against the update backend with tiny mocked release downloads; never updates this checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startAdmin } from '../../server/admin.js';
import { updatePaths } from '../../server/release-update.js';
import { CHROME, hasChrome, ROOT } from '../e2e/client.mjs';
import { tag, releaseFor, put } from '../helpers/release-fixture.js';
import { APP_VERSION } from '../../shared/constants.js';
import { RELEASE_TAG } from '../../server/release-version.js';

test('console shows delta choice, full downgrade/repair choice and actual fallback progress on desktop/mobile', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 30000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-delta-ui-'));
  put(root, 'package.json', JSON.stringify({ version: APP_VERSION }));
  const makeRelease = (target) => {
    const release = releaseFor(undefined, target), full = release.assets[0];
    full.size = 104857600;
    release.assets.unshift({ ...full, name: full.name.replace('-assets.zip', '-update.zip'), size: 1048576,
      browser_download_url: full.browser_download_url.replace('-assets.zip', '-update.zip') });
    const base = full.browser_download_url.replace(/[^/]+$/, '');
    release.assets.push({ name: 'SHA256SUMS.txt', browser_download_url: `${base}SHA256SUMS.txt` },
      { name: 'SHA256SUMS.txt.sig', browser_download_url: `${base}SHA256SUMS.txt.sig` });
    return release;
  };
  let admin, browser, report, finish;
  const older = 'v0.2.5';
  try {
    admin = await startAdmin({ root, port: 0, resultsDir: root, settingsFile: path.join(root, 'settings.json'),
      lobby: { rooms: new Map(), safeData: () => ({}), onMatchEnd() {},
        staticOptions: { publicDir: path.join(ROOT, 'public'), sharedDir: path.join(ROOT, 'shared') } },
      log: { warn() {}, error() {}, info() {} }, onUpdateReady() {}, updateOptions: {
        fetchImpl: async () => new Response(JSON.stringify([makeRelease(tag), makeRelease(RELEASE_TAG), makeRelease(older)])),
        stageRelease: async ({ progress }) => {
          report = progress;
          await new Promise(resolve => { finish = resolve; });
          throw new Error('test stops before installation');
        },
      } });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('dialog.release-notes[open]');
    await page.click('dialog.release-notes .release-notes__button--primary');
    await page.waitForSelector('#release-version-select');
    assert.match(await page.$eval('#release-update', el => el.textContent), /优先下载增量包/);
    for (const target of [older, RELEASE_TAG]) {
      await page.select('#release-version-select', target);
      const label = await page.$eval('#release-update .meta[style]', el => el.textContent);
      assert.match(label, /-assets\.zip/); assert.doesNotMatch(label, /-update\.zip/);
    }
    await page.select('#release-version-select', tag);
    await page.click('[data-update-install]');
    await page.waitForFunction(() => document.querySelector('[data-update-install]').disabled);
    assert.equal(typeof report, 'function');
    const fullName = `Stronghold-Protocol-${tag}-assets.zip`;
    report({ state: 'downloading', received: 1048576, size: 104857600, asset: fullName,
      fallback: true, fallbackReason: '本机文件与增量包基线不符：server/keep.js' });
    await page.waitForFunction(() => document.querySelector('#release-update').textContent.includes('已改用完整素材包'));
    assert.match(await page.$eval('#release-update .meta[style]', el => el.textContent), /-assets\.zip.*100\.0 MB/);
    const shots = path.resolve('.impeccable/review'); fs.mkdirSync(shots, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      await page.$eval('#release-update', el => el.scrollIntoView({ block: 'start' }));
      assert.ok(await page.$eval('#release-update', el => el.scrollWidth <= el.clientWidth), name);
      await page.screenshot({ path: path.join(shots, `update-delta-${name}.png`) });
    }
    finish();
    await page.waitForFunction(() => document.querySelector('#release-update-state').textContent.includes('test stops before installation'));
    assert.deepEqual(errors, []);
  } finally {
    finish?.();
    if (browser) await browser.close();
    if (admin) await admin.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('console Release updates: check/retry, confirmation/cancel, progress, restart token refresh, desktop/mobile', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 45000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-update-ui-'));
  put(root, 'package.json', JSON.stringify({ version: APP_VERSION }));
  const staticOptions = { publicDir: path.join(ROOT, 'public'), sharedDir: path.join(ROOT, 'shared') };
  const lobby = { rooms: new Map(), safeData: () => ({}), onMatchEnd() {}, staticOptions };
  let admin, browser, failed = true, downloads = 0, complete, restart = false;
  let options;
  const onReady = async () => {
    if (!restart) return;
    put(root, 'logs/release-version.json', JSON.stringify({ app: APP_VERSION, tag }));
    const port = admin.port;
    await admin.close();
    admin = await startAdmin({ ...options, port });
  };
  options = { lobby, port: 0, root, resultsDir: path.join(root, 'records'), settingsFile: path.join(root, 'logs', 'settings.json'), onUpdateReady: onReady,
    log: { warn() {}, error() {}, info() {} }, updateOptions: {
      fetchImpl: async () => failed ? new Response('', { status: 403 }) : new Response(JSON.stringify([releaseFor(), releaseFor(undefined, 'v0.2.5-extended.1'), releaseFor(undefined, 'v0.2.5')])),
      stageRelease: async ({ progress }) => {
        downloads++; progress({ state: 'downloading', received: 1000, size: 2000 });
        return new Promise((r) => { complete = () => r({ stage: root, tag }); });
      }, schedule: async () => {},
    } };
  try {
    admin = await startAdmin(options);
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('[data-update-check]:not([disabled])');
    assert.equal(await page.$eval('[data-update-install]', (el) => el.disabled), true);
    await page.click('[data-update-check]');
    await page.waitForFunction(() => document.querySelector('#release-update-state').textContent.includes('403'));
    failed = false;
    await page.click('[data-update-check]');
    await page.waitForSelector('[data-update-install]:not([disabled])');
    await page.click('#release-update summary');
    const shots = path.resolve('.impeccable/review'); fs.mkdirSync(shots, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      assert.ok(await page.$eval('#release-update', (el) => el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth), `${name} update controls fit`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} page fits`);
      await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
    }
    lobby.rooms.set('TEST', { match: { ended: false } });
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.click('[data-update-install]');
    await page.waitForFunction(() => document.querySelector('#release-update-state').textContent.includes('进行的对局'));
    assert.equal(downloads, 0, 'cancel never downloads');
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('[data-update-install]');
    await page.waitForFunction(() => document.querySelector('#release-update-state').textContent.includes('正在下载'));
    assert.equal(downloads, 1);
    assert.equal(await page.$eval('[data-update-install]', (el) => el.disabled), true);
    await page.click('[data-tab="rooms"]'); await page.click('[data-tab="settings"]');
    try { await page.waitForFunction(() => document.querySelector('#release-update-state')?.textContent.includes('正在下载')); }
    catch (e) {
      const response = await fetch(admin.url + '/api/update', { headers: { 'x-admin-token': admin.token } });
      const state = await response.text();
      const text = await page.$eval('body', el => el.innerText);
      throw new Error(JSON.stringify({ state, text, errors }), { cause: e });
    }
    lobby.rooms.clear(); restart = true; complete();
    try { await page.waitForFunction(() => document.querySelector('#release-update-state').textContent.includes('即将重启')); }
    catch (e) {
      const response = await fetch(admin.url + '/api/update', { headers: { 'x-admin-token': admin.token } });
      const state = await response.text();
      const text = await page.$eval('#release-update', el => el.innerText);
      throw new Error(JSON.stringify({ state, text, errors }), { cause: e });
    }
    try { await page.waitForSelector('[data-tab="rooms"][aria-pressed="true"]', { timeout: 10000 }); }
    catch (e) {
      const debug = await page.evaluate(() => ({ url: location.href, text: document.body.innerText, tabs: [...document.querySelectorAll('[data-tab]')].map((b) => [b.dataset.tab, b.getAttribute('aria-pressed')]) }));
      throw new Error(JSON.stringify({ debug, actualToken: admin.token, versionExists: fs.existsSync(updatePaths(root).version) }), { cause: e });
    }
    // The initial HTML has the rooms tab selected before the module finishes its top-level data fetch.
    await page.waitForFunction(() => !!document.querySelector('#status')?.textContent.trim());
    await page.click('[data-tab="settings"]');
    await page.waitForFunction((tag) => document.querySelector('#release-update')?.textContent.includes(tag), {}, tag);
    assert.deepEqual(errors, []);
    assert.equal(JSON.parse(fs.readFileSync(updatePaths(root).version)).tag, tag);
  } finally {
    restart = false;
    if (browser) await browser.close();
    if (admin) await admin.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('console first-open update prompt, refresh deduplication, version choice, downgrade cancellation and saved proxy settings', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 30000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-update-open-ui-'));
  put(root, 'package.json', JSON.stringify({ version: APP_VERSION }));
  let browser, admin, queries = 0, downloads = 0;
  try {
    admin = await startAdmin({ lobby: { rooms: new Map(), safeData: () => ({}), onMatchEnd() {},
      staticOptions: { publicDir: path.join(ROOT, 'public'), sharedDir: path.join(ROOT, 'shared') } }, port: 0, root,
      resultsDir: root, settingsFile: path.join(root, 'settings.json'), onUpdateReady() {}, updateOptions: {
        fetchImpl: async () => { queries++; return new Response(JSON.stringify([releaseFor(), releaseFor(undefined, 'v0.2.5'), releaseFor(undefined, RELEASE_TAG)])); },
        stageRelease: async () => { downloads++; throw new Error('test stops before install'); },
      } });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage(), prompts = [], errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', async (dialog) => { prompts.push(dialog.message()); if (dialog.message().startsWith('发现新版本')) await dialog.accept(); else await dialog.dismiss(); });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('dialog.release-notes[open]');
    assert.match(await page.$eval('dialog.release-notes .release-notes__body', el => el.textContent), /发现新版本/);
    await page.click('dialog.release-notes .release-notes__button--primary');
    await page.waitForSelector('[data-tab="settings"][aria-pressed="true"]');
    await page.waitForSelector('#release-version-select');
    assert.equal(queries, 1); assert.equal(prompts.length, 0);
    const choices = await page.$$eval('#release-version-select option', (els) => els.map((el) => el.textContent));
    assert.ok(choices.some((s) => s.includes('新版本')));
    assert.ok(choices.some((s) => s.includes('当前版本')));
    assert.ok(choices.some((s) => s.includes('旧版本')));
    await page.select('#release-version-select', 'v0.2.5');
    assert.equal(await page.$eval('[data-update-install]', (el) => el.textContent), '回退并重启');
    await page.click('[data-update-install]');
    await page.waitForFunction(() => document.querySelector('[data-update-install]').disabled === false);
    assert.equal(downloads, 0); assert.match(prompts[0], /回退到 v0.2.5/);
    await page.click('#release-update summary');
    await page.$eval('#update-proxy', (el) => { el.value = 'socks5://127.0.0.1:7890'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('[data-update-network-save]');
    await page.waitForFunction(() => document.querySelector('#update-network-feedback').textContent.includes('HTTP/HTTPS'));
    assert.equal(await page.$eval('#update-proxy', (el) => el.value), 'socks5://127.0.0.1:7890', 'failed save retains draft');
    await page.$eval('#update-proxy', (el) => { el.value = 'http://127.0.0.1:7890'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('[data-update-network-save]');
    await page.waitForFunction(() => document.querySelector('#update-network-feedback').textContent === '已保存');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.click('[data-tab="settings"]');
    await page.waitForFunction(() => document.querySelector('#update-proxy')?.value === 'http://127.0.0.1:7890/');
    assert.equal(queries, 1, 'page refresh does not query GitHub again');
    assert.equal(prompts.length, 1, 'page refresh does not repeat update reminder');
    assert.equal(await page.$('dialog.release-notes[open]'), null);
    assert.deepEqual(errors, []);
    assert.equal(JSON.parse(fs.readFileSync(updatePaths(root).network)).proxy, 'http://127.0.0.1:7890/');
    await page.select('#release-version-select', RELEASE_TAG);
    assert.equal(await page.$eval('[data-update-install]', el => el.textContent), '修复素材并重启');
    await page.click('[data-update-install]');
    await page.waitForFunction(() => document.querySelector('#release-update-state').textContent.includes('test stops before install'));
    assert.equal(downloads, 1, 'current-version repair reaches the real authenticated install API');
  } finally {
    if (browser) await browser.close();
    if (admin) await admin.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
