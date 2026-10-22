import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('round details: short hover, stable pinned scroll, live refresh, keyboard dismissal and touch', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000,
}, async t => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  fs.mkdirSync('.cache/migration/round-details', { recursive: true });
  try {
    for (const [width, height, touch] of [[1440, 900, false], [844, 390, true], [640, 360, true]]) await t.test(`${width}x${height}`, async () => {
      const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      page.setDefaultTimeout(15000);
      try {
        await page.setViewport({ width, height, hasTouch: touch, isMobile: touch });
        await page.goto(srv.url + '/dev/game-mock.html?phase=PREP&render=fallback&shot=1', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!globalThis.__SP_VIEW__);
        await page.evaluate(async () => {
          const [{ render, h }, { RoundHistoryPanel }] = await Promise.all([import('/vendor/preact.module.js'), import('/js/ui/roundHistory.js')]);
          const players = Array.from({ length: 20 }, (_, seat) => ({ playerId: 'p' + seat, seat, name: '博士' + (seat + 1) + '·长名称测试' }));
          let history = Array.from({ length: 8 }, (_, r) => ({ round: r + 1, players: players.map((p, i) => ({ ...p, alive: true, lp: 40 - r, funds: 10 + i + r, bonds: [] })) }));
          const show = () => render(h(RoundHistoryPanel, { history, players, onClose() { globalThis.__detailClosed = true; render(null, document.getElementById('app')); } }), document.getElementById('app'));
          globalThis.__updateRoundDetails = () => { history = history.map(x => ({ ...x, players: x.players.map(p => ({ ...p, lp: p.lp - 1 })) })); show(); };
          globalThis.__rewindRoundDetails = () => { history = history.slice(0, 1); show(); };
          show(); await document.fonts.ready;
        });
        await page.waitForSelector('.round-history .hit');
        await page.select('.round-history [data-k=group]', '');
        await page.$eval('.chart-wrap', e => e.scrollIntoView({ block: 'center' }));
        const geometry = () => page.$eval('.round-history', e => { const b = e.querySelector('.round-history__body'), s = e.querySelector('.chart-wrap svg').getBoundingClientRect(); return [b.clientWidth, b.scrollHeight, s.x, s.width, s.y]; });
        const before = await geometry();
        const point = await page.$eval('.hit', e => { const b = e.getBoundingClientRect(); return { x: b.left + b.width * .7, y: b.bottom - 15 }; });
        if (!touch) {
          await page.mouse.move(point.x, point.y);
          await page.waitForFunction(() => document.querySelector('.round-chart-tip')?.style.display === 'block');
          assert.equal(await page.$$eval('.tip-row', es => es.length), 4);
          assert.match(await page.$eval('.tip-hint', e => e.textContent), /20/);
          assert.deepEqual(await geometry(), before, 'preview cannot add chart scrollbars or move its trigger');
          await page.mouse.move(point.x, point.y + 2);
          assert.equal(await page.$eval('.tip', e => e.style.display), 'block');
          await page.mouse.move(0, 0);
          assert.equal(await page.$eval('.tip', e => e.style.display), 'none');
          await page.mouse.click(point.x, point.y);
        } else await page.touchscreen.tap(point.x, point.y);
        await page.waitForFunction(() => document.querySelector('.tip')?.dataset.pinned === 'true');
        assert.equal(await page.$$eval('.tip-row', es => es.length), 20);
        assert.deepEqual(await geometry(), before, 'full detail cannot change chart geometry');
        const title = await page.$eval('.tip-head b', e => e.textContent);
        const listPoint = await page.$eval('.tip-rows', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, height: r.height }; });
        if (touch) {
          const cdp = await page.createCDPSession();
          const start = listPoint.y + Math.min(35, listPoint.height / 4);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: listPoint.x, y: start }] });
          for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: listPoint.x, y: start - i * 10 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await cdp.detach();
        } else {
          await page.mouse.move(listPoint.x, listPoint.y);
          await page.mouse.wheel({ deltaY: 120 });
        }
        await page.waitForFunction(() => document.querySelector('.tip-rows').scrollTop > 0);
        assert.equal(await page.$eval('.tip', e => e.style.display), 'block', 'moving into and scrolling details never dismisses them');
        // Settle touch momentum before testing exact scroll restoration during a data refresh.
        await page.$eval('.tip-rows', e => new Promise(resolve => {
          let idle;
          const finish = () => { clearTimeout(idle); e.removeEventListener('scroll', reset); resolve(); };
          const reset = () => { clearTimeout(idle); idle = setTimeout(finish, 150); };
          e.addEventListener('scroll', reset); reset();
        }));
        await page.$eval('.tip-rows', e => { e.scrollTop = 120; });
        const scroll = await page.$eval('.tip-rows', e => e.scrollTop);
        assert.ok(scroll > 0, 'only the long detail list scrolls');
        const detail = await page.$('.tip'), close = await page.$('.tip-close'); await close.focus();
        const previousValue = await page.$eval('.tip-row .v', e => e.textContent);
        await page.evaluate(() => globalThis.__updateRoundDetails());
        await page.waitForFunction(value => document.querySelector('.tip-row .v')?.textContent !== value, {}, previousValue);
        assert.equal(await detail.evaluate(e => e.isConnected && e.style.display === 'block'), true);
        assert.equal(await close.evaluate(e => e === document.activeElement), true);
        assert.equal(await page.$eval('.tip-rows', e => e.scrollTop), scroll);
        assert.equal(await page.$eval('.tip-head b', e => e.textContent), title);
        const nextPoint = await page.$eval('.hit', e => { const b = e.getBoundingClientRect(); return { x: b.right - 4, y: b.bottom - 15 }; });
        if (touch) await page.touchscreen.tap(nextPoint.x, nextPoint.y); else await page.mouse.click(nextPoint.x, nextPoint.y);
        assert.match(await page.$eval('.tip-head b', e => e.textContent), /第 8 回合/, 'clicking another round updates the fixed detail');
        assert.ok(await page.$eval('.tip', e => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1; }));
        await page.screenshot({ path: `.cache/migration/round-details/pinned-${width}.png` });
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval('.tip', e => e.style.display), 'none');
        assert.equal(await page.evaluate(() => !!globalThis.__detailClosed), false, 'first Escape closes only details');
        await page.$eval('.chart-wrap svg', e => e.focus()); await page.keyboard.press('Enter');
        assert.equal(await page.$eval('.tip-head b', e => e.textContent).then(s => /第 1 回合/.test(s)), true);
        await page.keyboard.press('ArrowRight');
        assert.match(await page.$eval('.tip-head b', e => e.textContent), /第 2 回合/);
        await page.click('.tip-close');
        assert.equal(await page.$eval('.tip', e => e.style.display), 'none');
        await page.keyboard.press('Enter');
        await page.click('.round-history__tabs button:first-child');
        assert.equal(await page.$eval('.tip', e => e.style.display), 'none', 'outside click closes the pinned detail');
        await page.$eval('.chart-wrap svg', e => e.focus()); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowRight');
        await page.evaluate(() => globalThis.__rewindRoundDetails());
        await page.waitForFunction(() => document.querySelector('.tip').style.display === 'none');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => globalThis.__detailClosed), true);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); await srv.close(); }
});
