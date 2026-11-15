// Version-specific room frames and the upstream briefing / solo presentation.
import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.SP_E2E === '1' && existsSync(CHROME);
const OUT = path.join(ROOT, 'test/e2e/out/upstream-layouts');

describe('upstream room, briefing and solo layouts', { skip: !enabled && 'set SP_E2E=1 and CHROME_PATH' }, () => {
  let server, browser, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
    base = `http://127.0.0.1:${server.port}`;
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await server?.close(); });
  async function open(width = 1440, height = 900) {
    const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width, height, isMobile: width < 1000, hasTouch: width < 1000 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setBypassServiceWorker(true);
    return { context, page, errors };
  }
  async function login(page) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.title-login input');
    await page.type('.title-login input', 'LayoutQA');
    await page.evaluate(() => [...document.querySelectorAll('.title-login button')].find(b => b.textContent.includes('开始')).click());
    await page.waitForSelector('.lobby-screen');
  }
  async function leave(page) {
    await page.evaluate(async () => { await globalThis.__SP__.net.request('room.leave', {}); globalThis.__SP__.store.set({ room: null }); });
    await page.waitForSelector('.lobby-screen');
  }

  test('five versions use their season frame; changing an existing room updates its borders immediately', async () => {
    for (const version of ['act1autochess', 'act1autochess@V1_1', 'act2autochess', 'act2autochess@V2_1', 'act3autochess@V3_1']) {
      const { page, context, errors } = await open();
      try {
        await login(page);
        const season = version.split('@')[0], expected = season === 'act3autochess' ? 'rgb(226, 65, 44)' : 'rgb(79, 232, 192)';
        await page.evaluate(version => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL', version }), version);
        await page.waitForSelector(`.room-screen[data-season="${season}"] .rseat.is-lit`);
        assert.deepEqual(await page.$eval('.rseat.is-me', e => [getComputedStyle(e.querySelector('.rseat__art')).borderTopColor,
          getComputedStyle(e.querySelector('.rseat__strip')).backgroundColor]), [expected, expected]);
        await page.screenshot({ path: path.join(OUT, `room-${version.replace('@', '-')}.png`) });
        if (season === 'act3autochess') {
          // Entering a version room syncs loadout/skins through the shared heavy-message bucket.
          // Allow those normal sync requests to settle before the next user operation.
          await new Promise(resolve => setTimeout(resolve, 1500));
          await page.evaluate(() => globalThis.__SP__.net.request('room.proposeVersion', { version: 'act2autochess' }));
          await page.waitForSelector('.room-screen[data-season="act2autochess"]');
          assert.equal(await page.$eval('.rseat.is-me .rseat__art', e => getComputedStyle(e).borderTopColor), 'rgb(79, 232, 192)');
        }
        await leave(page);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  });

  for (const [width, height] of [[1440, 900], [844, 390], [640, 360]]) test(`${width}×${height}: solo official art, four difficulty cards, start action and waiting room fit`, async () => {
    const { page, context, errors } = await open(width, height);
    try {
      await login(page);
      await page.evaluate(() => { globalThis.__SP__.store.set({ lobbyVersion: 'act2autochess' }); document.documentElement.dataset.text = 'xl'; });
      await page.click('.hub-entry[aria-label="独立模拟"]');
      await page.waitForSelector('.proto__pic .ps-ship image');
      assert.equal(await page.$$eval('.proto .pcard', els => els.length), 4);
      await page.$$eval('.proto .pcard', els => els[2].click());
      await page.waitForSelector('.proto[data-difficulty="HARD"]');
      assert.ok(await page.$('.proto__fit'));
      const rectangles = await page.$$eval('.proto .pcard, .proto-start', els => els.map(e => {
        const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }));
      for (const r of rectangles) assert.ok(r.left >= -1 && r.top >= -1 && r.right <= width + 1 && r.bottom <= height + 1, JSON.stringify(r));
      await page.screenshot({ path: path.join(OUT, `solo-${width}x${height}.png`) });
      await page.click('.proto-start');
      await page.waitForSelector('.rs--solo .seats--solo');
      assert.match(await page.$eval('.rs-brief h2', e => e.textContent), /绝境模拟/);
      assert.equal(await page.$$eval('.rs--solo .rseat', els => els.length), 1);
      await page.screenshot({ path: path.join(OUT, `solo-room-${width}x${height}.png`) });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  for (const [width, height, text] of [[1920, 1080, 'lg'], [1440, 900, 'sm'], [844, 390, 'xl'], [640, 360, 'sm']]) {
    test(`${width}×${height}: regulation speed card has upstream details and replays its selection animation`, async () => {
      const { page, context, errors } = await open(width, height);
      try {
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
        await page.evaluateOnNewDocument(() => {
          globalThis.__soloAnimations = [];
          document.addEventListener('animationstart', e => {
            if (e.target.matches?.('.pcard__stamp, .proto, .proto-title')) globalThis.__soloAnimations.push(e.animationName);
          }, true);
        });
        await login(page);
        await page.evaluate(text => { globalThis.__SP__.store.set({ lobbyVersion: 'act3autochess@V3_1' }); document.documentElement.dataset.text = text; }, text);
        await page.click('.hub-entry[aria-label="独立模拟"]');
        await page.waitForSelector('.ladder__side.pcard');
        assert.equal(await page.$eval('.ladder__side .pcard__name', e => e.textContent), '极速模拟');
        assert.equal(await page.$eval('.ladder__side .pcard__desc', e => e.textContent), '时长较短的模拟训练');
        assert.match(await page.$eval('.ladder__side .pcard__meta', e => e.textContent), /AC-TB-1.*9.*回合.*战场/);
        assert.equal(await page.$$eval('.ladder__grid button[data-mode]', els => els.length), 20);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.proto__body')).opacity === '1');
        const first = await page.$eval('.ladder__grid button[data-mode]', e => e.dataset.mode);
        await page.$eval('.ladder__grid button[data-mode]', e => e.focus());
        await page.keyboard.press('Enter');
        await page.waitForFunction(id => document.querySelector(`.ladder__cell[data-mode="${id}"]`)?.getAttribute('aria-pressed') === 'true', {}, first);
        assert.equal(await page.$eval('.ladder__side', e => e.getAttribute('aria-pressed')), 'false');
        await page.evaluate(() => { globalThis.__soloAnimations.length = 0; });
        await page.$eval('.ladder__side', e => e.focus());
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => globalThis.__soloAnimations.includes('proto-stamp'));
        assert.equal(await page.$eval('.ladder__side .pcard__stamp', e => getComputedStyle(e).display), 'flex');
        assert.equal(await page.$eval('.ladder__side .pcard__stamp', e => getComputedStyle(e).animationName), 'proto-stamp');
        assert.ok(await page.$eval('.ladder__side .pcard__stamp', e => parseFloat(getComputedStyle(e).animationDuration) >= 0.2), 'normal-motion stamp has a visible playback duration');
        await page.screenshot({ path: path.join(OUT, `regulation-${width}x${height}-animated.png`) });
        const bounds = await page.$$eval('.ladder__side, .proto-start', els => els.map(e => {
          const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        }));
        for (const r of bounds) assert.ok(r.left >= -1 && r.top >= -1 && r.right <= width + 1 && r.bottom <= height + 1, JSON.stringify(r));
        if (width === 1440) {
          await page.click('.proto-start');
          await page.waitForSelector('.rs--solo');
          assert.equal(await page.evaluate(() => globalThis.__SP__.store.get().room.modeId), 'mode_single_funny');
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }

  test('regulation speed card keeps its selected stamp when reduced motion is requested', async () => {
    const { page, context, errors } = await open();
    try {
      await login(page);
      await page.evaluate(() => globalThis.__SP__.store.set({ lobbyVersion: 'act3autochess@V3_1' }));
      await page.click('.hub-entry[aria-label="独立模拟"]');
      await page.waitForSelector('.ladder__side.pcard');
      await page.$eval('.ladder__side', e => e.click());
      const state = await page.$eval('.ladder__side .pcard__stamp', e => ({ display: getComputedStyle(e).display, duration: parseFloat(getComputedStyle(e).animationDuration) }));
      assert.equal(state.display, 'flex');
      assert.ok(state.duration <= 0.001, `reduced-motion duration ${state.duration}s`);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  for (const version of ['alliance', 'regulation']) for (const [width, height] of [[1440, 900], [844, 390]]) test(`${version} ${width}×${height}: upstream sections, controls and match-info preview remain usable`, async () => {
    const { page, context, errors } = await open(width, height);
    try {
      await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=INFO_CHECK${version === 'regulation' ? '&version=regulation' : ''}`, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.waitForSelector('.screen.brief');
      assert.equal(await page.$$eval('.brief-sec', els => els.length), version === 'regulation' ? 3 : 4);
      const ready = await page.$eval('.brief-go', e => { const r = e.getBoundingClientRect(); return { right: r.right, bottom: r.bottom, disabled: e.disabled }; });
      assert.ok(ready.right <= width + 1 && ready.bottom <= height + 1 && !ready.disabled);
      await page.screenshot({ path: path.join(OUT, `brief-${version}-${width}x${height}.png`) });
      await page.click('.brief-go');
      await page.waitForFunction(() => globalThis.__MOCK__.S().pub.players.find(p => p.playerId === 'p1').ready);
      // The other mock human has not confirmed; explicitly advance the fixture after observing this ready action.
      await page.evaluate(() => globalThis.__MOCK__.setPhase('BAND_DRAFT'));
      await page.waitForSelector('.screen.draft');
      await page.click('[data-testid="match-info-open"]');
      await page.waitForSelector('.minfo-dlg');
      assert.ok(await page.$('[data-testid="match-info-close"]'));
      await page.click('[data-testid="match-info-close"]');
      await page.waitForSelector('.minfo-dlg', { hidden: true });
      assert.ok(await page.$('[data-testid="stage-minimap"]'));
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});
