import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { startServer } from '../../server/index.js';

test('real preview UI: default/local setting, wheel anchor, pinch, pan, keyboard, phase, resize and release',
  { skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000 }, async t => {
    const out = path.resolve('.cache/dynamic-illustrations-new-operators/followup/interaction'); fs.mkdirSync(out, { recursive: true });
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--edge-skip-compat-layer-relaunch'] });
    t.after(async () => { await browser.close(); await srv.close(); });
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: true }); await page.goto(srv.url);
    await page.evaluate(() => {
      localStorage.setItem('sp.name', 'Preview QA'); sessionStorage.setItem('sp.entered', '1');
    });
    await page.reload(); await page.waitForFunction(() => window.__SP__?.store.get().connection.status === 'online');
    await page.click('[data-testid="settings-btn"]'); await page.waitForSelector('[role="switch"][aria-label="动态立绘"]');
    assert.equal(await page.$eval('[role="switch"][aria-label="动态立绘"]', e => e.getAttribute('aria-checked')), 'true');
    await page.click('[role="switch"][aria-label="动态立绘"]');
    await page.reload(); await page.waitForSelector('[data-testid="settings-btn"]'); await page.click('[data-testid="settings-btn"]');
    assert.equal(await page.$eval('[role="switch"][aria-label="动态立绘"]', e => e.getAttribute('aria-checked')), 'false');
    await page.screenshot({ path: path.join(out, 'settings-off.png') });
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      const [{ h, render }, { SkinSection }, { data }, { setSkin }] = await Promise.all([import('/vendor/preact.module.js'), import('/js/ui/skinPicker.js'), import('/js/data.js'), import('/js/ui/skins.js')]);
      await Promise.all(['assets', 'skins'].map(name => data.load(name)));
      setSkin('char_472_pasngr', 'char_472_pasngr@epoque#17');
      const host = document.createElement('div'); host.id = 'qa-skins'; Object.assign(host.style, { position: 'fixed', inset: '20px', zIndex: 55, overflow: 'auto', background: '#17201c' }); document.body.appendChild(host);
      render(h(SkinSection, { charId: 'char_472_pasngr' }), host);
      window.qaShowOperator = charId => render(h(SkinSection, { charId }), host);
      window.qaUnmount = () => { render(null, host); host.remove(); };
    });
    await page.waitForSelector('[data-testid="illustration-preview"]'); await page.click('[data-testid="illustration-preview"]');
    const viewport = '[data-testid="illustration-viewport"]', zoom = () => page.$eval('[data-testid="illustration-zoom"]', e => parseInt(e.textContent));
    assert.equal(await zoom(), 100); assert.equal(await page.$('[data-testid="dynamic-pause"]'), null, 'global off starts preview static');
    await page.click('.lo-dynamic [aria-label="立绘显示"] [role="radio"][aria-checked="false"]');
    try { await page.waitForFunction(() => ['ready', 'fallback'].includes(document.querySelector('.lo-dynamic .dyn-cover')?.dataset.state)); }
    catch (error) { console.log('preview diagnostics', await page.$eval('.lo-dynamic', e => e.outerHTML)); await page.screenshot({ path: path.join(out, 'failure.png') }); throw error; }
    assert.equal(await page.$eval('.lo-dynamic .dyn-cover', e => e.dataset.state), 'ready', JSON.stringify(await page.evaluate(() => ({text:document.querySelector('.lo-dynamic')?.textContent,errors:window.__SP__?.store.get().diagnostics}))));
    assert.ok(await page.$eval('.lo-dynamic', e => e.textContent.includes('仅在本次预览播放')));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).dynamicIllustrations), 'static');
    const rect = await page.$eval(viewport, e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const anchor = { x: rect.x + rect.width * 0.6, y: rect.y + rect.height * 0.45 };
    await page.mouse.move(anchor.x, anchor.y); await page.mouse.wheel({ deltaY: -200 });
    assert.ok(await zoom() > 100);
    const before = await page.$eval(viewport, e => ({ zoom: +e.style.getPropertyValue('--art-zoom'), x: parseFloat(e.style.getPropertyValue('--art-x')), y: parseFloat(e.style.getPropertyValue('--art-y')) }));
    assert.ok(Math.abs(before.x - (rect.width * 0.1) * (1 - before.zoom)) < 1, 'wheel retains pointer anchor');
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + 50, rect.y + rect.height / 2 + 30); await page.mouse.up();
    const pan = await page.$eval(viewport, e => parseFloat(e.style.getPropertyValue('--art-x'))); assert.ok(pan > before.x);
    await page.click('[data-testid="dynamic-pause"]'); const saved = await zoom();
    await page.select('[aria-label="动作"]', 'Special'); assert.equal(await zoom(), saved);
    await page.click('[aria-label="立绘显示"] [role="radio"][aria-checked="false"]'); assert.equal(await zoom(), saved);
    await page.focus(viewport); await page.keyboard.press('0'); assert.equal(await zoom(), 100);
    await page.keyboard.press('+'); assert.equal(await zoom(), 125); await page.keyboard.press('Home'); assert.equal(await zoom(), 100);
    await page.setViewport({ width: 640, height: 360, isMobile: false, hasTouch: true });
    const cdp = await page.createCDPSession(); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const small = await page.$eval(viewport, e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: small.x - 30, y: small.y }, { id: 2, x: small.x + 30, y: small.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: small.x - 65, y: small.y + 8 }, { id: 2, x: small.x + 65, y: small.y + 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); assert.ok(await zoom() >= 180, 'two real touch points enlarge the preview');
    await page.screenshot({ path: path.join(out, 'touch-pinch.png') });
    await page.focus(viewport); await page.keyboard.press('Home');
    const close = '.skin-preview-portal .modal__actions button'; await page.click(close);
    await page.waitForFunction(() => !document.querySelector('.skin-preview-portal'));
    await page.waitForFunction(async () => (await import('/js/assets.js')).assets.spine.stats().refs === 0);
    await page.evaluate(() => window.qaShowOperator('char_4247_oxi'));
    await page.click('[data-testid="illustration-preview"]');
    await page.waitForSelector('[aria-label="立绘阶段"]');
    const normal = await page.$eval('.lo-dynamic__art img', e => e.getAttribute('src'));
    assert.ok(normal.includes('char_4247_oxi_1.png'), normal);
    await page.click('[aria-label="立绘阶段"] [data-value="elite"]');
    await page.waitForFunction(() => document.querySelector('.lo-dynamic__art img')?.src.includes('char_4247_oxi_2.png'));
    const elite = await page.$eval('.lo-dynamic__art img', e => e.getAttribute('src')); assert.notEqual(normal, elite);
    await page.click(close); await page.evaluate(() => window.qaUnmount());
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ wheel: before, pan, pinch: true, defaultOn: true, offPersisted: true, temporaryPlay: true, phases: { normal, elite }, refsAfterClose: 0, errors }, null, 2));
    assert.deepEqual(errors, []);
  });
