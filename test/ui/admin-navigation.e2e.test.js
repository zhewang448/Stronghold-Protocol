import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('console tabs remain responsive while APIs load and settings drafts survive navigation', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-admin-navigation-'));
  const h = makeMatch({ humans: 2, fake: true }).start().toPrep();
  const admin = await startAdmin({
    lobby: { rooms: new Map(), safeData: () => h.m.data, onMatchEnd() {} }, port: 0,
    resultsDir: path.join(dir, 'results'), settingsFile: path.join(dir, 'settings.json'),
    updateOptions: { fetchImpl: async () => new Response('[]') }, log: { info() {}, error() {} },
  });
  let browser;
  t.after(async () => {
    await browser?.close(); await admin.close(); h.m.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [], pending = new Set();
  let settingsRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(admin.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#rooms').textContent.includes('还没有房间'));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const task = (async () => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && ['/api/settings', '/api/results'].includes(url.pathname)) {
        if (url.pathname === '/api/settings') settingsRequests++;
        await new Promise(resolve => setTimeout(resolve, 700));
      }
      await request.continue();
    })();
    pending.add(task);
    task.catch(error => errors.push(error.message)).finally(() => pending.delete(task));
  });
  const visible = name => page.$eval('#' + name, element => !element.hidden);
  await page.click('[data-tab="settings"]');
  assert.equal(await visible('settings'), true, 'settings appears while its request is still pending');
  assert.equal(await page.$('#prep-form'), null);
  assert.equal(await page.$eval('#settings', element => element.getAttribute('aria-busy')), 'true');
  await page.click('[data-tab="server"]');
  await page.waitForSelector('#prep-form');
  await page.waitForFunction(() => !document.querySelector('#settings').hasAttribute('aria-busy'));
  assert.equal(await visible('server'), true, 'an old request cannot switch the selected tab');
  await page.click('[data-tab="settings"]');
  await page.$eval('#domain-canonical', element => { element.value = 'https://draft.example'; });
  await page.click('[data-tab="server"]');
  await page.click('[data-tab="settings"]');
  assert.equal(await page.$eval('#domain-canonical', element => element.value), 'https://draft.example');
  assert.equal(settingsRequests, 1, 'returning to settings keeps the existing form');
  await page.click('[data-tab="records"]');
  assert.equal(await visible('records'), true, 'records appears before the results request finishes');
  assert.notEqual(await page.$('#records-list'), null, 'the records page structure is present before data arrives');
  await page.click('[data-tab="server"]');
  await page.click('[data-tab="records"]');
  await page.waitForSelector('#records-list');
  await page.waitForFunction(() => !document.querySelector('#records').hasAttribute('aria-busy'));
  assert.equal(await visible('records'), true);
  assert.equal(await page.$eval('[data-tab="records"]', element => element.getAttribute('aria-pressed')), 'true');
  await page.select('#summary-mode', 'coop');
  await page.evaluate(() => {
    globalThis.__recordRefs__ = {
      filter: document.querySelector('#summary-mode'),
      summary: document.querySelector('#summary-data').firstElementChild,
      list: document.querySelector('#records-list').firstElementChild,
    };
  });
  await page.click('[data-tab="server"]');
  await page.click('[data-tab="records"]');
  await page.waitForNetworkIdle({ idleTime: 800 });
  assert.deepEqual(await page.evaluate(() => ({
    filterRetained: document.querySelector('#summary-mode') === globalThis.__recordRefs__.filter,
    filterValue: document.querySelector('#summary-mode').value,
    summaryRetained: document.querySelector('#summary-data').firstElementChild === globalThis.__recordRefs__.summary,
    listRetained: document.querySelector('#records-list').firstElementChild === globalThis.__recordRefs__.list,
  })), { filterRetained: true, filterValue: 'coop', summaryRetained: true, listRetained: true });
  const refreshDone = page.waitForResponse(response => new URL(response.url()).pathname === '/api/results');
  await page.click('[data-records-reload]');
  await refreshDone;
  await page.waitForNetworkIdle();
  assert.equal(await page.$eval('#summary-mode', element => element.value), 'coop', 'explicit refresh retains summary filters');
  assert.equal(await page.evaluate(() => document.querySelector('#records-list').firstElementChild === globalThis.__recordRefs__.list), true, 'unchanged results do not replace the list');
  await Promise.allSettled([...pending]);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  const motion = await page.evaluate(() => {
    document.querySelector('[data-tab="server"]').click();
    const animation = document.querySelector('#server').getAnimations()[0];
    return { visible: !document.querySelector('#server').hidden, duration: animation.effect.getTiming().duration, start: animation.effect.getKeyframes()[0].transform };
  });
  assert.deepEqual(motion, { visible: true, duration: 140, start: 'translateY(4px)' });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const reduced = await page.evaluate(() => {
    document.querySelector('[data-tab="records"]').click();
    const animation = document.querySelector('#records').getAnimations()[0];
    return { duration: animation.effect.getTiming().duration, start: animation.effect.getKeyframes()[0].transform, hiddenAnimations: [...document.querySelectorAll('main[hidden]')].reduce((sum, el) => sum + el.getAnimations().length, 0) };
  });
  assert.deepEqual(reduced, { duration: 70, start: 'none', hiddenAnimations: 0 });
  assert.deepEqual(errors, []);
});
