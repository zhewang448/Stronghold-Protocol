import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('console overview polls current connection despite stale match state', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-admin-presence-'));
  const h = makeMatch({ humans: 2, bots: 1, fake: true }).start().toPrep();
  const seats = h.m.order.map(p => ({ seat: p.seat, playerId: p.playerId, name: p.name, isBot: p.isBot, connected: p.connected, left: false }));
  const room = { code: 'TEST', mode: 'coop', difficulty: 'NORMAL', seats, spectators: [], match: h.m };
  const session = { accessDomain: 'old.example.com:8443' };
  const admin = await startAdmin({ lobby: { rooms: new Map([['TEST', room]]), registry: { all: () => [], byId: id => id === 'p_0' ? session : null }, safeData: () => h.m.data, onMatchEnd() {} },
    port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'),
    updateOptions: { fetchImpl: async () => new Response('[]') }, log: { info() {}, error() {} } });
  let browser;
  t.after(async () => { await browser?.close(); await admin.close(); h.m.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
  const expectStatus = async status => {
    await page.waitForFunction((lp, expected) => {
      const text = document.querySelector('.room-summary tbody')?.textContent || '';
      return text.includes('P0 · LP ' + lp + ' · ' + expected);
    }, { timeout: 10000 }, h.ps('p_0').lp, status);
  };
  await expectStatus('在线');
  await page.waitForFunction(() => document.querySelector('.player-access')?.textContent === '接入：old.example.com:8443');
  assert.equal(await page.$$eval('.room-summary .player-access', els => els.length), 2);
  seats[0].connected = false;
  await expectStatus('离线');
  await page.waitForFunction(() => document.querySelector('.player-access')?.textContent === '上次接入：old.example.com:8443');
  assert.equal(h.ps('p_0').connected, true);
  h.ps('p_0').connected = false;
  seats[0].connected = true;
  session.accessDomain = 'new.example.com';
  await expectStatus('在线');
  await page.waitForFunction(() => document.querySelector('.player-access')?.textContent === '接入：new.example.com');
  assert.equal(h.ps('p_0').connected, false);
  seats[0].left = true;
  await expectStatus('离线');
  seats[0].left = false;
  h.ps('p_0').alive = false;
  await expectStatus('在线');
  await page.click('[data-open-room]');
  await page.waitForSelector('.player-summary .player-access');
  assert.equal(await page.$$eval('.player-summary .player-access', els => els.length), 2);
  fs.mkdirSync('.cache/console-ui', { recursive: true });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewport({ width, height });
    await page.screenshot({ path: '.cache/console-ui/admin-domain-normal-' + width + '.png', fullPage: true });
  }
  session.accessDomain = 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.example.com:8443';
  await page.waitForFunction(() => document.querySelector('.player-access')?.textContent.includes('bbbbbbbb'));
  fs.mkdirSync('.cache/console-ui', { recursive: true });
  for (const [width, height] of [[1440, 900], [720, 700], [390, 844]]) {
    await page.setViewport({ width, height });
    await page.screenshot({ path: '.cache/console-ui/admin-presence-' + width + '.png', fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.player-access')].every(el => {
      const style = getComputedStyle(el);
      return style.display === 'block' && style.fontSize === '12px' && style.overflowWrap === 'anywhere' && el.scrollWidth <= el.clientWidth + 1;
    })));
  }
  room.match = null;
  session.accessDomain = 'waiting.example.com';
  await page.waitForFunction(() => document.querySelector('#rooms > section:last-child .player-access')?.textContent === '接入：waiting.example.com');
  session.accessDomain = null;
  await page.waitForFunction(() => document.querySelector('#rooms > section:last-child .player-access')?.textContent === '接入：未知');
  assert.deepEqual(errors, []);
});
