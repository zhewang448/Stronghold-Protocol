// Exercise settings with real mouse/touch input, including visual feedback and reload persistence.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { startServer } from '../../server/index.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
describe('settings control hit areas and feedback', { skip: process.env.SP_E2E !== '1' || !existsSync(CHROME) }, () => {
  let server, browser;
  before(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync('.cache/ui-audit', { recursive: true });
  });
  after(async () => {
    const timer = setTimeout(() => browser?.process()?.kill(), 5000);
    try { await browser?.close(); } finally { clearTimeout(timer); await server?.close(); }
  });

  for (const [width, height, textSize, hybrid = false] of [[640, 360, 'sm'], [640, 360, 'xl'], [844, 390, 'sm'], [1280, 720, 'sm'], [1280, 720, 'sm', true]]) {
    test(`all settings controls at ${width}px / ${textSize}${hybrid ? ' / touch desktop' : ''}`, { timeout: 90000 }, async t => {
      const context = await browser.createBrowserContext();
      const touch = width < 1000 || hybrid;
      let page, step = 'open';
      try {
        page = await context.newPage();
        const errors = [];
        page.setDefaultTimeout(5000);
        page.on('pageerror', e => errors.push(e.message));
        await page.setViewport({ width, height, isMobile: width < 1000, hasTouch: touch });
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await page.evaluateOnNewDocument(size => {
          if (!localStorage.getItem('sp.pref.settings')) localStorage.setItem('sp.pref.settings', JSON.stringify({ textSize: size }));
        }, textSize);
        await page.goto(server.url, { waitUntil: 'domcontentloaded' });
        const open = async () => {
          await page.waitForSelector('.title-settings');
          await page.evaluate(() => document.querySelector('.title-settings').click());
          await page.waitForSelector('.modal__box:has(.set-list)');
          await page.evaluate(async () => { await (await import('/js/render/vfx/available.js')).fxAvailable(null); });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        };
        await open();
        assert.deepEqual(await page.$$eval('.set-group > h3', es => es.map(e => e.textContent)), ['常规与声音', '交流与更新', '战斗显示', '画面与性能', '界面与操作', '外观', '资源与诊断']);
        const settings = () => page.evaluate(async () => (await import('/js/ui/settings.js')).settingsStore.get());
        const target = async selector => {
          await page.$eval(selector, e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const geometry = await page.$eval(selector, e => {
            const r = e.getBoundingClientRect();
            const misses = [];
            for (const x of [.2, .5, .8]) for (const y of [.2, .5, .8]) {
              const hit = document.elementFromPoint(r.x + r.width * x, r.y + r.height * y);
              if (hit !== e && !e.contains(hit)) {
                const h = hit?.getBoundingClientRect();
                misses.push({ point: { x: r.x + r.width * x, y: r.y + r.height * y }, target: { x: r.x, y: r.y, w: r.width, h: r.height }, hit: hit?.outerHTML.slice(0, 140), hitRect: h ? { x: h.x, y: h.y, w: h.width, h: h.height } : null });
              }
            }
            return { x: r.x, y: r.y, w: r.width, h: r.height, misses,
              inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
          });
          assert.equal(geometry.inside, true, `${selector} stays in the viewport`);
          assert.deepEqual(geometry.misses, [], `${selector} receives centre and edge taps`);
          if (selector.includes('data-control-group')) {
            const clipped = await page.$eval(selector, e => ({ scroll: e.scrollWidth, width: e.clientWidth }));
            assert.ok(clipped.scroll <= clipped.width + 1, `${selector} text fits without horizontal clipping`);
          }
          return geometry;
        };
        const activate = async selector => {
          const r = await target(selector);
          // Tap the lower right part of option buttons as well as checking their centre geometrically.
          const fraction = selector.includes('data-control-group') ? .8 : .5;
          if (touch) await page.touchscreen.tap(r.x + r.w * fraction, r.y + r.h * fraction);
          else await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
        };
        const groups = await page.$$eval('.set-list .set-seg', es => es.filter(e => e.getClientRects().length && !e.closest('.set-lang')).map((e, i) => {
          e.dataset.controlGroup = String(i);
          const key = e.closest('.set-voice') ? 'voiceLang' : e.matches('.set-textsize') ? 'textSize'
            : e.matches('.set-seg--fps') ? 'fpsLimit' : e.closest('[data-testid="official-fx"]') ? 'officialFx' : 'quality';
          return { id: i, key, count: e.querySelectorAll('button').length };
        }));
        assert.ok(groups.some(g => g.key === 'voiceLang') && groups.some(g => g.key === 'quality'), 'settings option groups are present');
        const options = { voiceLang: ['cn', 'jp', 'en', 'kr'], quality: ['low', 'medium', 'high'], officialFx: ['off', 'lite', 'full'], textSize: ['sm', 'md', 'lg', 'xl'], fpsLimit: [0, 30, 60, 120] };
        let clicks = 0;
        for (const group of groups) {
          for (let n = 0; n < group.count; n++) {
            step = `${group.key} option ${n}`;
            const selector = `[data-control-group="${group.id}"] button:nth-child(${n + 1})`;
            await activate(selector);
            const expected = options[group.key][n];
            await page.waitForFunction((key, expected) => JSON.parse(localStorage.getItem('sp.pref.settings'))?.[key] === expected, {}, group.key, expected);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            assert.equal((await settings())[group.key], expected);
            const feedback = await page.$eval(selector, e => ({ checked: e.getAttribute('aria-checked'), active: e.classList.contains('is-on'),
              colour: getComputedStyle(e).backgroundColor, otherColours: [...e.parentElement.querySelectorAll('button')].filter(b => b !== e).map(b => getComputedStyle(b).backgroundColor) }));
            assert.equal(feedback.checked, 'true');
            assert.equal(feedback.active, true);
            assert.ok(feedback.otherColours.every(c => c !== feedback.colour), `${group.key} visibly highlights only the selected value: ${JSON.stringify(feedback)}`);
            clicks++;
          }
        }
        const switches = await page.$$eval('.set-list .set-row > [role="switch"]', es => es.map((e, i) => {
          e.dataset.controlSwitch = String(i);
          return { id: i, label: e.getAttribute('aria-label') };
        }));
        for (const control of switches) {
          step = `switch ${control.label}`;
          const selector = `[data-control-switch="${control.id}"]`;
          const previous = await page.$eval(selector, e => e.getAttribute('aria-checked'));
          const saved = await settings();
          await activate(selector);
          await page.waitForFunction((s, prev) => document.querySelector(s).getAttribute('aria-checked') !== prev, {}, selector, previous);
          const changed = await settings();
          const changedKeys = Object.keys(saved).filter(key => JSON.stringify(saved[key]) !== JSON.stringify(changed[key]));
          if (control.label === '部署时镜头缩放') {
            assert.deepEqual(changedKeys.sort(), ['deploymentZoom', 'prepDeployFold']);
            assert.equal(changed.deploymentZoom, changed.prepDeployFold, 'the migrated alias follows the same switch');
          } else assert.equal(changedKeys.length, 1, `${control.label} changes one setting`);
          assert.equal(await page.$eval(selector, e => e.classList.contains('is-on')), previous === 'false');
          clicks++;
        }
        await activate('[data-testid="voice-native"]');
        assert.equal((await settings()).voiceNative, true);
        assert.equal(await page.$eval('[data-testid="voice-native"]', e => e.classList.contains('is-on')), true);
        step = 'screen-fit steps';
        const fitRows = await page.$$eval('.set-fit__row:has(input[data-testid^="fit-"])', es => es.map((e, i) => { e.dataset.controlFit = String(i); return i; }));
        for (const n of fitRows) {
          const row = `[data-control-fit="${n}"]`;
          const aligned = await page.$eval(row, e => {
            const children = [...e.children].map(c => c.getBoundingClientRect());
            return Math.max(...children.map(r => r.top)) < Math.min(...children.map(r => r.bottom));
          });
          assert.equal(aligned, true, 'screen-fit label, minus, slider, plus and value remain in one row');
          await activate(`${row} .set-fit__step:last-of-type`);
          assert.equal(await page.$eval(`${row} input`, e => e.value), '51');
          await activate(`${row} .set-fit__step:first-of-type`);
          assert.equal(await page.$eval(`${row} input`, e => e.value), '50');
        }
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.screenFit'))), { l: 0, r: 0, t: 0, b: 0, ui: 100 });
        step = 'open shortcuts';
        if (await page.$('.set-keys__more:not([open])')) await activate('.set-keys__more > summary');
        await page.waitForSelector('.set-keys__list', { visible: true });
        const keys = await page.$$eval('.set-key[data-action]', es => es.map(e => e.dataset.action));
        for (const action of keys) {
          step = `hotkey ${action}`;
          await activate(`.set-key[data-action="${action}"]`);
          await page.waitForSelector('.set-key.is-waiting');
          await page.keyboard.press('Escape');
          await page.waitForSelector('.set-key.is-waiting', { hidden: true });
        }
        assert.ok(await page.$('.set-list'), 'canceling key capture keeps settings open');
        const sliders = await page.$$eval('.set-list label.set-row .set-range', es => es.map((e, i) => { e.dataset.controlSlider = String(i); return i; }));
        for (const i of sliders) {
          step = `slider ${i}`;
          const selector = `[data-control-slider="${i}"]`;
          const r = await target(selector);
          if (touch) {
            const finger = await page.touchscreen.touchStart(r.x + r.w * .25, r.y + r.h / 2);
            await finger.move(r.x + r.w * .5, r.y + r.h / 2);
            await finger.move(r.x + r.w * .75, r.y + r.h / 2);
            await finger.end();
          } else {
            await page.mouse.move(r.x + r.w * .25, r.y + r.h / 2); await page.mouse.down();
            await page.mouse.move(r.x + r.w * .75, r.y + r.h / 2, { steps: 5 }); await page.mouse.up();
          }
          const v = await page.$eval(selector, e => Number(e.value));
          assert.ok(v >= 65 && v <= 85, `slider ${i} follows the ${touch ? 'touch' : 'mouse'} drag: ${v}`);
          assert.equal((await settings())[['bgm', 'voice', 'sfx'][i]], v / 100);
        }
        const saved = await settings();
        step = 'reload';
        await page.reload({ waitUntil: 'domcontentloaded' });
        await open();
        assert.deepEqual(await settings(), saved, 'every changed preference survives a reload');
        const output = `.cache/ui-audit/settings-controls-${width}-${textSize}${hybrid ? '-hybrid' : ''}.png`;
        await page.$eval('[data-testid="voice-lang"]', e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.screenshot({ path: output });
        assert.deepEqual(errors, []);
        t.diagnostic(`${clicks} radio/switch actions, ${sliders.length} drags, ${keys.length} hotkey controls; 9 hit points per control`);
      } catch (e) {
        t.diagnostic(`failed at ${step}`);
        await page?.screenshot({ path: `.cache/ui-audit/settings-controls-failed-${width}-${textSize}.png` });
        throw e;
      } finally { await context.close(); }
    });
  }
});
