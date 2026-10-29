import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin } from '../../server/admin.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('console polling preserves piece scrolling, expanded details and unfinished edits', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-refresh-interactions-'));
  const h = makeMatch({ humans: 1, fake: true }).start().toPrep();
  const ps = h.ps('p_0'), chess = Object.keys(h.m.data.chess)[0];
  ps.hand = Array.from({ length: 10 }, () => ps.newPiece('chess', chess));
  const room = { code: 'TEST', mode: 'solo', difficulty: 'NORMAL', seats: [], spectators: [], match: h.m };
  const admin = await startAdmin({ lobby: { rooms: new Map([['TEST', room]]), safeData: () => h.m.data, onMatchEnd() {} },
    port: 0, resultsDir: dir, settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-background-timer-throttling'] });
  t.after(async () => { await browser.close(); await admin.close(); h.m.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await browser.newPage();
  await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-open-room]');
  await page.click('[data-open-room]');
  await page.click('[data-toggle]');
  const scroller = '.detail .panes > div:nth-child(3) .scroll';
  await page.waitForSelector(scroller);
  await page.addStyleTag({ content: `${scroller} { max-height: 100px !important; }` });
  const before = await page.$eval(scroller, (el) => {
    el.scrollTop = 120;
    window.pieceScrollBefore = el;
    return el.scrollTop;
  });
  assert.ok(before > 0);
  await page.$eval('.detail details', (el) => { el.open = true; });
  await page.$eval('[data-act="funds"]', (el) => { el.value = '42'; });
  ps.funds += 1;
  await page.waitForFunction((funds) => document.querySelector('.player-summary')?.children[2]?.textContent === String(funds), {}, ps.funds);
  assert.ok(await page.$eval(scroller, (el) => el.scrollTop > 0), 'piece list scroll position survives a refresh');
  assert.ok(await page.$eval(scroller, (el) => el === window.pieceScrollBefore), 'refresh keeps the scrollbar node while it is in use');
  assert.equal(await page.$eval('.detail details', (el) => el.open), true, 'expanded sections survive a refresh');
  assert.equal(await page.$eval('[data-act="funds"]', (el) => el.value), '42', 'unfinished edits survive a refresh');

  const chart = await page.evaluate(async () => {
    const { drawRoundChart } = await import('/js/ui/roundChart.js');
    const host = document.createElement('div');
    host.style.width = '180px';
    document.body.append(host);
    const players = Array.from({ length: 8 }, (_, i) => ({ playerId: `p${i}`, name: `long player ${i}`, seat: i }));
    const history = [{ round: 1, players: players.map((p) => ({ playerId: p.playerId, alive: true, lp: 10 })) }];
    const state = { metric: 'lp', table: true };
    drawRoundChart(host, history, (id) => id, state, { players });
    const table = host.querySelector('.xscroll');
    table.scrollLeft = 120;
    const before = table.scrollLeft;
    history[0].players[0].lp = 9;
    drawRoundChart(host, history, (id) => id, state, { players });
    const after = table.scrollLeft, same = table === host.querySelector('.xscroll');
    state.table = false;
    drawRoundChart(host, history, (id) => id, state, { players });
    const hit = host.querySelector('.hit'), svg = host.querySelector('svg');
    svg.focus();
    history[0].players[0].lp = 8;
    drawRoundChart(host, history, (id) => id, state, { players });
    return { before, after, same, hit: hit === host.querySelector('.hit'), focused: svg === document.activeElement };
  });
  assert.ok(chart.before > 0 && chart.same && chart.after === chart.before, 'live chart table keeps its horizontal scroll node');
  assert.ok(chart.hit && chart.focused, 'live chart refresh keeps the pointer target and keyboard focus');
  const ranking = await page.evaluate(async () => {
    const { drawUnitRounds } = await import('/js/ui/roundChart.js');
    const host = document.createElement('div');
    document.body.append(host);
    const players = [{ playerId: 'p1', name: '玩家', seat: 0 }];
    const unit = (uid, dmg) => ({ uid, defId: 'op', name: '同名干员', dmg, kills: 0 });
    const history = [
      { round: 1, players: [{ playerId: 'p1', units: [unit(1, 10), unit(2, 20)] }] },
      { round: 2, players: [{ playerId: 'p1', units: [unit(1, 5), unit(2, 15)] }] },
    ];
    drawUnitRounds(host, history, (id) => id, { cumulative: true }, { players });
    return [...host.querySelectorAll('tbody tr')].map((tr) => tr.children[3].textContent);
  });
  assert.deepEqual(ranking, ['35', '15'], 'cumulative round ranking separates same-name pieces');

  let samples = 0;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (!req.url().endsWith('/api/resources')) { void req.continue(); return; }
    samples++;
    void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({
      current: { uptime: samples, rss: 1, heap: 1, cpu: 1, sessions: 1, rooms: 1, matches: 1, spectators: 0,
        tx: 1, rx: 1, assets: 1, byRoom: Array.from({ length: 20 }, (_, i) => ({ code: `room-${i}`, tx: 1, rx: 1 })) }, players: [],
    }) });
  });
  await page.goto(`${admin.url}/resources`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-resource-tables]');
  await page.addStyleTag({ content: '[data-resource-tables] { max-height: 100px; }' });
  const resourceScroll = await page.$eval('[data-resource-tables]', (el) => { el.scrollTop = 90; window.resourceScrollBefore = el; return el.scrollTop; });
  assert.ok(resourceScroll > 0);
  await page.waitForFunction(() => document.querySelector('[data-resource-summary]')?.textContent.includes('运行'));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.ok(samples >= 2, 'resources have refreshed');
  assert.ok(await page.$eval('[data-resource-tables]', (el) => el === window.resourceScrollBefore && el.scrollTop > 0), 'resource table remains usable during refresh');
});
