// Browser check of the round / phase plates (opt-in, needs Chrome, ~40 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/match-popups.e2e.test.js
//
// Through the dev mock: SETTLE → 回合开始 shows the round plate — 回合 NN and 获得 +N (the income) for a player, and for an
// eliminated player 观战中 under it and no 获得 (GitHub #236 / #237); the 剩余 N 回合 strip near the final assault; the
// 联防 plate; the plate leaves by itself inside 回合开始 and the 休整期 banner follows. Static counterpart:
// test/ui/match-popups.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('round / phase plates (headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  });

  after(async () => {
    const timer = setTimeout(() => browser?.process()?.kill(), 5000);
    try { await browser?.close(); } finally { clearTimeout(timer); await srv?.close(); }
  });

  async function open(variant = '', { width = 1920, height = 1080, textSize = 'sm', motion = 'no-preference', missingArt = false } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: motion }]);
    await page.evaluateOnNewDocument(size => localStorage.setItem('sp.pref.settings', JSON.stringify({ textSize: size })), textSize);
    if (missingArt) {
      await page.setRequestInterception(true);
      page.on('request', request => /trans_coop[34]/.test(request.url()) ? request.abort() : request.continue());
    }
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=SETTLE${variant ? `&variant=${variant}` : ''}`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('.gm__hud', { timeout: 30000 }); // the match screen is up (its phase effect sees the changes)
    return { page, problems };
  }

  /** SETTLE of round r−1 with `funds`, then 回合开始 of round r paying `gain`. */
  const roundStart = (page, r, funds, gain) => page.evaluate(async (r, funds, gain) => {
    const M = globalThis.__MOCK__;
    M.mutate((s) => { s.pub.round = r - 1; s.priv.funds = funds; });
    M.pushPublic();
    await new Promise((res) => setTimeout(res, 300));
    M.setPhase('ROUND_START');
    M.mutate((s) => { s.pub.round = r; s.priv.funds = funds + gain; });
    M.pushPublic();
  }, r, funds, gain);

  const plate = (page) => page.evaluate(() => {
    const el = document.querySelector('[data-testid="round-popup"]');
    if (!el) return null;
    return {
      round: el.querySelector('.mpop__new')?.textContent,
      gain: el.querySelector('[data-testid="round-popup-gain"]')?.textContent.replace(/\s+/g, '') ?? null,
      sub: el.querySelector('[data-testid="round-popup-sub"]')?.textContent ?? null,
      left: el.querySelector('[data-testid="round-popup-left"]')?.textContent.trim() ?? null,
      banner: !!document.querySelector('.pbanner'),
    };
  });

  test('a player: 回合 NN · 获得 +N, no line under it; the plate leaves inside 回合开始 and no central PREP banner follows', async () => {
    const { page, problems } = await open();
    await roundStart(page, 5, 13, 8);
    await page.waitForSelector('[data-testid="round-popup"]', { timeout: 5000 });
    await sleep(200);
    assert.deepEqual(await plate(page), { round: '05', gain: '获得+8', sub: null, left: null, banner: false });
    await page.waitForFunction(() => !document.querySelector('[data-testid="round-popup"]'), { timeout: 4000 });
    await page.evaluate(() => globalThis.__MOCK__.setPhase('PREP'));
    await sleep(350);
    assert.equal(await page.$('.pbanner'), null, 'PREP has no central phase banner');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('near the final assault: the 剩余 N 回合 strip', async () => {
    const { page, problems } = await open();
    await roundStart(page, 12, 13, 10);
    await page.waitForSelector('[data-testid="round-popup-left"]', { timeout: 5000 });
    assert.equal((await plate(page)).left, '剩余 2 回合');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('an eliminated player: 观战中 under the plate, no 获得 (GitHub #236 / #237)', async () => {
    const { page, problems } = await open('dead');
    await roundStart(page, 6, 0, 0);
    await page.waitForSelector('[data-testid="round-popup"]', { timeout: 5000 });
    const p = await plate(page);
    assert.equal(p.round, '06');
    assert.equal(p.gain, null);
    assert.equal(p.sub, '观战中');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('联防阶段: the orange plate with the banner\'s words', async () => {
    const { page, problems } = await open();
    await page.evaluate(() => globalThis.__MOCK__.setPhase('UNITE'));
    await page.waitForSelector('[data-testid="phase-popup"].mpop--orange', { timeout: 5000 });
    assert.match(await page.$eval('[data-testid="phase-popup"] .mpop__title', (e) => e.textContent), /联防阶段/);
    assert.equal(await page.$('.pbanner'), null, 'the plate, not the banner');
    assert.deepEqual(problems, []);
    await page.close();
  });

  for (const [width, height, textSize, missingArt = false] of [[640, 360, 'sm'], [640, 360, 'xl'], [844, 390, 'sm'], [1280, 720, 'sm'], [1920, 1080, 'sm'], [1280, 720, 'sm', true]]) {
    for (const motion of ['no-preference', 'reduce']) {
      test(`联防图标居中 ${width}px / ${textSize} / ${motion}${missingArt ? ' / missing art' : ''}`, async () => {
        const { page } = await open('', { width, height, textSize, motion, missingArt });
        try {
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(() => globalThis.__MOCK__.setPhase('UNITE'));
          await page.waitForSelector('.mpop__bot--faces');
          await sleep(650); // both entrance animations have finished
          const layout = await page.$eval('.mpop__panel', panel => {
            const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
            const art = panel.querySelector('.mpop__art');
            return { panel: rect(panel), art: rect(art), group: rect(art.querySelector('.mpop__bot')),
              faces: [...art.querySelectorAll('.mpop__face')].map(rect),
              fallback: art.querySelectorAll('.mpop__face--css').length };
          });
          assert.equal(layout.faces.length, 2);
          assert.ok(Math.abs(layout.group.width - layout.art.width) < 1, 'the pair uses the entire decoration frame');
          assert.ok(Math.abs((layout.faces[0].x + layout.faces[1].right) / 2 - (layout.art.x + layout.art.width / 2)) < 1, 'pair is horizontally centred');
          assert.ok(Math.abs(layout.faces[0].width - layout.faces[1].width) < 1, 'faces retain equal widths');
          for (const face of layout.faces) {
            assert.ok(face.x >= layout.art.x && face.right <= layout.art.right, 'face stays within the frame');
            assert.ok(face.y >= layout.art.y && face.bottom <= layout.art.bottom, 'face stays within the frame vertically');
          }
          assert.ok(layout.panel.x >= 0 && layout.panel.right <= width + 1, 'plate fits the viewport');
          assert.equal(layout.fallback, missingArt ? 2 : 0, 'exercise both actual sprites and CSS fallbacks');
          mkdirSync('.cache/ui-audit', { recursive: true });
          await (await page.$('.mpop__panel')).screenshot({ path: `.cache/ui-audit/unite-${width}-${textSize}-${motion}${missingArt ? '-fallback' : ''}.png` });
        } finally { await page.close(); }
      });
    }
  }
});
