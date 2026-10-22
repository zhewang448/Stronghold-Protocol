import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { PLAYER_COLORS } from '../../public/js/ui/playerSeries.js';

test('twenty-seat statistics: group filters, pinned highlight, shared colors and landscape touch', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000,
}, async t => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const out = '.cache/migration/chart-groups'; fs.mkdirSync(out, { recursive: true });
  try {
    for (const [width, height, touch] of [[1440, 900, false], [844, 390, true], [640, 360, true]]) await t.test(`${width}x${height}`, async () => {
      const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000);
      try {
        await page.setViewport({ width, height, hasTouch: touch, isMobile: touch });
        await page.goto(srv.url + '/dev/game-mock.html?phase=PREP&render=fallback&shot=1', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!globalThis.__SP_VIEW__);
        await page.evaluate(async () => {
          const [{ render, h }, { RoundHistoryPanel }] = await Promise.all([import('/vendor/preact.module.js'), import('/js/ui/roundHistory.js')]);
          const players = Array.from({ length: 20 }, (_, seat) => ({ playerId: 'p' + seat, seat, name: '博士' + (seat + 1) }));
          const poolGroups = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, playerIds: players.slice(i * 4, i * 4 + 4).map(p => p.playerId) }));
          let history = Array.from({ length: 8 }, (_, r) => ({ round: r + 1, players: players.map((p, i) => ({ ...p,
            alive: true, lp: 40 - r * (i % 4 + 1), funds: 10 + r * (i + 1), dmg: (r + 1) * (i + 1) * 1000,
            units: [{ defId: 'unit' + i, name: '干员' + (i + 1), dmg: 1000 + i * 100, kills: i }], bonds: [],
          })) }));
          const show = () => render(h(RoundHistoryPanel, { history, players, poolGroups, viewerId: 'p17', onClose() {} }), document.getElementById('app'));
          globalThis.__updateGroupHistory = () => { history = history.map(x => ({ ...x, players: x.players.slice().reverse().map(p => ({ ...p, funds: p.funds + 5 })) })); show(); };
          show(); await document.fonts.ready;
        });
        const group = '.round-history [data-k="group"]', legend = '.round-history .chart-legend';
        await page.waitForSelector(legend + ' button');
        assert.equal(await page.$eval(group, e => e.value), '5', 'default is the viewer’s fixed group');
        assert.equal(await page.$$eval('.plot-series > g', es => es.length), 4);
        await page.$eval('.round-history__body', e => { e.scrollTop = 0; });
        await page.screenshot({ path: `${out}/controls-${width}.png` });
        await page.select(group, '');
        assert.deepEqual(await page.$$eval(legend + ' button', es => es.map(e => e.style.getPropertyValue('--c'))), PLAYER_COLORS);
        assert.equal(await page.$$eval('.plot-series > g', es => es.length), 20);
        await page.select(group, '5');
        const target = legend + ' button[data-player="p17"]';
        if (touch) await (await page.$(target)).tap(); else { await page.focus(target); await page.keyboard.press('Enter'); }
        assert.equal(await page.$eval(target, e => e.getAttribute('aria-pressed')), 'true');
        assert.equal(await page.$eval('.plot-series [data-series="p17"] polyline', e => e.getAttribute('stroke-width')), '4');
        assert.equal(await page.$eval('.plot-series [data-series="p16"]', e => e.getAttribute('opacity')), '.18');
        const button = await page.$(target); await button.focus();
        await page.evaluate(() => globalThis.__updateGroupHistory());
        await page.waitForFunction(() => document.querySelector('.plot-series [data-series="p17"] polyline')?.getAttribute('stroke-width') === '4');
        assert.equal(await button.evaluate(e => e.isConnected && e === document.activeElement), true, 'live refresh retains the selected legend and keyboard focus');
        assert.equal(await page.$eval(group, e => e.value), '5');
        assert.equal(await button.evaluate(e => e.style.getPropertyValue('--c')), PLAYER_COLORS[17]);
        if (touch) assert.ok(await button.evaluate(e => e.getBoundingClientRect().height >= 44));
        await page.$eval('.round-history .chart-wrap', e => e.scrollIntoView({ block: 'center' }));
        if (touch) await (await page.$('.round-history .hit')).tap(); else await page.hover('.round-history .hit');
        await page.waitForFunction(() => document.querySelector('.round-history .tip').style.display === 'block');
        assert.equal(await page.$$eval('.round-history .tip-row', es => es.length), 1, 'highlight limits the tooltip to the selected player');
        await page.screenshot({ path: `${out}/focused-${width}.png` });
        await page.$eval(target, e => e.scrollIntoView({ block: 'nearest' }));
        await page.click(target);
        assert.equal(await page.$eval('.plot-series [data-series="p16"]', e => e.getAttribute('opacity')), '1');
        await page.select(group, '2');
        assert.deepEqual(await page.$$eval(legend + ' button', es => es.map(e => e.style.getPropertyValue('--c'))), PLAYER_COLORS.slice(4, 8));
        await page.click('.round-history [data-k="table"]');
        assert.equal(await page.$$eval('.round-history thead th', es => es.length), 5);
        assert.deepEqual(await page.$$eval('.round-history .player-series-key', es => es.map(e => e.style.getPropertyValue('--c'))), PLAYER_COLORS.slice(4, 8));
        await page.click('.round-history__tabs button:nth-child(2)');
        await page.waitForSelector('.round-history [data-k="round"]');
        assert.equal(await page.$eval(group, e => e.value), '2', 'group persists across chart and rankings');
        assert.equal(await page.$$eval('.round-history tbody tr', es => es.length), 4);
        const rank = await page.$$eval('.round-history tbody tr', es => es.map(e => ({ color: e.querySelector('.dmg-bar').style.getPropertyValue('--c'), player: e.querySelector('.player-series-key').textContent })));
        for (const row of rank) assert.equal(row.color, PLAYER_COLORS[Number(row.player.match(/博士(\d+)/)[1]) - 1]);
        await page.select('.round-history [data-k="player"]', 'p7');
        await page.select(group, '3');
        assert.equal(await page.$eval('.round-history [data-k="player"]', e => e.value), '', 'switching groups clears an out-of-group player');
        assert.equal(await page.$$eval('.round-history tbody tr', es => es.length), 4);
        assert.ok(await page.$eval('.round-history', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: `${out}/ranking-${width}.png` });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('host console uses the same twenty-seat colors and filtering', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-group-chart-'));
      const h = makeMatch({ humans: 20, fake: true, seed: 4242 }).start().toPrep();
      const m = h.m;
      m.history = [1, 2].map(round => ({ round, players: m.order.map((p, i) => ({ playerId: p.playerId,
        alive: true, lp: 40 - round * (i % 4), units: [{ name: 'Operator ' + i, dmg: 100 + i, kills: 1 }], bonds: [],
      })) }));
      const lobby = { rooms: new Map([['TEST', { code: 'TEST', mode: 'coop', seats: [], spectators: [], match: m }]]), safeData: () => m.data, onMatchEnd() {} };
      const admin = await startAdmin({ lobby, port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
      const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      try {
        await page.setViewport({ width: 1440, height: 900 });
        await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-open-room]'); await page.click('[data-open-room]'); await page.click('[data-room-tab="data"]');
        const chart = '[data-part="chart"]'; await page.waitForSelector(chart + ' .plot-series');
        assert.equal(await page.$eval(chart + ' [data-k="group"]', e => e.value), '1');
        await page.select(chart + ' [data-k="group"]', '');
        await page.$eval(chart + ' .chart-wrap', e => e.scrollIntoView({ block: 'center' }));
        await page.hover(chart + ' .hit');
        await page.waitForFunction(() => document.querySelector('[data-part="chart"] .tip')?.style.display === 'block');
        assert.equal(await page.$$eval(chart + ' .tip-row', es => es.length), 4);
        await page.click(chart + ' .hit');
        assert.equal(await page.$$eval(chart + ' .tip-row', es => es.length), 20);
        await page.hover(chart + ' .tip-rows'); await page.mouse.wheel({ deltaY: 120 });
        await page.waitForFunction(() => document.querySelector('[data-part="chart"] .tip-rows').scrollTop > 0);
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval(chart + ' .tip', e => e.style.display), 'none');
        assert.deepEqual(await page.$$eval(chart + ' .chart-legend button', es => es.map(e => e.style.getPropertyValue('--c'))), PLAYER_COLORS);
        await page.click(chart + ' .chart-legend button:nth-child(20)');
        assert.equal(await page.$eval(chart + ' .plot-series > g:last-child polyline', e => e.getAttribute('stroke-width')), '4');
        await page.select('[data-part="unitRounds"] [data-k="group"]', '5');
        assert.equal(await page.$$eval('[data-part="unitRounds"] tbody tr', es => es.length), 4);
        const colors = await page.$$eval('[data-part="totals"] .player-series-key', es => es.map(e => e.style.getPropertyValue('--c')));
        assert.deepEqual(colors, PLAYER_COLORS);
        await page.screenshot({ path: `${out}/console.png`, fullPage: true });
        assert.deepEqual(errors, []);
      } finally { await page.close(); await admin.close(); h.m.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
    });
  } finally { await browser.close(); await srv.close(); }
});
