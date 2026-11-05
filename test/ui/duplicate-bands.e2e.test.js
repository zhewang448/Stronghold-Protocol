import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { startServer } from '../../server/index.js';

test('room duplicate strategy option: actual host/guest UI, keyboard, mobile, reconnect and repeated draft choice',
  { skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000 }, async t => {
    const output = path.resolve('.cache/dynamic-illustrations-new-operators/followup/duplicate-room'); fs.mkdirSync(output, { recursive: true });
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--edge-skip-compat-layer-relaunch'] });
    t.after(async () => { await browser.close(); await srv.close(); });
    const errors = [];
    const makePage = async name => {
      const context = await browser.createBrowserContext(), page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.setViewport({ width: 1440, height: 900 });
      await page.evaluateOnNewDocument(name => { localStorage.setItem('sp.name', name); sessionStorage.setItem('sp.entered', '1'); }, name);
      await page.goto(srv.url); await page.waitForFunction(() => window.__SP__?.store.get().connection.status === 'online'); return page;
    };
    const host = await makePage('Draft host'), guest = await makePage('Draft guest');
    const req = (page, type, body = {}) => page.evaluate(async (type, body) => (await import('/js/net.js')).net.request(type, body), type, body);
    await req(host, 'room.create', { mode: 'coop', difficulty: 'NORMAL' });
    const code = await host.evaluate(() => window.__SP__.store.get().room.code); await req(guest, 'room.join', { code });
    await host.waitForSelector('.rs-pill__gear'); await guest.waitForSelector('.rs-pill__gear');
    await host.click('.rs-pill__gear'); await guest.click('.rs-pill__gear');
    const selector = '[name="allow-duplicate-bands"]';
    assert.equal(await host.$eval(selector, e => e.checked), false);
    assert.equal(await guest.$eval(selector, e => e.disabled), true);
    await req(guest, 'room.ready', { ready: true });
    await host.focus(selector); await host.keyboard.press('Space');
    await guest.waitForFunction(() => document.querySelector('[name="allow-duplicate-bands"]').checked);
    const room = srv.lobby.rooms.get(code);
    assert.equal(room.seatOf(await guest.evaluate(() => window.__SP__.store.get().me.playerId)).ready, false);
    for (const [width, height] of [[1440, 900], [844, 390], [640, 360]]) {
      await host.setViewport({ width, height });
      const box = await host.$eval('.rs-opts', e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight }; });
      assert.ok(box.l >= -1 && box.r <= box.w + 1 && box.t >= -1 && box.b <= box.h + 1, JSON.stringify(box));
      await host.$eval(selector, e => e.scrollIntoView({ block: 'center' })); await host.screenshot({ path: path.join(output, `room-${width}.png`) });
    }
    await guest.reload(); await guest.waitForFunction(() => window.__SP__?.store.get().room?.allowDuplicateBands === true);
    await req(guest, 'room.ready', { ready: true }); await req(host, 'room.start');
    room.match.enterBandDraft(); room.match.flush(true);
    await Promise.all([host, guest].map(p => p.waitForSelector('[data-band="band_bldsk"]')));
    const byId = new Map([[await host.evaluate(() => window.__SP__.store.get().me.playerId), host], [await guest.evaluate(() => window.__SP__.store.get().me.playerId), guest]]);
    for (const pid of room.match.draft.groups[0].order) {
      const page = byId.get(pid);
      await page.waitForFunction(pid => window.__SP__.store.get().match.public.draft.turn === pid, {}, pid);
      assert.equal(await page.$eval('[data-band="band_bldsk"]', e => e.getAttribute('aria-disabled')), 'false');
      await page.click('[data-band="band_bldsk"]');
      const confirm = await page.$$('button');
      for (const button of confirm) if (await button.evaluate(e => e.textContent.trim() === '确认选择')) { await button.click(); break; }
      await page.waitForFunction(pid => window.__SP__.store.get().match.public.draft?.picks?.[pid] === 'band_bldsk' || window.__SP__.store.get().match.public.phase !== 'BAND_DRAFT', {}, pid);
    }
    assert.ok(room.match.order.every(p => p.bandId === 'band_bldsk'));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ code, defaultOff: true, hostOnly: true, keyboard: true, synchronized: true, reconnect: true, repeatedPicks: room.match.order.map(p => p.bandId), errors }, null, 2));
    assert.deepEqual(errors, []);
  });
