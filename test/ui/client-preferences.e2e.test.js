import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { resetHostSettings } from '../../server/match/hostSettings.js';
import { getClientPreferencePolicy } from '../../server/clientPreferences.js';
import { CLIENT_PREFERENCE_FIELDS } from '../../shared/clientPreferences.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('console client settings retain personal values through defaults, forced values, reload and permission restoration',
  { skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000 }, async t => {
    resetHostSettings();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-client-policy-ui-')), output = path.resolve('.cache/dynamic-illustrations-new-operators/client-policy/ui'); fs.mkdirSync(output, { recursive: true });
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
    const admin = await startAdmin({ lobby: srv.lobby, network: srv.network, port: 0, settingsFile: path.join(temp, 'settings.json'), resultsDir: temp, log: { info() {}, error() {} } });
    const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--edge-skip-compat-layer-relaunch'] });
    t.after(async () => { await browser.close(); await admin.close(); await srv.close(); resetHostSettings(); fs.rmSync(temp, { recursive: true, force: true }); });
    const errors = [], user = await browser.newPage(), consolePage = await browser.newPage();
    const languageEvents = [];
    await user.setRequestInterception(true);
    user.on('request', async request => {
      // Exercise a host policy arriving before the language-pack catalogue.
      if (new URL(request.url()).pathname === '/packs/index.json') await new Promise(resolve => setTimeout(resolve, 300));
      await request.continue().catch(() => {});
    });
    user.on('console', event => { if (event.type() === 'warn') languageEvents.push(event.text()); });
    user.on('response', response => { if (/i18n|packs\/index/.test(response.url())) languageEvents.push(response.status() + ' ' + response.url()); });
    for (const page of [user, consolePage]) { page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); await page.setViewport({ width: 1440, height: 1000 }); }
    t.after(() => { fs.writeFileSync(path.join(output, 'browser-errors.json'), JSON.stringify(errors, null, 2)); });
    await user.evaluateOnNewDocument(() => {
      if (!localStorage.getItem('qa.seeded')) {
        localStorage.setItem('sp.pref.settings', JSON.stringify({ bgm: 0.21, voice: 0.35, dynamicIllustrations: 'static', textSize: 'sm' }));
        localStorage.setItem('sp.pref.screenFit', JSON.stringify({ l: 8, r: 0, t: 0, b: 0, ui: 100 }));
        localStorage.setItem('sp.pref.lang', JSON.stringify('zh')); localStorage.setItem('qa.seeded', '1');
        localStorage.setItem('sp.pref.skinRandom', JSON.stringify({ scope: 'equipped', auto: true, locked: { char_222_bpipe: true } }));
        localStorage.setItem('sp.pref.ui-plugins', '["personal-test"]'); localStorage.setItem('sp.pref.cosmetics', '["personal-theme"]');
        localStorage.setItem('sp.pref.lobby.media', JSON.stringify({ scene: 'frost', music: false }));
        localStorage.setItem('sp.pref.loadout.view', '"deck"');
        localStorage.setItem('sp.backup.reminder', JSON.stringify({ enabled: false, firstSeen: 1 }));
      }
      localStorage.setItem('sp.name', 'PolicyQA'); sessionStorage.setItem('sp.entered', '1');
    });
    await user.bringToFront(); await user.goto(srv.url); await user.waitForFunction(() => window.__SP__?.store.get().connection.status === 'online');
    const effective = () => user.evaluate(async () => ({ ...(await import('/js/ui/settingsStore.js')).settingsStore.get(), fit: (await import('/js/ui/screenFit.js')).fitStore.get(), lang: document.documentElement.lang,
      random: (await import('/js/ui/skins.js')).skinRandomStore.get(), uiPlugins: (await import('/js/ui/uiPlugins.js')).uiPlugins.get().ids,
      cosmetics: (await import('/js/content.js')).personal.get().ids, scene: (await import('/js/ui/lobbyMedia.js')).mediaStore.get().prefs.scene,
      reminder: (await import('/js/ui/backupReminder.js')).reminderState().enabled, view: (await import('/js/screens/loadout.js')).loadoutViewPref() }));
    const saved = () => user.evaluate(() => Object.fromEntries(['settings', 'screenFit', 'lang', 'skinRandom', 'ui-plugins', 'cosmetics', 'lobby.media', 'loadout.view'].map(key => [key === 'screenFit' ? 'fit' : key, localStorage.getItem('sp.pref.' + key)]).concat([['reminder', localStorage.getItem('sp.backup.reminder')]])));
    const baseline = await saved(); assert.equal((await effective()).bgm, 0.21);
    const waitLanguage = async want => {
      try { await user.waitForFunction(want => document.documentElement.lang === want, { polling: 100 }, want); }
      catch (error) {
        const state = await user.evaluate(async () => ({ lang: document.documentElement.lang,
          preference: (await import('/js/ui/lang.js')).languagePreferences.get(), policy: (await import('/js/clientPreferences.js')).clientPreferencePolicy.get().config,
          actual: (await import('/shared/i18n.js')).getLang(), packs: (await import('/shared/i18n.js')).getLangs() }));
        fs.writeFileSync(path.join(output, 'language-debug.json'), JSON.stringify({ state, languageEvents }, null, 2)); throw error;
      }
    };
    await consolePage.bringToFront(); await consolePage.goto(admin.url); await consolePage.click('[data-tab="settings"]');
    await consolePage.waitForSelector('[data-client-default="settings.bgm"]');
    t.diagnostic('client settings table visible');
    assert.equal(await consolePage.$$eval('[data-client-control]', inputs => inputs.length), CLIENT_PREFERENCE_FIELDS.length);
    assert.ok(await consolePage.$$eval('[data-client-control]', inputs => inputs.every(e => e.checked)));
    const setInput = async (key, value) => consolePage.$eval(`[data-client-default="${key}"]`, (e, value) => { e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    const save = async () => { await consolePage.bringToFront(); await consolePage.click('[data-client-preferences-save]'); await consolePage.waitForFunction(() => document.querySelector('#client-preferences-saved').textContent.includes('已保存')); };
    await setInput('settings.bgm', '0.8'); await consolePage.select('[data-client-default="settings.dynamicIllustrations"]', 'auto');
    await setInput('screenFit.l', '20'); await setInput('language', 'en'); await save();
    t.diagnostic('host defaults saved');
    assert.equal((await effective()).bgm, 0.21); assert.equal((await effective()).dynamicIllustrations, 'static');
    assert.deepEqual(await saved(), baseline, 'new host defaults never overwrite existing preference bytes');
    await consolePage.select('[data-client-default="loadout.view"]', 'list');
    await consolePage.select('[data-client-default="lobbyMedia.scene"]', 'night');
    const keys = ['settings.bgm', 'settings.dynamicIllustrations', 'screenFit.l', 'language', 'skinRandom.scope', 'skinRandom.auto', 'skinRandom.locked', 'uiPlugins.ids', 'cosmetics.ids', 'lobbyMedia.scene', 'loadout.view', 'backupReminder.enabled'];
    for (const key of keys) await consolePage.click(`[data-client-control="${key}"]`); await save();
    t.diagnostic('host locks saved');
    await user.bringToFront();
    await user.waitForFunction(async () => (await import('/js/ui/settingsStore.js')).settingsStore.get().bgm === 0.8);
    await waitLanguage('en');
    assert.equal((await effective()).dynamicIllustrations, 'auto'); assert.equal((await effective()).fit.l, 20);
    assert.deepEqual((await effective()).random, { scope: 'all', auto: false, locked: {} });
    assert.deepEqual((await effective()).uiPlugins, []); assert.deepEqual((await effective()).cosmetics, []);
    assert.equal((await effective()).scene, 'night'); assert.equal((await effective()).view, 'list'); assert.equal((await effective()).reminder, true);
    assert.deepEqual(await saved(), baseline);
    t.diagnostic('client effective values forced without storage writes');
    await user.bringToFront();
    await user.click('[data-testid="settings-btn"]');
    await user.waitForSelector('[data-client-preference="settings.bgm"][data-locked="true"]');
    assert.equal(await user.$eval('[data-client-preference="settings.bgm"] input', e => e.matches(':disabled')), true);
    assert.equal(await user.$eval('[aria-label="Language / 语言"]', e => e.matches(':disabled')), true);
    await user.$eval('[data-client-preference="settings.dynamicIllustrations"]', e => e.scrollIntoView({ block: 'center' }));
    await user.screenshot({ path: path.join(output, 'client-locked-desktop.png') });
    t.diagnostic('client locked UI visible');
    // Changing an allowed setting cannot copy forced values back into storage.
    await user.$eval('[data-client-preference="settings.voice"] input', e => e.scrollIntoView({ block: 'center' }));
    await user.focus('[data-client-preference="settings.voice"] input');
    await user.keyboard.press('Home'); await user.keyboard.press('ArrowRight');
    assert.equal((await effective()).voice, 0.05);
    assert.equal(JSON.parse((await saved()).settings).bgm, 0.21);
    await user.setViewport({ width: 844, height: 390, hasTouch: true });
    await user.waitForSelector('[data-testid="settings-btn"]');
    await user.click('[data-testid="settings-btn"]');
    await user.waitForSelector('[data-client-preference="settings.dynamicIllustrations"]');
    await waitLanguage('en');
    await user.$eval('[data-client-preference="settings.dynamicIllustrations"]', e => e.scrollIntoView({ block: 'center' }));
    assert.ok(await user.$eval('.modal__box:has(.set-list)', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }));
    await user.screenshot({ path: path.join(output, 'client-locked-touch.png') });
    await user.reload(); await user.waitForFunction(async () => (await import('/js/ui/settingsStore.js')).settingsStore.get().bgm === 0.8);
    await consolePage.bringToFront(); await consolePage.reload(); await consolePage.click('[data-tab="settings"]'); await consolePage.waitForSelector('[data-client-control="settings.bgm"]');
    assert.equal(await consolePage.$eval('[data-client-control="settings.bgm"]', e => e.checked), false);
    assert.equal(await consolePage.$eval('[data-client-default="settings.bgm"]', e => e.value), '0.8');
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      await consolePage.setViewport({ width, height }); await consolePage.type('#client-preferences-search', '背景音乐');
      await consolePage.$eval('#client-preferences-settings', e => e.scrollIntoView());
      assert.ok(await consolePage.$eval('#settings', e => e.scrollWidth <= e.clientWidth + 1));
      await consolePage.screenshot({ path: path.join(output, `console-${width}.png`) });
      await consolePage.$eval('#client-preferences-search', e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    // Restore controls from the real console. Personal values, including the
    // independently edited voice volume, return without a write to the others.
    await consolePage.click('[data-client-allow-all]'); await save();
    await user.bringToFront();
    await user.waitForFunction(async () => (await import('/js/ui/settingsStore.js')).settingsStore.get().bgm === 0.21);
    await waitLanguage('zh-CN');
    assert.equal((await effective()).dynamicIllustrations, 'static'); assert.equal((await effective()).fit.l, 8); assert.equal((await effective()).voice, 0.05);
    assert.deepEqual((await effective()).random, { scope: 'equipped', auto: true, locked: { char_222_bpipe: true } });
    assert.deepEqual((await effective()).uiPlugins, ['personal-test']); assert.deepEqual((await effective()).cosmetics, ['personal-theme']);
    assert.equal((await effective()).scene, 'frost'); assert.equal((await effective()).view, 'deck'); assert.equal((await effective()).reminder, false);
    await user.bringToFront(); await user.setViewport({ width: 1440, height: 1000 });
    await user.waitForSelector('[data-testid="settings-btn"]');
    await user.click('[data-testid="settings-btn"]');
    await user.waitForSelector('[data-client-preference="settings.dynamicIllustrations"]');
    await user.$eval('[data-client-preference="settings.dynamicIllustrations"]', e => e.scrollIntoView({ block: 'center' }));
    assert.equal(await user.$eval('[data-client-preference="settings.dynamicIllustrations"] button', e => e.matches(':disabled')), false);
    await user.screenshot({ path: path.join(output, 'client-restored-desktop.png') });
    const context = await browser.createBrowserContext(), fresh = await context.newPage();
    await fresh.goto(srv.url); await fresh.waitForFunction(async () => (await import('/js/ui/settingsStore.js')).settingsStore.get().bgm === 0.8);
    assert.equal(await fresh.evaluate(async () => (await import('/js/ui/settingsStore.js')).settingsStore.get().dynamicIllustrations), 'auto');
    assert.ok(Object.values(getClientPreferencePolicy().userControls).every(Boolean));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ baseline, after: await saved(), restored: await effective(), freshDefault: 0.8, fields: CLIENT_PREFERENCE_FIELDS.length, errors }, null, 2));
    assert.deepEqual(errors, []);
  });
