// Optional custom alliance keys: real form input, protocol, collision feedback and responsive layout.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('custom alliance key form', { skip: !ENABLED }, () => {
  let server, browser, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    base = `http://127.0.0.1:${server.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  for (const viewport of [{ width: 1280, height: 720 }, ...[ [844, 390], [640, 360] ].map(([width, height]) => ({ width, height, isMobile: true, hasTouch: true, isLandscape: true }))]) {
    test(`create, join and reject occupied keys at ${viewport.width}px`, async () => {
      const contexts = [];
      const pageIn = async () => {
        const ctx = await browser.createBrowserContext();
        contexts.push(ctx);
        const page = await ctx.newPage();
        await page.setViewport(viewport);
        await page.evaluateOnNewDocument(() => {
          localStorage.setItem('sp.name', 'Key Test');
          sessionStorage.setItem('sp.entered', '1');
        });
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.lobby-screen'));
        await page.evaluate(() => [...document.querySelectorAll('.hub-entry')].find(e => e.textContent.includes('同盟模拟')).click());
        await page.waitForSelector('[name="custom-room-code"]');
        return page;
      };
      const input = '[name="custom-room-code"]';
      const create = '[data-testid="create-alliance"]';
      try {
        const host = await pageIn();
        // Check before focusing/typing: browser auto-scroll must not hide an initially clipped field.
        assert.ok(await host.$eval(input, (e) => {
          const r = e.getBoundingClientRect();
          return r.width > 100 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
            && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e;
        }), 'key input is fully in view and its centre receives the tap');
        await host.type(input, 'AB-C');
        assert.equal(await host.$eval(input, (e) => e.value), 'AB-C');
        assert.equal(await host.$eval(create, (e) => e.disabled), true);
        await host.$eval(input, (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
        const key = viewport.width === 1280 ? 'D1i0' : viewport.width === 844 ? 'M1i0' : 'S1i0';
        await host.type(input, key);
        assert.equal(await host.$eval(input, (e) => e.value), key.toUpperCase());
        assert.equal(await host.$eval(create, (e) => e.disabled), false);
        assert.ok(await host.$('.proto'), 'creating an alliance opens the difficulty picker instead of creating immediately');
        const overflow = await host.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(overflow <= 1, `horizontal overflow ${overflow}`);
        const field = await host.$eval(input, (e) => e.getBoundingClientRect().toJSON());
        assert.ok(field.width > 100 && field.left >= 0 && field.right <= viewport.width && field.top >= 0 && field.bottom <= viewport.height);
        {
          const button = await host.$eval(create, (e) => e.getBoundingClientRect().toJSON());
          assert.ok(button.bottom <= viewport.height, `create button clipped at ${button.bottom}px`);
        }
        mkdirSync('.cache/custom-room-code', { recursive: true });
        await host.screenshot({ path: `.cache/custom-room-code/${viewport.width}.png`, fullPage: true });
        await host.focus(input);
        await host.keyboard.press('Enter');
        await host.waitForSelector('.proto[data-difficulty]');
        assert.equal(await host.$eval('.proto', e => e.dataset.difficulty), 'FUNNY');
        await host.$eval('.proto-back', e => e.click());
        await host.waitForSelector('[data-testid="create-alliance"]');
        assert.equal(await host.$eval(input, e => e.value), key.toUpperCase(), 'back returns to the alliance setup and retains its custom key');
        await host.click(create);
        await host.waitForSelector('.proto[data-difficulty]');
        await host.$$eval('.proto .pcard', es => es[2].click());
        assert.equal(await host.$eval('.proto', e => e.dataset.difficulty), 'HARD');
        await host.click('.proto-start');
        await host.waitForFunction((code) => globalThis.__SP__.store.get().room?.code === code, {}, key.toUpperCase());
        assert.equal(await host.evaluate(() => globalThis.__SP__.store.get().room.difficulty), 'HARD');
        assert.equal(await host.evaluate(() => globalThis.__SP__.store.get().room.aiPicksLast), true);

        const guest = await pageIn();
        await guest.type(input, key);
        await guest.click(create);
        await guest.waitForSelector('.proto-start');
        await guest.click('.proto-start');
        await guest.waitForFunction(() => document.body.textContent.includes('该同盟密钥已被使用'));
        assert.equal(await guest.evaluate(() => globalThis.__SP__.store.get().room), null);
        assert.equal(await guest.$eval(input, (e) => e.value), key.toUpperCase());
        await guest.type('.ally-key input', key.toLowerCase());
        await guest.click('.ally-card__bar--join');
        await guest.waitForFunction((code) => globalThis.__SP__.store.get().room?.code === code, {}, key.toUpperCase());

        const random = await pageIn();
        await random.click(create);
        await random.waitForSelector('.proto[data-difficulty]');
        await random.click('.proto-start');
        await random.waitForFunction(() => !!globalThis.__SP__.store.get().room?.code);
        assert.match(await random.evaluate(() => globalThis.__SP__.store.get().room.code), /^[A-Z]{4}$/);
        assert.equal(await random.evaluate(() => globalThis.__SP__.store.get().room.aiPicksLast), true);
      } finally { await Promise.all(contexts.map((ctx) => ctx.close())); }
    });
  }
});
