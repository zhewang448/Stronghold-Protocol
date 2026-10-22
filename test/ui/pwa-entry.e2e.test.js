// Real server/browser coverage; native OS installation is intentionally left to the user.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.SP_E2E === '1' && existsSync(CHROME);
const OUT = new URL('../e2e/out/', import.meta.url);

describe('desktop installation entry', { skip: !enabled }, () => {
  let server, browser, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${server.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await server?.close(); });
  async function open({ width = 1600, lang = 'zh-CN', entered = false, insecure = false, standalone = false } = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width, height: width < 1000 ? 390 : 900, hasTouch: width < 1000 });
    await page.evaluateOnNewDocument(({ lang, entered, insecure, standalone }) => {
      // Suppress real browser eligibility so the manual path is deterministic; synthetic offers still reach the app.
      addEventListener('beforeinstallprompt', e => { if (e.isTrusted) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
      localStorage.setItem('sp.pref.lang', JSON.stringify(lang));
      localStorage.setItem('sp.pref.settings', JSON.stringify({ textSize: 'xl' }));
      if (entered) { localStorage.setItem('sp.name', 'Install Test'); sessionStorage.setItem('sp.entered', '1'); }
      if (insecure) Object.defineProperty(window, 'isSecureContext', { value: false });
      if (standalone) Object.defineProperty(navigator, 'standalone', { value: true });
    }, { lang, entered, insecure, standalone });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(entered ? '.lobby-screen' : '.title-screen');
    await page.waitForSelector('#boot', { hidden: true });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
      const screen = document.querySelector('.screen');
      await Promise.all(screen.getAnimations({ subtree: true })
        .filter(a => Number.isFinite(a.effect.getComputedTiming().endTime))
        .map(a => a.finished.catch(() => {})));
    });
    return { context, page };
  }
  for (const width of [1600, 844, 640]) for (const lang of ['zh-CN', 'en', 'ja', 'ko', 'zh-TW']) {
    test(`manual entry and guide at ${width}px / ${lang} / XL text`, async () => {
      const { context, page } = await open({ width, lang });
      try {
        const button = '[data-testid="pwa-install"]';
        await page.waitForSelector(button, { visible: true });
        const usable = await page.$eval(button, e => {
          const r = e.getBoundingClientRect(), at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight && (at === e || e.contains(at));
        });
        assert.equal(usable, true, 'install entry is visible and reachable');
        if (lang === 'zh-CN') await page.screenshot({ path: fileURLToPath(new URL(`pwa-title-${width}.png`, OUT)) });
        await page.click(button);
        await page.waitForSelector('[data-testid="pwa-install-help"]');
        assert.equal(await page.$eval(button, e => e.disabled), true);
        const layout = await page.$eval('.modal__box', e => {
          const r = e.getBoundingClientRect(), body = e.querySelector('.modal__body');
          const action = e.querySelector('.modal__actions button').getBoundingClientRect();
          return { within: r.x >= 0 && r.right <= innerWidth + 1 && r.y >= 0 && r.bottom <= innerHeight + 1,
            overflow: body.scrollWidth - body.clientWidth, closeVisible: action.bottom <= innerHeight && action.y >= 0 };
        });
        assert.equal(layout.within, true, JSON.stringify(layout));
        assert.ok(layout.overflow <= 1, JSON.stringify(layout));
        assert.equal(layout.closeVisible, true);
        if (lang === 'zh-CN' || lang === 'en') await page.screenshot({ path: fileURLToPath(new URL(`pwa-guide-${width}-${lang}.png`, OUT)) });
        await page.keyboard.press('Escape');
        await page.waitForSelector('[data-testid="pwa-install-help"]', { hidden: true });
        await page.waitForFunction(() => !document.querySelector('[data-testid="pwa-install"]').disabled);
        assert.equal(await page.$eval(button, e => document.activeElement === e), true, 'keyboard focus returns to the entry');
      } finally { await context.close(); }
    });
  }
  test('lobby entry explains insecure addresses and preserves its manual route', async () => {
    const { context, page } = await open({ entered: true, insecure: true });
    try {
      await page.click('[data-testid="pwa-install"]');
      await page.waitForSelector('[data-testid="pwa-install-help"]');
      const text = await page.$eval('[data-testid="pwa-install-help"]', e => e.textContent);
      assert.match(text, /HTTPS.*localhost/);
      assert.match(text, /浏览器信任且匹配访问域名/);
      assert.match(text, /证书不受信任、域名不匹配或证书过期/);
      assert.match(text, /仅开启隧道加密不能满足安装要求/);
      assert.match(text, /当前服务器/);
      assert.match(text, /Edge：打开右上角“⋯”菜单 → 更多工具 → 应用 → 将此站点作为应用安装/);
      assert.match(text, /仍需先启动服务器/);
    } finally { await context.close(); }
  });
  for (const width of [1600, 844, 640]) for (const lang of ['zh-CN', 'en', 'ja', 'ko', 'zh-TW']) {
    test(`lobby installation remains reachable at ${width}px / ${lang}`, async () => {
      const { context, page } = await open({ width, lang, entered: true });
      try {
        await page.evaluate(async () => {
          const { identity } = await import('/js/net.js');
          identity.recoverable = () => [{ id: 'layout-only', name: 'Doctor', code: 'ABCD' }];
          window.dispatchEvent(new Event('focus'));
        });
        await page.waitForSelector('[data-testid="resume-local-match"]');
        const bounds = await page.$eval('[data-testid="pwa-install"]', e => {
          const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, hit: hit === e || e.contains(hit),
            within: r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight };
        });
        assert.equal(bounds.within && bounds.hit, true, JSON.stringify(bounds));
        await page.click('[data-testid="pwa-install"]');
        await page.waitForSelector('[data-testid="pwa-install-help"]');
        if (lang === 'en') await page.screenshot({ path: fileURLToPath(new URL(`pwa-lobby-guide-${width}.png`, OUT)) });
      } finally { await context.close(); }
    });
  }
  test('native prompt starts once, dismissal restores entry, installed event hides it', async () => {
    const { context, page } = await open();
    try {
      await page.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        window.installCalls = 0;
        e.prompt = () => { window.installCalls++; return new Promise(resolve => { window.finishInstall = resolve; }); };
        dispatchEvent(e);
      });
      await page.click('[data-testid="pwa-install"]');
      await page.waitForFunction(() => window.installCalls === 1);
      assert.equal(await page.$eval('[data-testid="pwa-install"]', e => e.disabled), true);
      assert.equal(await page.$('[data-testid="pwa-install-help"]'), null);
      await page.evaluate(() => window.finishInstall({ outcome: 'dismissed' }));
      await page.waitForFunction(() => !document.querySelector('[data-testid="pwa-install"]').disabled);
      await page.click('[data-testid="pwa-install"]');
      await page.waitForSelector('[data-testid="pwa-install-help"]');
      assert.equal(await page.evaluate(() => window.installCalls), 1);
      await page.keyboard.press('Escape');
      await page.evaluate(() => dispatchEvent(new Event('appinstalled')));
      await page.waitForSelector('[data-testid="pwa-install"]', { hidden: true });
    } finally { await context.close(); }
  });
  test('an installed Apple web app does not offer installation again', async () => {
    const { context, page } = await open({ standalone: true });
    try { assert.equal(await page.$('[data-testid="pwa-install"]'), null); } finally { await context.close(); }
  });
});
