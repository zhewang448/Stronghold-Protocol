// Expanded co-op on supported landscape touch phones. Opt in with SP_E2E=1 and CHROME_PATH.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('twenty-player group choices on landscape touch phones', { skip: !enabled && 'set SP_E2E=1 and CHROME_PATH' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  for (const [width, height] of [[844, 390], [640, 360]]) test(`${width}×${height}: five groups, six cards, foreign page read-only and return by touch`, async () => {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.setViewport({ width, height, isMobile: true, hasTouch: true, isLandscape: true });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.waitForFunction(() => !!globalThis.__MOCK__);
      await page.evaluate(() => {
        const M = globalThis.__MOCK__; M.setPhase('SP_DRAFT', 'bounty');
        const s = M.S(), first = s.pub.players[0];
        s.pub.players = Array.from({ length: 20 }, (_, i) => ({ ...first, seat: i, playerId: i === 0 ? first.playerId : `expanded_${i}`, name: `Player ${i + 1}` }));
        s.pub.poolGroups = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, playerIds: s.pub.players.slice(i * 4, i * 4 + 4).map(p => p.playerId) }));
        const raw = s.pub.sp;
        s.pub.sp = { ...raw, id: 'sp:landscape:1', groups: s.pub.poolGroups.map(g => ({ ...raw, id: g.id,
          playerIds: g.playerIds, order: g.playerIds, turn: g.playerIds[0], picks: {}, turnDeadline: Date.now() + 60000, turnSeconds: 60 })) };
        M.pushPublic(); document.querySelector('#mockbar').style.display = 'none';
      });
      await page.waitForSelector('.spov__groups');
      await page.waitForSelector('.pbanner', { hidden: true, timeout: 6000 });
      assert.equal(await page.$$eval('.team__row', els => els.length), 20);
      assert.equal(await page.$$eval('.spov__group-tab', els => els.length), 5);
      assert.ok(await page.$$eval('.spov__group-tab', els => els.every(e => e.getBoundingClientRect().height >= 44)));
      const fits = () => page.$$eval('.spcard', els => els.length === 6 && els.every(e => {
        const r = e.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      }));
      assert.ok(await fits());
      const last = await page.$('.spov__group-tab[data-group="5"]');
      await last.scrollIntoView(); await last.tap();
      await page.waitForSelector('.spov__readonly');
      assert.ok(await page.$$eval('.spcard', els => els.every(e => e.disabled)));
      assert.ok(await fits(), 'the read-only notice does not push cards out of view');
      assert.ok(await page.$eval('.spov__readonly button', e => e.getBoundingClientRect().height >= 44));
      await page.tap('.spov__readonly button');
      await page.waitForFunction(() => !document.querySelector('.spov__readonly'));
      assert.equal(await page.$eval('.spov__group-tab[aria-pressed="true"]', e => e.dataset.group), '1');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
});
