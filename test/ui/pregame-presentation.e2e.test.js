// Upstream presentation with the extension's strategy rules and compact textured map.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.SP_E2E === '1' && existsSync(CHROME);
const OUT = path.join(ROOT, 'test/e2e/out/pregame-presentation');

describe('upstream pre-game presentation with extension choices', { skip: !enabled && 'set SP_E2E=1 and CHROME_PATH' }, () => {
  let server, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  async function open({ width = 1920, height = 1080, reduce = true, blockAtlas = false } = {}) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width, height, hasTouch: width < 1000, isMobile: width < 1000 });
    await page.setBypassServiceWorker(true);
    if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    if (blockAtlas) {
      await page.setRequestInterception(true);
      page.on('request', r => /TX_autochessi_D\./.test(r.url()) ? r.abort() : r.continue());
    }
    await page.goto(`http://127.0.0.1:${server.port}/dev/game-mock.html?shot=1&render=fallback&phase=BAND_DRAFT&version=regulation`,
      { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('.draft--grid');
    return { page, errors };
  }

  test('grid → detail → picked → read-only peek; random and bond-plan controls remain', async () => {
    const { page, errors } = await open();
    try {
      assert.equal(await page.$('.draft-detail'), null, 'the upstream wall starts without an open detail');
      assert.ok(await page.$('[data-band="__random__"], .dband__random'));
      assert.ok(await page.$('[data-testid="bond-plan-open"]'));
      const map = await page.$eval('.draft-stage', e => ({ width: e.clientWidth, height: e.clientHeight }));
      assert.ok(map.width <= 390 && map.height <= 150, 'the existing compact map slot is preserved');
      await page.waitForFunction(() => document.querySelectorAll('.stagemap pattern').length > 0);
      await page.click('[data-band="band_bldsk"]');
      await page.waitForSelector('.draft--detail .draft-confirm:not(:disabled)');
      await page.screenshot({ path: path.join(OUT, 'desktop-detail.png') });
      await page.click('.draft-confirm');
      await page.waitForSelector('.draft--done .draft-done');
      await page.screenshot({ path: path.join(OUT, 'desktop-picked.png') });
      await page.click('.dorder.is-self .dorder__box.is-band');
      await page.waitForSelector('.draft--detail');
      assert.equal(await page.$('.draft-confirm'), null, 'a picked strategy opens read-only');
      await page.click('.draft-detail__btns button');
      await page.waitForSelector('.draft--done');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  for (const [width, height] of [[844, 390], [640, 360], [1280, 720]]) test(`${width}×${height}: detail and confirmation stay visible at large text`, async () => {
    const { page, errors } = await open({ width, height });
    try {
      await page.evaluate(() => { document.documentElement.dataset.text = 'xl'; });
      await page.click('[data-band="band_bldsk"]');
      await page.waitForSelector('.draft-confirm');
      const rects = await page.$$eval('.draft-stage, .draft-detail, .draft-confirm, .stephead__right', els => els.map(e => {
        const r = e.getBoundingClientRect();
        return { cls: e.className, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }));
      for (const rect of rects) {
        assert.ok(rect.left >= -1 && rect.top >= -1 && rect.right <= width + 1 && rect.bottom <= height + 1,
          `${rect.cls}: ${JSON.stringify(rect)} exceeds ${width}×${height}`);
      }
      assert.equal(await page.$eval('.dband', e => getComputedStyle(e).animationName), 'none');
      await page.screenshot({ path: path.join(OUT, `${width}x${height}-detail.png`) });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('twenty seats retain independent group clocks, foreign-group markers and request scope', async () => {
    const { page, errors } = await open({ width: 844, height: 390 });
    try {
      await page.evaluate(async () => {
        const M = globalThis.__MOCK__, s = M.S(), first = s.pub.players.find(p => p.playerId === 'p1');
        s.priv.bandId = null;
        s.pub.players = Array.from({ length: 20 }, (_, i) => ({ ...first, seat: i, playerId: i ? `p${i + 1}` : 'p1', name: `Player ${i + 1}`, bandId: null }));
        s.pub.poolGroups = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, playerIds: s.pub.players.slice(i * 4, i * 4 + 4).map(p => p.playerId) }));
        s.pub.draft = { id: 'draft:presentation', groups: s.pub.poolGroups.map((g, i) => ({ ...g, order: g.playerIds,
          turn: g.playerIds[0], picks: i ? { [g.playerIds[1]]: 'band_bldsk' } : {},
          turnSeconds: 60, turnDeadline: Date.now() + (50 + i) * 1000, skipsLeft: {} })) };
        const { net } = await import('/js/net.js');
        const request = net.request.bind(net);
        globalThis.__draftRequests = [];
        net.request = (name, payload, ...rest) => { if (name === 'g.band') globalThis.__draftRequests.push({ name, payload }); return request(name, payload, ...rest); };
        M.pushPublic();
      });
      await page.waitForFunction(() => document.querySelectorAll('.dorder').length === 20);
      assert.equal(await page.$$eval('.draft-order__group--framed', els => els.length), 5);
      assert.equal(await page.$$eval('.dorder.is-cur', els => els.length), 5);
      assert.equal(await page.$$eval('[data-band="band_bldsk"] .dband__group', els => els.length), 4);
      assert.equal(await page.$eval('[data-band="band_bldsk"]', e => e.getAttribute('aria-disabled')), 'false');
      await page.click('[data-band="band_bldsk"]');
      await page.click('.draft-confirm');
      assert.deepEqual(await page.evaluate(() => globalThis.__draftRequests), [{ name: 'g.band', payload: { bandId: 'band_bldsk', draftId: 'draft:presentation', groupId: 1 } }]);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('an unavailable atlas falls back to readable cells with the same gates and objective', async () => {
    const { page, errors } = await open({ blockAtlas: true });
    try {
      await page.waitForFunction(() => document.querySelectorAll('.stagemap pattern').length === 0);
      assert.ok(await page.$('.stagemap__t--gate'));
      assert.ok(await page.$('.stagemap__t--goal'));
      assert.equal(await page.$eval('.stagemap__t--gate', e => getComputedStyle(e).fill), 'rgb(250, 85, 61)');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('real lobby, difficulty scene, room readiness and match entry retain the motion sequence', async () => {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.title-login input');
      await page.type('.title-login input', 'MotionQA');
      await page.evaluate(() => [...document.querySelectorAll('.title-login button')].find(button => button.textContent.includes('开始')).click());
      await page.waitForSelector('.lobby-screen');
      await page.evaluate(() => globalThis.__SP__.store.set({ lobbyVersion: 'act2autochess' }));
      await page.click('.hub-entry[aria-label="独立模拟"]');
      await page.waitForSelector('.ps');
      assert.equal(await page.$eval('.ps', e => getComputedStyle(e).animationName), 'ps-in');
      assert.equal(await page.$eval('.ps-cable__pulse', e => getComputedStyle(e).animationName), 'ps-pulse');
      await page.click('.proto-back');
      await page.waitForSelector('.proto', { hidden: true });
      await page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL', version: 'act2autochess' }));
      await page.waitForSelector('.rseat.is-me');
      assert.equal(await page.$eval('.rseat.is-me', e => getComputedStyle(e).animationName), 'rseat-in');
      await page.evaluate(() => globalThis.__SP__.net.request('room.addBot', {}));
      await page.waitForSelector('.rseat.is-bot');
      await page.evaluate(() => globalThis.__SP__.net.request('room.start', {}));
      await page.waitForSelector('.screen.brief');
      assert.equal(await page.$eval('.stephead', e => getComputedStyle(e).animationName), 'pg-fade');
      await page.screenshot({ path: path.join(OUT, 'real-briefing.png') });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
});
