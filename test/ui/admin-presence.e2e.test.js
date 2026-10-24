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
  const admin = await startAdmin({ lobby: { rooms: new Map([['TEST', room]]), safeData: () => h.m.data, onMatchEnd() {} },
    port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'),
    updateOptions: { fetchImpl: async () => new Response('[]') }, log: { info() {}, error() {} } });
  t.after(async () => { await admin.close(); h.m.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
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
  seats[0].connected = false;
  await expectStatus('离线');
  assert.equal(h.ps('p_0').connected, true);
  h.ps('p_0').connected = false;
  seats[0].connected = true;
  await expectStatus('在线');
  assert.equal(h.ps('p_0').connected, false);
  seats[0].left = true;
  await expectStatus('离线');
  seats[0].left = false;
  h.ps('p_0').alive = false;
  await expectStatus('在线');
  fs.mkdirSync('.cache/console-ui', { recursive: true });
  for (const [width, height] of [[1440, 900], [720, 700]]) {
    await page.setViewport({ width, height });
    await page.screenshot({ path: '.cache/console-ui/admin-presence-' + width + '.png', fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
});
