// Real two-origin export/import, popup consent, clipboard fallback and responsive hub/modal checks.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
describe('personal data backup and domain migration', { skip: !ENABLED }, () => {
  let server, oldServer, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    oldServer = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync('.cache/personal-data', { recursive: true });
  });
  after(async () => {
    const timer = setTimeout(() => browser?.process()?.kill(), 5000);
    try { await browser?.close(); } finally { clearTimeout(timer); await oldServer?.close(); await server?.close(); }
  });
  async function open(t, width = 1280, height = 720, large = false) {
    const context = await browser.createBrowserContext();
    t.after(() => context.close());
    const page = await context.newPage(), errors = [];
    page.setDefaultNavigationTimeout(90000);
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width, height });
    const seed = await page.evaluateOnNewDocument((large) => {
      localStorage.setItem('sp.name', 'BackupDoc');
      localStorage.setItem('sp.pref.localAccount', JSON.stringify({ tag: '4321' }));
      localStorage.setItem('sp.pref.settings', JSON.stringify({ textSize: large ? 'xl' : 'sm' }));
      sessionStorage.setItem('sp.entered', '1');
    }, large);
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.lobby-screen')); await page.evaluate(() => document.getAnimations().forEach((a) => { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); }));
    await page.removeScriptToEvaluateOnNewDocument(seed.identifier);
    return { context, page, errors };
  }
  async function clickText(page, label) {
    const selector = '.personal-data-modal button';
    await page.waitForFunction((selector, label) => [...document.querySelectorAll(selector)].some((b) => b.textContent.trim() === label && !b.disabled), {}, selector, label);
    const handle = await page.evaluateHandle((selector, label) => [...document.querySelectorAll(selector)].find((b) => b.textContent.trim() === label), selector, label);
    await handle.asElement().click(); await handle.dispose();
  }
  async function panel(page) {
    const entry = await page.evaluateHandle(() => [...document.querySelectorAll('.hub-right .hub-tile')].find((b) => b.textContent.includes('导出 / 导入个人数据')));
    await entry.asElement().click(); await entry.dispose();
    await page.waitForSelector('.personal-data-modal'); await page.evaluate(() => document.getAnimations().forEach((a) => { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); }));
  }
  test('deployment migration default is prefilled and stays editable', async (t) => {
    const { page } = await open(t);
    const config = await page.evaluate(() => fetch('/personal-data-config.json').then((r) => r.json()));
    await panel(page);
    const expected = config.migrationSource ? new URL(config.migrationSource).origin + '/' : '';
    await page.waitForFunction((expected) => document.querySelector('.personal-data-panel input:not([type=file]):not([type=checkbox])')?.value === expected, {}, expected);
    await page.$eval('.personal-data-panel input:not([type=file]):not([type=checkbox])', (e) => { e.value = 'https://manual.example.test/'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.$eval('.personal-data-panel input:not([type=file]):not([type=checkbox])', (e) => e.value), 'https://manual.example.test/');
  });
  test('backup reminder supports postpone, disable, reload and mobile layout', async (t) => {
    const { page, errors } = await open(t, 844, 390);
    await page.evaluate(async () => {
      const { updateReminder } = await import('/js/ui/backupReminder.js');
      updateReminder({ firstSeen: Date.now() - 8 * 86400000, enabled: true });
    });
    await page.waitForSelector('[data-testid=backup-reminder]');
    await page.$eval('[data-testid=backup-reminder]', (el) => el.scrollIntoView());
    assert.equal(await page.$eval('[data-testid=backup-reminder]', (el) => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: '.cache/personal-data/reminder-mobile.png', fullPage: true });
    const postpone = await page.evaluateHandle(() => [...document.querySelectorAll('[data-testid=backup-reminder] button')].find((b) => b.textContent.includes('明天再提醒')));
    await postpone.asElement().click(); await postpone.dispose();
    await page.waitForSelector('[data-testid=backup-reminder]', { hidden: true });
    await page.reload(); await page.waitForSelector('.lobby-screen');
    assert.equal(await page.$('[data-testid=backup-reminder]'), null);
    await panel(page);
    const toggle = '.personal-data-panel input[type=checkbox]';
    await page.click(toggle);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.backup.reminder')).enabled), false);
    assert.deepEqual(errors, []);
  });
  test('a delayed deployment default never overwrites a typed address', async (t) => {
    const { page } = await open(t);
    await page.setRequestInterception(true);
    let pending;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/personal-data-config.json') pending = request;
      else void request.continue();
    });
    await panel(page);
    await page.$eval('.personal-data-panel input:not([type=file]):not([type=checkbox])', (e) => { e.value = 'https://manual.example.test/'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.ok(pending);
    await pending.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ migrationSource: 'https://old.example.test/' }) });
    await page.waitForNetworkIdle({ idleTime: 200 });
    assert.equal(await page.$eval('.personal-data-panel input:not([type=file]):not([type=checkbox])', (e) => e.value), 'https://manual.example.test/');
  });
  test('export, copy fallback, invalid input, preview and merged restore across reload', async (t) => {
    const { page, errors } = await open(t);
    await page.evaluate(async () => {
      const { writeBackdrop, writeMusic } = await import('/js/ui/personalData.js');
      await writeBackdrop(new Blob(['backdrop-bytes'], { type: 'image/jpeg' }));
      await writeMusic({ blob: new Blob(['music-bytes'], { type: 'audio/mpeg' }), name: 'sample.mp3', enabled: true, paused: true });
      localStorage.setItem('sp.pref.loadout', JSON.stringify({ v: 1, entries: {} }));
      localStorage.setItem('sp.pref.notices-seen', '["seen-id"]');
      localStorage.setItem('sp.plugin.sample.value', '{"hello":"中文"}');
      localStorage.setItem('sp.pref.stats', JSON.stringify({ v: 3, records: [] }));
    });
    await panel(page); await clickText(page, '生成恢复码');
    await page.waitForSelector('[data-testid=personal-data-export]');
    const code = await page.$eval('[data-testid=personal-data-export]', (e) => e.value);
    assert.ok(code.startsWith('SPDATA1.'));
    await page.evaluate(() => {
      const original = document.execCommand.bind(document);
      document.execCommand = (cmd) => cmd === 'copy' ? (globalThis.__copied = document.activeElement.value, true) : original(cmd);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    });
    await clickText(page, '复制恢复码');
    await page.waitForFunction(() => document.querySelector('.personal-data-modal [role=status]')?.textContent.includes('已复制'));
    assert.equal(await page.evaluate(() => globalThis.__copied), code);
    await page.evaluate(() => {
      const click = HTMLAnchorElement.prototype.click;
      const create = URL.createObjectURL.bind(URL), blobs = new Map();
      URL.createObjectURL = (blob) => { const url = create(blob); blobs.set(url, blob); return url; };
      HTMLAnchorElement.prototype.click = function () {
        if (this.download.endsWith('.spdata')) globalThis.__saved = { name: this.download, text: blobs.get(this.href).text() };
        else click.call(this);
      };
    });
    await clickText(page, '保存恢复码文件');
    assert.equal(await page.evaluate(async () => globalThis.__saved.text), code);
    const input = '[data-testid=personal-data-input]';
    await page.$eval(input, (e) => { e.value = 'bad'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickText(page, '检查恢复码');
    await page.waitForSelector('.personal-data-modal [role=alert]');
    assert.equal(await page.$('[data-testid=personal-data-preview]'), null);
    await page.evaluate(async () => {
      const { writeBackdrop, writeMusic } = await import('/js/ui/personalData.js');
      localStorage.setItem('sp.name', 'Changed');
      localStorage.removeItem('sp.plugin.sample.value');
      await writeBackdrop(null); await writeMusic(null);
    });
    await page.$eval(input, (e, code) => { e.value = code; e.dispatchEvent(new Event('input', { bubbles: true })); }, code);
    await clickText(page, '检查恢复码');
    await page.waitForSelector('[data-testid=personal-data-preview]');
    assert.match(await page.$eval('[data-testid=personal-data-preview]', (e) => e.textContent), /BackupDoc/);
    await page.evaluate(() => {
      const input = document.querySelector('.personal-data-panel input[type=file]');
      const transfer = new DataTransfer();
      transfer.items.add(new File(['bad'], 'invalid.spdata', { type: 'text/plain' }));
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => !document.querySelector('[data-testid=personal-data-preview]') && !!document.querySelector('.personal-data-modal [role=alert]'));
    await page.evaluate((code) => {
      const input = document.querySelector('.personal-data-panel input[type=file]'), transfer = new DataTransfer();
      transfer.items.add(new File([code], 'backup.spdata', { type: 'text/plain' }));
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    }, code);
    await page.waitForSelector('[data-testid=personal-data-preview]');
    assert.equal(await page.evaluate(() => localStorage.getItem('sp.name')), 'Changed', 'preview does not write');
    await clickText(page, '确认并恢复');
    await page.waitForFunction(() => document.querySelector('.personal-data-modal [role=status]')?.textContent.includes('已恢复'));
    const restored = await page.evaluate(async () => {
      const { readBackdrop, readMusic } = await import('/js/ui/personalData.js');
      const music = await readMusic();
      return { name: localStorage.getItem('sp.name'), plugin: localStorage.getItem('sp.plugin.sample.value'),
        background: await (await readBackdrop()).text(), music: await music.blob.text(), enabled: music.enabled, paused: music.paused };
    });
    assert.deepEqual(restored, { name: 'BackupDoc', plugin: '{"hello":"中文"}', background: 'backdrop-bytes', music: 'music-bytes', enabled: true, paused: true });
    await Promise.all([page.waitForNavigation(), clickText(page, '刷新页面')]);
    await page.waitForFunction(() => !!globalThis.__SP__);
    assert.equal(await page.evaluate(() => globalThis.__SP__.store.get().me.name), 'BackupDoc');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.localAccount')).tag), '4321');
    assert.deepEqual(errors, []);
  });
  test('two origins transfer only after consent and require confirmation before restore', async (t) => {
    const { context, page, errors } = await open(t);
    const old = await context.newPage();
    old.setDefaultNavigationTimeout(90000);
    await old.goto(oldServer.url, { waitUntil: 'domcontentloaded' });
    await old.waitForFunction(() => !!globalThis.__SP__);
    await old.evaluate(() => { localStorage.setItem('sp.name', 'OldDoc'); localStorage.setItem('sp.pref.localAccount', '{"tag":"6789"}'); });
    await old.close();
    await panel(page);
    await page.$eval('.personal-data-panel input:not([type=file]):not([type=checkbox])', (e, value) => { e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })); }, oldServer.url);
    const popupPromise = new Promise((resolve) => page.once('popup', resolve));
    await clickText(page, '打开旧站迁移');
    const popup = await popupPromise;
    await popup.waitForSelector('.personal-data-origin');
    assert.equal(await popup.$eval('.personal-data-origin', (e) => e.textContent), new URL(server.url).origin);
    assert.equal(await page.$('[data-testid=personal-data-preview]'), null);
    await clickText(popup, '允许迁移');
    await page.waitForSelector('[data-testid=personal-data-preview]');
    assert.match(await page.$eval('[data-testid=personal-data-preview]', (e) => e.textContent), /OldDoc/);
    assert.equal(await page.evaluate(() => localStorage.getItem('sp.name')), 'BackupDoc');
    await clickText(page, '确认并恢复');
    await page.waitForFunction(() => localStorage.getItem('sp.name') === 'OldDoc');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.localAccount')).tag), '6789');
    assert.deepEqual(errors, []);
  });
  for (const [width, height] of [[1920, 1080], [1280, 720], [844, 390], [640, 360]]) {
    test(`entry inherits statistics sizing; dialog scroll and focus at ${width}x${height}`, async (t) => {
      const { page, errors } = await open(t, width, height, true);
      const boxes = await page.evaluate(() => [...document.querySelectorAll('.hub-right .hub-tile')].map((e) => {
        const r = e.getBoundingClientRect(); return { text: e.textContent, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, font: getComputedStyle(e.querySelector('.hub-tile__label')).fontSize };
      }));
      const stats = boxes.find((b) => b.text.includes('统计数据')), personal = boxes.find((b) => b.text.includes('导出 / 导入个人数据'));
      assert.equal(personal.width, stats.width); assert.equal(personal.font, stats.font);
      assert.ok(personal.y >= stats.bottom && personal.right <= width && personal.bottom <= height);
      await panel(page);
      await page.screenshot({ path: `.cache/personal-data/dialog-${width}.png` });
      const fit = await page.$eval('.personal-data-modal', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, scroll: e.scrollWidth, client: e.clientWidth }; });
      assert.ok(fit.x >= 0 && fit.y >= 0 && fit.right <= width && fit.bottom <= height);
      assert.ok(fit.scroll <= fit.client + 1, JSON.stringify(fit));
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.$eval('.personal-data-modal', (e) => e.contains(document.activeElement)), true);
      }
      await page.screenshot({ path: `.cache/personal-data/dialog-${width}.png` });
      await page.keyboard.press('Escape');
      await page.waitForSelector('.personal-data-modal', { hidden: true });
      assert.equal(await page.evaluate(() => document.activeElement?.textContent.includes('导出 / 导入个人数据')), true);
      await page.screenshot({ path: `.cache/personal-data/hub-${width}.png` });
      assert.deepEqual(errors, []);
    });
  }
  test('leaving an active room is required; popup blocking reports an actionable error', async (t) => {
    const { page } = await open(t);
    await panel(page);
    const code = await page.evaluate(async () => {
      const { encodePersonalData } = await import('/js/ui/personalData.js');
      return encodePersonalData({ app: 'stronghold-protocol', kind: 'personal-data', v: 1, entries: { 'sp.name': 'Other' } });
    });
    await page.$eval('[data-testid=personal-data-input]', (e, code) => { e.value = code; e.dispatchEvent(new Event('input', { bubbles: true })); }, code);
    await clickText(page, '检查恢复码'); await page.waitForSelector('[data-testid=personal-data-preview]');
    await page.evaluate(() => globalThis.__SP__.store.set({ room: { code: 'TEST' } }));
    await clickText(page, '确认并恢复');
    await page.waitForFunction(() => document.querySelector('.personal-data-modal [role=alert]')?.textContent.includes('离开当前同盟'));
    assert.equal(await page.evaluate(() => localStorage.getItem('sp.name')), 'BackupDoc');
    await page.evaluate(() => { globalThis.__SP__.store.set({ room: null }); window.open = () => null; });
    await page.$eval('.personal-data-panel input:not([type=file]):not([type=checkbox])', (e) => { e.value = 'https://old.example.com'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickText(page, '打开旧站迁移');
    await page.waitForFunction(() => document.querySelector('.personal-data-modal [role=alert]')?.textContent.includes('拦截'));
  });
  test('title screen provides backup before entering a session', async (t) => {
    const { page } = await open(t, 640, 360, true);
    await page.evaluate(() => { sessionStorage.removeItem('sp.entered'); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.title-screen');
    await page.evaluate(() => document.getAnimations().forEach((a) => { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); }));
    for (const [width,height] of [[1920,1080],[1280,720],[844,390],[640,360]]) {
      await page.setViewport({width,height});
      await page.screenshot({path:`.cache/personal-data/title-data-actions-${width}.png`});
      const layout=await page.evaluate(()=>{
        const group=document.querySelector('.title-data-actions'),start=document.querySelector('.title-login > .btn--primary');
        const startBox=start.getBoundingClientRect(),groupBox=group.getBoundingClientRect();
        return {top:groupBox.top,startBottom:startBox.bottom,right:groupBox.right,bottom:groupBox.bottom,
          corner:document.querySelectorAll('.title-corner--tr .title-personal-data,.title-corner--tr .title-data-recover').length,
          controls:[...group.querySelectorAll('button')].map(e=>{const r=e.getBoundingClientRect(),label=e.querySelector('.btn__label').getBoundingClientRect();return {text:e.textContent.trim(),height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),fits:label.left>=r.left&&label.right<=r.right+1};})};
      });
      assert.equal(layout.corner,0);assert.ok(layout.top>=layout.startBottom,JSON.stringify(layout));
      assert.equal(layout.controls.length,2);
      for(const row of layout.controls){assert.ok(row.hit,JSON.stringify({width,height,layout}));assert.ok(row.height>=44);assert.ok(row.fits,JSON.stringify({width,height,layout}));assert.ok(row.x>=0&&row.y>=0&&row.right<=width&&row.bottom<=height,JSON.stringify({width,height,layout}));}
    }
    await page.evaluate(async()=>{const {switchLang}=await import('/js/ui/lang.js');await switchLang('en');});
    await page.screenshot({path:'.cache/personal-data/title-data-actions-640-en.png'});
    assert.equal(await page.$eval('.title-data-actions',group=>[...group.querySelectorAll('button')].every(e=>{const r=e.getBoundingClientRect(),label=e.querySelector('.btn__label').getBoundingClientRect();return r.height>=44&&label.right<=r.right+1&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})),true);
    await page.evaluate(async()=>{const {switchLang}=await import('/js/ui/lang.js');await switchLang('zh');});
    await page.screenshot({ path: '.cache/personal-data/title-640.png' });
    const button = await page.evaluateHandle(() => [...document.querySelectorAll('.title-screen button')].find((b) => b.textContent.trim() === '导出 / 导入个人数据'));
    assert.equal(await button.evaluate((e) => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
    await button.asElement().click(); await button.dispose();
    await page.waitForSelector('.personal-data-modal');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.personal-data-modal', { hidden: true });
    assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), '导出 / 导入个人数据');
  });
});
