import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { resetHostSettings, getShowPwaInstall } from '../../server/match/hostSettings.js';
import { CHROME, OUT, hasChrome } from '../e2e/client.mjs';

test('console installation switch updates title, lobby and rotation entry live and preserves failed drafts', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-pwa-settings-ui-'));
  const settingsFile = path.join(dir, 'settings.json');
  let server, admin, browser;
  resetHostSettings();
  t.after(async () => {
    await browser?.close(); await admin?.close(); await server?.close(); resetHostSettings();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch, recovery: false });
  admin = await startAdmin({ lobby: server.lobby, network: server.network, port: 0, resultsDir: dir, settingsFile,
    updateOptions: { fetchImpl: async () => new Response('[]') }, log: { info() {}, error() {} } });
  browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const consolePage = await browser.newPage(), title = await browser.newPage();
  const lobbyContext = await browser.createBrowserContext(), lobby = await lobbyContext.newPage();
  const errors = [];
  for (const page of [consolePage, title, lobby]) { page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); }
  await consolePage.setViewport({ width: 1440, height: 900 });
  await title.setViewport({ width: 1280, height: 800 });
  await lobby.setViewport({ width: 844, height: 390, hasTouch: true });
  await lobby.evaluateOnNewDocument(() => { localStorage.setItem('sp.name', 'Install Policy'); sessionStorage.setItem('sp.entered', '1'); });
  const base = `http://127.0.0.1:${server.port}`;
  await Promise.all([consolePage.goto(admin.url, { waitUntil: 'domcontentloaded' }),
    title.goto(base, { waitUntil: 'domcontentloaded' }), lobby.goto(base, { waitUntil: 'domcontentloaded' })]);
  t.diagnostic('console, title and lobby loaded');
  await consolePage.bringToFront();
  await consolePage.click('[data-tab="settings"]');
  t.diagnostic('settings selected');
  await consolePage.waitForSelector('#pwa-install-visible');
  t.diagnostic('settings form ready');
  assert.equal(await consolePage.$eval('#pwa-install-visible', e => e.checked), true);
  assert.equal(await consolePage.$eval('#pwa-install-settings', e => e.closest('.settings-group').id), 'settings-system');
  await title.waitForFunction(() => ['connected', 'online'].includes(globalThis.__SP__?.store.get().connection.status));
  t.diagnostic('title online');
  await lobby.waitForSelector('.lobby-screen [data-testid="pwa-install"]');
  t.diagnostic('lobby entry ready');
  await title.waitForSelector('.title-screen [data-testid="pwa-install"]');
  await title.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => ({ outcome: 'dismissed' }); dispatchEvent(e);
  });
  await title.waitForFunction(() => !document.getElementById('rotate-hint-pwa').hidden);
  t.diagnostic('initial entries visible');
  const save = async enabled => {
    const checked = await consolePage.$eval('#pwa-install-visible', e => e.checked);
    if (checked !== enabled) await consolePage.click('#pwa-install-visible');
    await consolePage.click('[data-pwa-install-save]');
    await consolePage.waitForFunction(() => !document.querySelector('[data-pwa-install-save]').disabled);
    assert.match(await consolePage.$eval('#pwa-install-saved', e => e.textContent), /已保存/);
  };
  await save(false);
  t.diagnostic('disabled in console');
  for (const page of [title, lobby]) await page.waitForSelector('[data-testid="pwa-install"]', { hidden: true });
  assert.equal(await title.$eval('#rotate-hint-pwa', e => e.hidden), true);
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).showPwaInstall, false);
  await title.reload({ waitUntil: 'domcontentloaded' });
  try {
    await title.waitForFunction(() => ['connected', 'online'].includes(globalThis.__SP__?.store.get().connection.status));
  } catch (error) {
    t.diagnostic(JSON.stringify(await title.evaluate(() => ({ status: globalThis.__SP__?.store.get().connection, boot: document.getElementById('boot-err')?.textContent, text: document.body.innerText.slice(0, 400) }))) + JSON.stringify(errors));
    throw error;
  }
  assert.equal(await title.$('[data-testid="pwa-install"]'), null, 'disabled policy survives a page reload');
  await consolePage.reload({ waitUntil: 'domcontentloaded' }); await consolePage.click('[data-tab="settings"]');
  await consolePage.waitForSelector('#pwa-install-visible');
  assert.equal(await consolePage.$eval('#pwa-install-visible', e => e.checked), false);
  await consolePage.click('#pwa-install-visible'); await consolePage.click('[data-pwa-install-reset]');
  assert.equal(await consolePage.$eval('#pwa-install-visible', e => e.checked), false);
  await save(true);
  t.diagnostic('re-enabled after reload');
  for (const page of [title, lobby]) await page.waitForSelector('[data-testid="pwa-install"]', { visible: true });
  // A network failure leaves the persisted policy and user's checkbox draft intact for retry.
  await consolePage.setRequestInterception(true);
  const failSave = req => req.url().endsWith('/api/settings') && req.method() === 'POST' ? req.abort() : req.continue();
  consolePage.on('request', failSave);
  await consolePage.click('#pwa-install-visible'); await consolePage.click('[data-pwa-install-save]');
  await consolePage.waitForFunction(() => document.querySelector('#pwa-install-saved').textContent.includes('保存失败'));
  assert.equal(getShowPwaInstall(), true);
  assert.equal(await consolePage.$eval('#pwa-install-visible', e => e.checked), false);
  await consolePage.setRequestInterception(false); consolePage.off('request', failSave);
  await consolePage.click('[data-pwa-install-reset]');
  t.diagnostic('failed save retains draft and resets');
  assert.equal(await consolePage.$eval('#pwa-install-visible', e => e.checked), true);
  fs.mkdirSync(OUT, { recursive: true });
  for (const [label, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    await consolePage.setViewport({ width, height });
    await consolePage.$eval('#pwa-install-settings', e => e.scrollIntoView({ block: 'center' }));
    assert.equal(await consolePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label);
    await consolePage.screenshot({ path: path.join(OUT, `admin-pwa-settings-${label}.png`) });
  }
  assert.deepEqual(errors, []);
});
