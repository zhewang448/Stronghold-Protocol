import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('console feedback animates manual actions, preserves records and recovers from failed requests', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-feedback-'));
  const h = makeMatch({ humans: 2, fake: true }).start().toPrep();
  const room = { code: 'TEST', mode: 'coop', difficulty: 'NORMAL', seats: [], spectators: [], match: h.m };
  const record = index => ({ savedAt: 1792800000000 + index, room: 'TEST', mode: 'coop', difficulty: 'NORMAL', history: [], result: { victory: false, roundsPassed: 1, durationMs: 1000, players: [{ playerId: 'p0', name: 'Doctor' }] } });
  fs.writeFileSync(path.join(dir, '20261024-TEST-1.json'), JSON.stringify(record(1)));
  const admin = await startAdmin({ lobby: { rooms: new Map([['TEST', room]]), safeData: () => h.m.data, onMatchEnd() {} }, port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'), updateOptions: { fetchImpl: async () => new Response('[]') }, log: { info() {}, error() {} } });
  let browser;
  t.after(async () => { await browser?.close(); await admin.close(); h.m.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(), errors = [], pending = new Set();
  let failSave = false, failResults = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    globalThis.feedbackAnimations = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      globalThis.feedbackAnimations.push({ id: this.id, tag: this.tagName, cls: typeof this.className === 'string' ? this.className : '', duration: options.duration, frames });
      return animate.call(this, frames, options);
    };
  });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const job = (async () => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname === '/api/settings') {
        await new Promise(resolve => setTimeout(resolve, 220));
        if (failSave) return request.abort();
      }
      if (pathname === '/api/results') {
        await new Promise(resolve => setTimeout(resolve, 220));
        if (failResults) return request.abort();
      }
      await request.continue();
    })();
    pending.add(job); job.catch(error => errors.push(error.message)).finally(() => pending.delete(job));
  });
  await page.goto(admin.url, { waitUntil: 'networkidle0' });
  await page.click('[data-open-room]');
  await page.waitForSelector('.player-summary');
  assert.equal(await page.evaluate(() => globalThis.feedbackAnimations.some(x => x.tag === 'SECTION' && x.duration === 140)), true, 'opening a room animates its details');
  await page.click('[data-toggle]');
  await page.waitForSelector('[data-act=lp]');
  assert.equal(await page.evaluate(() => globalThis.feedbackAnimations.some(x => x.tag === 'TD' && x.duration === 140)), true);
  assert.equal(await page.$eval('[data-toggle]', el => el.getAttribute('aria-expanded')), 'true');
  await page.evaluate(() => { globalThis.feedbackAnimations.length = 0; document.activeElement.blur(); });
  await page.waitForResponse(response => new URL(response.url()).pathname === '/api/rooms');
  assert.equal(await page.evaluate(() => globalThis.feedbackAnimations.length), 0, 'room polling does not replay animations');
  await page.click('[data-tab=settings]');
  await page.waitForSelector('#unite-layers-enabled');
  await page.click('[data-unite-layers-save]');
  assert.match(await page.$eval('#unite-layers-saved', el => el.textContent), /保存中/);
  await page.waitForFunction(() => document.querySelector('#unite-layers-saved').dataset.feedbackState === 'success');
  assert.equal(await page.evaluate(() => globalThis.feedbackAnimations.some(x => x.id === 'unite-layers-saved' && x.duration === 120)), true);
  await page.focus('.settings-preview > summary');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.settings-preview').open);
  await page.waitForFunction(() => globalThis.feedbackAnimations.some(x => x.id === 'prep-preview' && x.duration === 140));
  assert.equal(await page.evaluate(() => globalThis.feedbackAnimations.some(x => x.id === 'prep-preview' && x.duration === 140)), true, 'keyboard expansion receives the same feedback');
  await page.keyboard.press('Enter');
  failSave = true;
  await page.click('[data-unite-layers-save]');
  await page.waitForFunction(() => document.querySelector('#unite-layers-saved').dataset.feedbackState === 'error');
  assert.match(await page.$eval('#msg', el => el.textContent), /失败/);
  await page.waitForFunction(() => document.querySelector('#msg').style.display === 'none', { timeout: 7000 });
  assert.equal(await page.evaluate(() => globalThis.feedbackAnimations.some(x => x.id === 'msg' && x.duration === 100 && x.frames[1].opacity === 0)), true);
  failSave = false;
  await page.click('[data-tab=records]');
  await page.waitForSelector('#records-list tbody tr');
  await page.waitForFunction(() => !document.querySelector('[data-records-reload]').disabled);
  await page.evaluate(() => { globalThis.recordRow = document.querySelector('#records-list tbody tr'); });
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/results');
  await page.click('[data-records-reload]');
  assert.deepEqual(await page.$eval('[data-records-reload]', el => ({ text: el.textContent, busy: el.getAttribute('aria-busy'), disabled: el.disabled })), { text: '刷新中…', busy: 'true', disabled: true });
  assert.equal(await page.evaluate(() => globalThis.recordRow.isConnected), true);
  await refreshed;
  await page.waitForFunction(() => document.querySelector('[data-records-reload]').textContent === '已更新');
  assert.equal(await page.evaluate(() => document.querySelector('#records-list tbody tr') === globalThis.recordRow), true);
  fs.writeFileSync(path.join(dir, '20261024-TEST-2.json'), JSON.stringify(record(2)));
  await page.click('[data-records-reload]');
  await page.waitForFunction(() => document.querySelectorAll('#records-list tbody tr').length === 2);
  assert.equal(await page.evaluate(() => globalThis.feedbackAnimations.some(x => x.tag === 'TR' && x.frames[0].backgroundColor === '#214237')), true, 'new rows receive a bounded highlight');
  await page.waitForFunction(() => !document.querySelector('[data-records-reload]').disabled);
  failResults = true;
  await page.click('[data-records-reload]');
  await page.waitForFunction(() => document.querySelector('[data-records-reload]').textContent === '重试刷新');
  assert.equal(await page.$$eval('#records-list tbody tr', rows => rows.length), 2, 'failed refresh retains the records');
  await page.evaluate(() => { globalThis.toast = document.querySelector('#msg'); });
  await page.click('[data-records-reload]');
  await page.waitForFunction(() => !document.querySelector('[data-records-reload]').disabled);
  assert.equal(await page.evaluate(() => document.querySelector('#msg') === globalThis.toast && document.querySelectorAll('#msg').length === 1), true);
  failResults = false;
  await page.click('[data-records-reload]');
  await page.waitForFunction(() => document.querySelector('[data-records-reload]').textContent === '已更新');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.click('[data-tab=settings]');
  await page.evaluate(() => { globalThis.feedbackAnimations.length = 0; });
  await page.click('[data-unite-layers-save]');
  await page.waitForFunction(() => document.querySelector('#unite-layers-saved').dataset.feedbackState === 'success');
  assert.equal(await page.evaluate(() => globalThis.feedbackAnimations.some(x => x.id === 'unite-layers-saved' && x.duration === 70)), true);
  await page.click('[data-tab=rooms]');
  await page.evaluate(() => { globalThis.feedbackAnimations.length = 0; });
  await page.click('[data-toggle]');
  await page.click('[data-toggle]');
  assert.equal(await page.evaluate(() => { const animations = globalThis.feedbackAnimations.filter(x => x.tag === 'TD'); return animations.length > 0 && animations.every(x => x.duration === 70 && !x.frames.some(frame => frame.transform)); }), true);
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewport({ width, height });
    await page.click('[data-tab=settings]');
    await page.$eval('#unite-settings', el => el.scrollIntoView({ block: 'center' }));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    fs.mkdirSync('.cache/console-tab-lag-20261024', { recursive: true });
    await page.screenshot({ path: `.cache/console-tab-lag-20261024/feedback-${width}.png` });
  }
  await Promise.allSettled([...pending]);
  assert.deepEqual(errors, []);
});
