import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('monitor wall fits each replacement frame after paging, resizing, fullscreen and restarting a match', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-wall-pages-'));
  const h = makeMatch({ humans: 20, fake: true, seed: 4242 }).start().toPrep();
  const room = { code: 'TEST', seats: h.m.order.map(p => ({ seat: p.seat, playerId: p.playerId, name: p.name })), match: h.m };
  const lobby = { rooms: new Map([['TEST', room]]), safeData: () => h.m.data, onMatchEnd() {} };
  let browser, admin;
  try {
    admin = await startAdmin({ lobby, port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(10000);
    // The production wall wraps a fixed desktop viewport. A labelled edge fixture isolates its geometry
    // from game assets / simulator timing; next-features.e2e separately checks the actual live renderer.
    await page.setRequestInterception(true);
    let fixtureFrames = true;
    page.on('request', req => {
      const url = new URL(req.url());
      if (fixtureFrames && url.pathname === '/live') {
        const id = url.searchParams.get('playerId');
        void req.respond({ status: 200, contentType: 'text/html', body: `<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101311;color:#dfe6e2;font:32px system-ui}main{box-sizing:border-box;position:absolute;inset:0;border:8px solid #64d5af;display:grid;place-items:center}span{position:absolute;font-size:22px}.tl{left:12px;top:12px}.tr{right:12px;top:12px}.bl{left:12px;bottom:12px}.br{right:12px;bottom:12px}</style><main>${id}<span class=tl>左上</span><span class=tr>右上</span><span class=bl>左下</span><span class=br>右下</span></main>` });
      } else void req.continue();
    });
    const fit = async () => {
      await page.waitForFunction(() => document.querySelectorAll('iframe').length === 4 && [...document.querySelectorAll('.viewport')].every(v => {
        const f = v.querySelector('iframe'); if (!f?.style.transform) return false;
        const a = v.getBoundingClientRect(), b = f.getBoundingClientRect();
        return b.width > 0 && b.left >= a.left - 1 && b.top >= a.top - 1 && b.right <= a.right + 1 && b.bottom <= a.bottom + 1
          && (Math.abs(b.width - a.width) < 2 || Math.abs(b.height - a.height) < 2);
      }));
      const frames = await Promise.all((await page.$$('iframe')).map(e => e.contentFrame()));
      await Promise.all(frames.map(f => f.waitForSelector(fixtureFrames ? 'main' : '.shopbar')));
      assert.deepEqual(await Promise.all(frames.map(f => f.evaluate(() => [innerWidth, innerHeight]))), Array(4).fill([1280, 720]));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    };
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.goto(admin.url + '/wall?room=TEST', { waitUntil: 'domcontentloaded' });
    await fit();
    fs.mkdirSync('.cache/migration/wall-pages', { recursive: true });
    for (const index of ['1', '4', '2', '0', '3', '1']) {
      const previous = await page.$$('iframe');
      await page.select('#wall-page select', index); await fit();
      assert.ok((await Promise.all(previous.map(f => f.evaluate(e => !e.isConnected)))).every(Boolean), 'paging unloads all old observers');
      const ids = await page.$$eval('iframe', es => es.map(e => new URL(e.src).searchParams.get('playerId')));
      assert.deepEqual(ids, Array.from({ length: 4 }, (_, i) => 'p_' + (Number(index) * 4 + i)));
    }
    await page.screenshot({ path: '.cache/migration/wall-pages/page-5-8.png', fullPage: true });
    for (const [width, height] of [[1440, 900], [844, 390], [640, 360], [1920, 1080]]) {
      await page.setViewport({ width, height }); await fit();
      await page.select('#wall-page select', '4'); await fit();
      await page.select('#wall-page select', '1'); await fit();
    }
    await page.click('.seat button');
    await page.waitForFunction(() => !!document.fullscreenElement); await fit();
    await page.screenshot({ path: '.cache/migration/wall-pages/fullscreen.png' });
    await page.select('#wall-page select', '2'); await fit();
    await page.evaluate(() => document.exitFullscreen()); await fit();
    room.match = null;
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
    room.match = h.m; await fit();
    fixtureFrames = false;
    await page.select('#wall-page select', '4');
    await fit();
    const liveFrames = await Promise.all((await page.$$('iframe')).map(e => e.contentFrame()));
    await Promise.all(liveFrames.map(f => f.waitForSelector('.shopbar')));
    assert.deepEqual(await Promise.all(liveFrames.map(f => f.evaluate(async () => (await import('/js/store.js')).store.get().me.playerId))), ['p_16', 'p_17', 'p_18', 'p_19']);
    await fit();
    await page.screenshot({ path: '.cache/migration/wall-pages/real-page-17-20.png', fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await admin?.close(); h.m.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
});
