import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startRealServer, CHROME, hasChrome, OUT } from '../e2e/client.mjs';

test('manual release history is always reachable and independent of automatic notices', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const server = await startRealServer({ env: { SP_ASSET_INDEX: '0' } });
  let browser;
  try {
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run', '--mute-audio'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('sp.pref.settings', JSON.stringify({ upstreamReleaseNotes: false, extensionReleaseNotes: false }));
      localStorage.setItem('sp.release-notes', 'manual-baseline');
      localStorage.setItem('sp.release-notes.upstream', 'manual-upstream');
    });
    await page.goto(server.base, { waitUntil: 'networkidle0' });
    const button = '[data-testid="release-history-button"]';
    const dialog = 'dialog[data-release-history][open]';
    await page.waitForSelector('.title-screen ' + button);
    const before = await page.evaluate(() => [localStorage.getItem('sp.release-notes'), localStorage.getItem('sp.release-notes.upstream'), localStorage.getItem('sp.pref.settings')]);
    await page.click(button); await page.waitForSelector('[data-release-history-source="upstream"]');
    assert.equal(await page.$$eval('.release-history__release', els => els.length), 16);
    assert.match(await page.$eval('.release-history__release summary', el => el.textContent), /0.3.3/);
    await page.click('.release-history__release:last-child summary');
    assert.equal(await page.$eval('.release-history__release:last-child', el => el.open), true);
    await page.click('[data-release-history-source="extension"]');
    assert.ok(await page.$$eval('.release-history__release', els => els.length) >= 40);
    assert.match(await page.$eval('.release-notes__body', el => el.textContent), /v0.3.3-extended.1/);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'release-history-desktop.png') });
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog[data-release-history]'));
    assert.equal(await page.$eval(button, el => el === document.activeElement), true);
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('sp.release-notes'), localStorage.getItem('sp.release-notes.upstream'), localStorage.getItem('sp.pref.settings')]), before);
    await page.type('.title-login input', 'HistoryTester');
    await page.click('.title-login .btn--primary');
    await page.waitForSelector('.lobby-screen ' + button);
    await page.click(button); await page.waitForSelector('[data-release-history-source="upstream"]');
    for (const [name, width, height] of [['mobile', 390, 844], ['landscape', 844, 390]]) {
      await page.setViewport({ width, height });
      const fits = await page.$eval(dialog, el => {
        const r = el.getBoundingClientRect(), body = el.querySelector('.release-notes__body');
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && body.clientHeight > 0 && body.scrollHeight > body.clientHeight && body.scrollWidth <= body.clientWidth;
      });
      assert.ok(fits, name);
      await page.screenshot({ path: path.join(OUT, 'release-history-' + name + '.png') });
    }
    await page.click('.release-notes__actions button');
    await page.waitForFunction(() => !document.querySelector('dialog[data-release-history]'));
    await page.setViewport({ width: 844, height: 390 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(OUT, 'release-history-lobby-mobile.png') });
    await page.click(button); await page.waitForSelector('[data-release-history-source="upstream"]');
    await page.keyboard.press('Escape');
    let fail = true;
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().endsWith('/release-history.json') && fail) { fail = false; void request.respond({ status: 503, body: 'unavailable' }); }
      else void request.continue();
    });
    await page.click(button);
    await page.waitForFunction(() => document.querySelector('.release-notes__body')?.textContent.includes('更新内容载入失败'));
    await page.click('.release-notes__body button'); await page.waitForSelector('[data-release-history-source="upstream"]');
    await page.keyboard.press('Escape');
    await page.click('.lobby-settings');
    await page.waitForSelector('[data-testid="release-notes-settings"]');
    await page.click('[data-testid="release-notes-settings"] ' + button);
    await page.waitForSelector('[data-release-history-source="upstream"]');
    await page.keyboard.press('Escape');
    assert.ok(await page.$('[data-testid="release-notes-settings"]'));
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.stop(); }
});

test('release dialogs follow announcement sizing on touch phones, large text and safe areas', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const server = await startRealServer({ env: { SP_ASSET_INDEX: '0' } });
  let browser;
  try {
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run', '--mute-audio'] });
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true, deviceScaleFactor: 2 });
    await page.goto(server.base, { waitUntil: 'networkidle0' });
    const selector = 'dialog[data-release-history][open]';
    const nextFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    fs.mkdirSync(OUT, { recursive: true });
    for (const [name, width, height, text, scale] of [
      ['touch-landscape', 844, 390, 'md', 1], ['touch-small-xl', 640, 360, 'xl', .75],
      ['touch-portrait-xl', 390, 844, 'xl', 1],
    ]) {
      await page.setViewport({ width, height, isMobile: true, hasTouch: true, isLandscape: width > height, deviceScaleFactor: 2 });
      await page.evaluate(async (text, scale) => {
        document.documentElement.dataset.text = text;
        document.documentElement.style.setProperty('--sp-ui', String(scale));
        document.documentElement.style.setProperty('--sa-l', '18px');
        document.documentElement.style.setProperty('--sa-r', '18px');
        document.documentElement.style.setProperty('--sa-b', '12px');
        const { openAnnouncement } = await import('/js/ui/announcement.js'); openAnnouncement();
      }, text, scale);
      await page.waitForSelector('.announcement-modal');
      const notice = await page.$eval('.announcement-modal', element => ({ width: element.getBoundingClientRect().width, titleSize: parseFloat(getComputedStyle(element.querySelector('.modal__title')).fontSize) }));
      await page.evaluate(async () => { (await import('/js/ui/announcement.js')).closeAnnouncement(); });
      await page.waitForFunction(() => !document.querySelector('.announcement-modal'));
      await page.evaluate(async () => { (await import('/js/ui/releaseHistory.js')).showReleaseHistory(); });
      await page.waitForSelector('[data-release-history-source="upstream"]'); await nextFrame();
      const layout = await page.$eval(selector, element => {
        const r = element.getBoundingClientRect(), body = element.querySelector('.release-notes__body');
        const br = body.getBoundingClientRect(), footer = element.querySelector('.release-notes__actions').getBoundingClientRect();
        return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,bodyHeight:br.height,height:r.height,
          footerTop:footer.top,footerBottom:footer.bottom,bodyBottom:br.bottom,touch:getComputedStyle(body).touchAction,
          titleSize:parseFloat(getComputedStyle(element.querySelector('.release-notes__title')).fontSize),
          fontSize:parseFloat(getComputedStyle(element).fontSize),overflow:body.scrollWidth>body.clientWidth,
          scrollable:body.scrollHeight>body.clientHeight,coarse:matchMedia('(pointer: coarse)').matches };
      });
      assert.ok(layout.coarse, name + ' uses actual coarse pointer media queries');
      assert.ok(layout.left >= 18 && layout.right <= width - 18 && layout.top >= 0 && layout.bottom <= height - 12, name + ' respects safe edges ' + JSON.stringify(layout));
      assert.ok(layout.bodyHeight >= height * .3, name + ' leaves a usable reading area');
      assert.ok(layout.bodyBottom <= layout.footerTop + 1 && layout.footerBottom <= layout.bottom, name + ' footer stays visible');
      assert.ok(!layout.overflow && layout.scrollable && layout.touch === 'pan-y', name + ' scrolls vertically');
      assert.ok(Math.abs(layout.titleSize - notice.titleSize) < 1, name + ' heading matches announcement scale');
      const body = await page.$('.release-notes__body');const box = await body.boundingBox();
      const cdp = await page.createCDPSession();
      await page.screenshot({ path: path.join(OUT, 'release-history-' + name + '-before-scroll.png') });
      const x = Math.round(box.x + box.width * .6), startY = Math.round(box.y + box.height * .85);
      await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x,y:startY}] });
      for (let step=1;step<=10;step++) {
        await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x,y:startY-Math.round(box.height*.65*step/10)}] });
        await new Promise(resolve => setTimeout(resolve,25));
      }
      await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
      await page.waitForFunction(() => document.querySelector('.release-notes__body').scrollTop > 0);
      await new Promise(resolve => setTimeout(resolve, 600));
      await page.screenshot({ path: path.join(OUT, 'release-history-' + name + '.png') });
      await page.tap('[data-release-history-source="extension"]');
      await page.waitForFunction(() => document.querySelector('[data-release-history-source="extension"]')?.getAttribute('aria-pressed') === 'true');
      await page.tap('.release-notes__actions button');
      await page.waitForFunction(() => !document.querySelector('dialog[data-release-history]'));
      await cdp.detach();
    }
    await page.setViewport({ width: 640, height: 360, isMobile: true, hasTouch: true, isLandscape: true });
    await page.evaluate(async () => {
      const { showReleaseNotes } = await import('/js/ui/releaseNotes.js');
      const storage = { getItem: () => 'old', setItem() {} };
      showReleaseNotes({version:'new',entries:Array(20).fill('扩展更新内容。')}, {upstream:{version:'new',entries:Array(20).fill('上游更新内容。')},storage});
    });
    await page.waitForSelector('dialog[data-release-notes]');
    assert.equal(await page.$eval('.release-notes__columns', element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
    assert.ok(await page.$eval('.release-notes__body', element => element.clientHeight >= 108 && element.scrollWidth <= element.clientWidth));
    await page.tap('.release-notes__actions button');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.stop(); }
});
