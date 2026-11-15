import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { DEFAULT_VERSION } from '../../shared/versions.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.SP_E2E === '1' && existsSync(CHROME);
describe('manual season openings', { skip: !enabled }, () => {
  let server, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync('test/e2e/out', { recursive: true });
  });
  after(async () => { await browser?.close(); await server?.close(); });
  async function open(width = 1280, height = 720, touch = false, lang = 'zh', textSize = 'sm') {
    const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width, height, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((lang, textSize) => {
      localStorage.setItem('sp.name', 'OpeningTest');
      localStorage.setItem('sp.pref.lang', JSON.stringify(lang));
      localStorage.setItem('sp.pref.settings', JSON.stringify({ muted: true, textSize, upstreamReleaseNotes: false, extensionReleaseNotes: false }));
    }, lang, textSize);
    await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => ['connected', 'online'].includes(globalThis.__SP__?.store.get().connection.status) && document.querySelector('.title-information'));
    return { context, page, errors };
  }
  const settle = page => page.evaluate(async () => {
    await document.fonts.ready;
    document.getAnimations().forEach(a => { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); });
  });
  const play = async page => {
    await page.$eval('[data-testid="entry-film-button"]', e => e.scrollIntoView({ block: 'nearest' }));
    await page.click('[data-testid="entry-film-button"]');
    await page.waitForFunction(() => document.querySelector('[data-entry-film]')?.dataset.phase === 'playing', { timeout: 15000 });
  };
  const closed = page => page.waitForFunction(() => !document.querySelector('[data-entry-film]') && document.querySelector('[data-testid="entry-film-button"]')?.disabled === false);
  for (const [width, height, touch, lang, size] of [
    [1920, 1080, false, 'zh', 'sm'], [1280, 720, false, 'en', 'xl'],
    [844, 390, true, 'zh', 'sm'], [667, 375, true, 'ja', 'xl'],
    [640, 360, true, 'ko', 'xl'], [320, 680, false, 'zh-TW', 'sm'],
  ]) {
    test(`buttons coexist with current home layout at ${width}×${height} ${lang} ${size}`, async () => {
      const { context, page, errors } = await open(width, height, touch, lang, size);
      try {
        await settle(page);
        assert.equal(await page.$('[data-entry-film]'), null);
        const homeButton = '[data-testid="entry-film-button"]';
        await page.$eval(homeButton, e => e.scrollIntoView({ block: 'nearest' }));
        const layout = await page.evaluate(() => {
          const button = document.querySelector('.title-entry-film'), r = button.getBoundingClientRect();
          const groups = [...document.querySelectorAll('.title-login,.title-information,.title-preload,.title-foot')].map(e => e.getBoundingClientRect());
          const overlaps = groups.some((a, i) => groups.slice(i + 1).some(b => Math.min(a.right,b.right)>Math.max(a.left,b.left)+1 && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1));
          const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return { hit: button.contains(target), hitTarget:target?.outerHTML.slice(0,220), x:r.x, y:r.y, overlaps, width:r.width, height:r.height };
        });
        if (width < height) {
          assert(layout.hitTarget?.includes('rotate-hint'), 'portrait retains the existing rotation gate');
          await page.setViewport({ width:height, height:width, hasTouch:touch, isMobile:touch, deviceScaleFactor:1 });
          await settle(page);
          await page.$eval(homeButton, e => e.scrollIntoView({ block:'nearest' }));
          assert.equal(await page.$eval(homeButton, e => { const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }),true);
        } else assert.equal(layout.hit, true, JSON.stringify(layout));
        assert.equal(layout.overlaps, false);
        if (touch) assert(layout.width >= 44 && layout.height >= 44);
        await play(page);
        await page.click('[data-testid="entry-film-skip"]');
        await closed(page);
        await page.waitForFunction(() => document.activeElement?.matches('.title-entry-film'));
        await page.click('.title-login .btn--primary');
        await page.waitForSelector('.lobby-hub', { visible: true });
        await settle(page);
        assert.equal(await page.$('[data-entry-film]'), null);
        assert.equal(await page.$eval('.hub-entry-film', button => button.getBoundingClientRect().top >= document.querySelector('.hub-center__version').getBoundingClientRect().bottom), true);
        await play(page);
        await page.keyboard.press('Escape');
        await closed(page);
        if (width === 1920) {
          await page.screenshot({ path: 'test/e2e/out/entry-film-lobby.png' });
          await page.$eval('.lobby-hub', e => { e.dataset.hubTheme='custom'; });
          assert.equal(await page.$eval('.hub-entry-film', button => { const r=button.getBoundingClientRect();return r.width>0 && button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }),true);
        }
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.lobby-hub');
        assert.equal(await page.$('[data-entry-film]'), null);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
  test('both seasons replay; completion and reduced-motion opt-in return focus', async () => {
    const { context, page, errors } = await open();
    try {
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      assert.equal(await page.$('[data-entry-film]'), null);
      await play(page);
      assert.equal(await page.$eval('[data-entry-film]', e => e.dataset.season), 'act3autochess');
      await closed(page);
      await page.waitForFunction(() => document.activeElement?.matches('.title-entry-film'));
      await page.click('.title-login .btn--primary');
      await page.waitForSelector('.lobby-hub');
      await page.evaluate(async version => { (await import('/js/versions.js')).setLobbyVersion(version); }, DEFAULT_VERSION);
      await play(page);
      assert.notEqual(await page.$eval('[data-entry-film]', e => e.dataset.season), 'act3autochess');
      await page.screenshot({ path: 'test/e2e/out/entry-film-alliance.png' });
      await page.keyboard.press('Escape');
      await closed(page);
      await play(page);
      await closed(page);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('missing artwork and cancellation during preparation leave usable controls', async () => {
    const { context, page, errors } = await open();
    try {
      await settle(page);
      const group = await page.evaluate(async () => {
        const { data }=await import('/js/data.js');
        const film=await import('/js/ui/regulationFilm.js');
        await data.load('local');
        const groups=data.get('local').groups, saved=groups[film.REGULATION_ENTRY];
        delete groups[film.REGULATION_ENTRY];
        film.clearRegulationPack();
        return saved;
      });
      await page.click('[data-testid="entry-film-button"]');
      await closed(page);
      await page.waitForFunction(() => document.body.textContent.includes('开场动画素材未就绪'));
      await page.evaluate(async group => {
        const { data }=await import('/js/data.js');
        const film=await import('/js/ui/regulationFilm.js');
        data.get('local').groups[film.REGULATION_ENTRY]=group;
        film.clearRegulationPack();
      }, group);
      await page.click('[data-testid="entry-film-button"]');
      await page.waitForSelector('[data-entry-film]');
      await page.evaluate(() => { const s=globalThis.__SP__.store; s.set({ session:{...s.get().session,entered:true} }); });
      await page.waitForSelector('.lobby-hub');
      await closed(page);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});
