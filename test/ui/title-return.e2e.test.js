// Connection and tool rows keep their geometry before and after online lobby returns.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
describe('title controls survive lobby round trips', { skip: process.env.SP_E2E !== '1' || !existsSync(CHROME) }, () => {
  let server, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });
  after(async () => { await browser?.close(); await server?.close(); });
  for (const [width, height, touch, lang, textSize] of [
    [1920, 1080, false, 'zh-CN', 'sm'], [1280, 720, false, 'zh-CN', 'sm'],
    [844, 390, true, 'zh-CN', 'sm'], [667, 375, true, 'zh-CN', 'xl'],
    [1440, 900, false, 'zh-CN', 'xl'], [1280, 720, false, 'en', 'xl'],
  ]) {
    test(`${width}×${height} ${lang} ${textSize}`, async () => {
      const context = await browser.createBrowserContext();
      try {
        const page = await context.newPage(), errors = [];
        // Optional remote font CSS can arrive after fonts.ready and change metrics mid-check.
        // Keep this layout regression on local fonts, including the supported offline fallbacks.
        await page.setRequestInterception(true);
        page.on('request', request => {
          if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(request.url()).hostname)) request.abort();
          else request.continue();
        });
        page.on('pageerror', e => errors.push(e.message));
        await page.setViewport({ width, height, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
        await page.evaluateOnNewDocument((lang, textSize) => {
          localStorage.setItem('sp.name', 'TitleReturn');
          localStorage.setItem('sp.pref.lang', JSON.stringify(lang));
          localStorage.setItem('sp.pref.settings', JSON.stringify({ textSize, upstreamReleaseNotes: false, extensionReleaseNotes: false }));
        }, lang, textSize);
        await page.goto(server.url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => ['connected', 'online'].includes(globalThis.__SP__?.store.get().connection.status) && document.querySelector('.title-screen'));
        const settle = () => page.evaluate(() => document.getAnimations().forEach(a => { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); }));
        const check = async () => {
          await settle();
          const problems = await page.evaluate(() => {
            const row = document.querySelector('.title-conn'), problems = [];
            const tools = row.querySelector('.title-conn__tools');
            if (!row.querySelector('.ping')) problems.push('missing reserved latency badge');
            if (!tools || [...tools.children].some(e => Math.abs(e.getBoundingClientRect().top - tools.firstElementChild.getBoundingClientRect().top) > 1)) problems.push('tool controls split across rows');
            const information = document.querySelector('.title-information'), panel = document.querySelector('.title-login');
            const notice = document.querySelector('.title-notice'), updates = document.querySelector('.title-updates');
            if (!information || notice.parentElement !== information || updates.parentElement !== information) problems.push('missing standalone information row');
            if (panel.contains(notice) || panel.contains(updates)) problems.push('information actions inside login panel');
            const noticeBox = notice.getBoundingClientRect(), updatesBox = updates.getBoundingClientRect();
            if (Math.abs(noticeBox.top - updatesBox.top) > 1 || noticeBox.top < panel.getBoundingClientRect().bottom - 1) problems.push('information row placement');
            const elements = [...document.querySelectorAll('.title-conn .status-dot, .title-conn .ping, .title-conn .btn, .title-conn .fsbtn, .title-information .btn')].filter(e => e.getBoundingClientRect().width);
            for (let i = 0; i < elements.length; i++) {
              const e = elements[i], a = e.getBoundingClientRect();
              const bounds = (information.contains(e) ? information : row).getBoundingClientRect();
              if (a.left < bounds.left - 1 || a.right > bounds.right + 1) problems.push(`${e.className}: outside row`);
              for (const other of elements.slice(i + 1)) {
                const b = other.getBoundingClientRect();
                if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) problems.push(`${e.className}: overlap`);
              }
              const label = e.querySelector('.btn__label');
              if (label) {
                const range = document.createRange(); range.selectNodeContents(label);
                if ([...range.getClientRects()].some(r => r.left < a.left - 1 || r.right > a.right + 1)) problems.push(`${e.className}: label outside button`);
              }
              if (e.matches('button')) {
                if (document.documentElement.classList.contains('sp-coarse') && (a.width < 44 || a.height < 44)) problems.push(`${e.className}: small touch target`);
                for (const [x, y] of [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]]) {
                  if (!e.contains(document.elementFromPoint(a.left + a.width * x, a.top + a.height * y))) problems.push(`${e.className}: blocked hit target`);
                }
              }
            }
            const status = row.querySelector('.title-conn__status > span:not(.status-dot)');
            if (!status) problems.push('missing grouped status');
            else {
              const range = document.createRange(); range.selectNodeContents(status);
              if ([...range.getClientRects()].filter(r => r.width).length !== 1) problems.push('status wraps');
            }
            return problems;
          });
          assert.deepEqual(problems, []);
        };
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all([...document.querySelectorAll('.title-login *, .title-information *')].map(e => {
            const style = getComputedStyle(e);
            return document.fonts.load(style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily, e.textContent || '0123456789');
          }));
        });
        await check();
        const geometry = () => page.evaluate(() => {
          const panel = document.querySelector('.title-login').getBoundingClientRect();
          const rect = selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return { x: r.x - panel.x, y: r.y - panel.y, width: r.width, height: r.height };
          };
          return { panelHeight: panel.height, guide: rect('.title-guide'), settings: rect('.title-settings'), fullscreen: rect('.title-fs'), information: rect('.title-information') };
        });
        const initial = await geometry();
        const assertStable = actual => {
          assert.ok(Math.abs(actual.panelHeight - initial.panelHeight) <= 1, 'panel height changes after returning online: ' + JSON.stringify({ initial, actual }));
          for (const key of ['guide', 'settings', 'fullscreen', 'information']) {
            for (const field of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key][field] - initial[key][field]) <= 1, key + '.' + field + ' moves');
          }
        };
        for (let round = 0; round < 2; round++) {
          await page.click('.title-login .btn--xl');
          await page.waitForFunction(() => globalThis.__SP__.store.get().connection.status === 'online' && document.querySelector('.lobby-screen'));
          await settle();
          await page.click('.lobby-screen .topbar__left > button:first-child');
          await page.waitForSelector('.title-screen');
          await check();
          assert.ok(await page.$('.title-conn .ping'));
          assertStable(await geometry());
        }
        for (const ping of [null, 9, 31, 99, 999, 9999]) {
          await page.evaluate(async ping => {
            const { net } = await import('/js/net.js');
            net.close();
            const { store } = await import('/js/store.js');
            store.patch('connection', { status: 'online', ping });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          }, ping);
          await check();
          assertStable(await geometry());
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
});
