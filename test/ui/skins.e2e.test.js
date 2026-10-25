import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer } from '../e2e/client.mjs';

const CHAR = 'char_498_inside', SKIN = `${CHAR}@kitchen#2`, CHESS = 'chess_char_1_01_a';
const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets/char/skin_avatar/char_498_inside_kitchen_2.png'));

test('outfit selection persists, synchronizes, draws real front/back models and fits desktop/mobile', { skip: !ENABLED, timeout: 180000 }, async () => {
  const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 1, startRound: 1, chess: [CHESS] } });
  const P = (await import('puppeteer-core')).default;
  const browser = { launch: (o) => P.launch({ ...o, args: [...o.args, ...(process.platform === 'win32' ? ['--edge-skip-compat-layer-relaunch'] : [])] }) };
  const c = new Client(browser, srv.base, 'skins', { prefix: 'skins', w: 1280, h: 720 });
  const choice = `[data-skin="${SKIN}"]`;
  try {
    await c.open(); await c.enter('皮肤验证');
    await c.click('.lobby-screen [data-testid="loadout-open"]');
    await c.page.waitForSelector('.lo-op', { visible: true });
    await c.click('[data-testid="skins-random"]');
    await c.page.waitForFunction(async () => (await import('/js/ui/skins.js')).skinsStore.get().skinsSync === 'synced');
    const randomized = await c.page.evaluate(async () => {
      const { data } = await import('/js/data.js');
      const { skinsStore, availableSkins } = await import('/js/ui/skins.js');
      const catalogue = data.get('skins'), manifest = data.get('assets'), entries = skinsStore.get().skins;
      return Object.keys(catalogue.chars).every((id) => {
        const options = availableSkins(catalogue, manifest, id);
        return options.length ? options.some((s) => s.id === entries[id]) : !entries[id];
      }) && Object.keys(entries).length > 0;
    });
    assert.ok(randomized, 'random button selects installed non-default outfits for every eligible operator');
    await c.click('button[title="筛选干员 · 切换列表视图"]');
    await c.click('.lo-search input'); await c.page.keyboard.type('隐现');
    await c.page.waitForFunction(() => document.querySelectorAll('.lo-op').length === 1);
    await c.click('button[title="筛选干员 · 切换列表视图"]');
    await c.click('.lo-op__pick'); await c.page.waitForSelector(choice, { visible: true });
    // Randomization may already select this skin; clicking it then opens the new preview modal.
    await c.page.click('[data-skin=""]');
    await c.page.click(choice);
    await c.page.waitForFunction(async (id) => (await import('/js/ui/skins.js')).skinsStore.get().skinsSync === 'synced'
      && JSON.parse(localStorage.getItem('sp.pref.skins') || '{}').char_498_inside === id, {}, SKIN);
    assert.equal(await c.page.$eval(choice, (e) => e.getAttribute('aria-checked')), 'true');
    assert.equal(await c.page.$eval(choice + ' .lo-skin__name', e => e.textContent), '甜品大奖');
    const posters = await c.page.$$eval('.lo-skin .lo-skin__art--big', els => els.map(el => el.getAttribute('src')));
    assert.equal(new Set(posters).size, posters.length, 'each installed outfit has its own poster');
    assert.match(await c.page.$eval(choice + ' .lo-skin__art--big', el => el.getAttribute('src')), /seat-portrait\/char_498_inside_kitchen_2\.png$/);
    await c.page.click(choice);
    await c.page.waitForSelector('.lo-skin-preview img', { visible: true });
    assert.match(await c.page.$eval('.lo-skin-preview img', el => el.getAttribute('src')), /seat-portrait\/char_498_inside_kitchen_2\.png$/);
    await c.page.waitForFunction(() => {
      const img = document.querySelector('.lo-skin-preview img'); return img?.complete && img.naturalWidth > 0;
    });
    await c.page.keyboard.press('Escape');
    await c.page.waitForFunction(() => !document.querySelector('.lo-skin-preview'));
    await c.shot('desktop-picker');
    await c.page.setViewport({ width: 844, height: 390 });
    await sleep(400); await c.page.$eval(choice, (e) => e.scrollIntoView({ block: 'center' }));
    const layout = await c.page.$eval(choice, (el) => {
      const r = el.getBoundingClientRect(), t = el.querySelector('.lo-skin__text');
      return { inside: r.left >= 0 && r.right <= innerWidth + 1, wraps: t.scrollWidth <= t.clientWidth + 1, image: el.querySelector('img')?.naturalWidth > 0 };
    });
    assert.deepEqual(layout, { inside: true, wraps: true, image: true });
    await c.shot('mobile-picker');
    const randomButtonFits = await c.page.$eval('[data-testid="skins-random"]', (el) => {
      const r = el.getBoundingClientRect();
      const tabs = document.querySelector('.lo-top__left').getBoundingClientRect();
      return r.left >= tabs.right && r.right <= innerWidth;
    });
    assert.ok(randomButtonFits, 'mobile random button stays clear of navigation');
    await c.page.setViewport({ width: 1280, height: 720 }); await c.page.keyboard.press('Escape');
    await c.page.waitForFunction(() => !document.querySelector('.lo-drawer'));
    await c.page.keyboard.press('Escape');
    await c.page.waitForFunction(() => !document.documentElement.classList.contains('sp-loadout-open'));
    // Exercise the retained HTTP fallback here; resources.e2e covers the secure-context SW workflow.
    await c.page.evaluate(() => {
      globalThis.__skinSecureDescriptor = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    });
    await c.click('.lobby-screen [data-testid="settings-btn"]');
    await c.page.waitForSelector('[data-testid="preload-section"]');
    await c.page.$eval('[data-testid="preload-section"]', (e) => e.scrollIntoView({ block: 'center' }));
    await c.page.click('[data-testid="preload-section"] button');
    await c.page.waitForSelector('[data-testid="preload-section"] progress');
    await c.page.click('[data-testid="preload-section"] button');
    await c.page.waitForFunction(() => document.querySelector('[data-testid="preload-section"] .set-hint')?.textContent.includes('已取消'));
    await c.shot('preload-cancelled'); await c.page.keyboard.press('Escape');
    await c.page.evaluate(() => {
      const descriptor = globalThis.__skinSecureDescriptor;
      if (descriptor) Object.defineProperty(window, 'isSecureContext', descriptor);
      else delete window.isSecureContext;
      delete globalThis.__skinSecureDescriptor;
    });

    await c.createSimulation('独立模拟', '标准模拟');
    await c.waitFor((s) => !!s.room, 'room');
    if (!(await c.st()).phase) await c.click('.rs-foot__right button', '开始模拟');
    await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing');
    const published = await c.page.evaluate(() => {
      const s = globalThis.__SP__.store.get(); return s.match.public.players.find((p) => p.playerId === s.me.playerId).skins;
    });
    assert.equal(published[CHAR], SKIN);
    await c.click('.brief__foot .btn--primary', '准备就绪');
    await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'draft');
    await c.click('.dband', null, { nth: 1 }); await c.click('.draft-detail__btns .btn--primary', '确认选择');
    await c.waitFor((s) => s.phase === 'PREP' && s.hand > 0, 'prep');
    await c.page.waitForFunction((skin) => {
      const views = globalThis.__SP_VIEW__?.raw?.debug?.views;
      return views && [...views.values()].some((v) => v.info?.skin === skin && v.spineReady && v._actorEntry?.skel.includes('kitchen_2/front/'));
    }, { timeout: 30000 }, SKIN);
    const [piece] = (await c.handPieces('chess')).filter((p) => p.id === CHESS);
    assert.ok(piece);
    await c.shot('front-model');
    // Read back a small render region from the actual WebGL canvas, not just a DOM canvas presence check.
    const pixelCheck = await c.page.evaluate(() => {
      const raw = globalThis.__SP_VIEW__.raw, canvas = raw.debug.app.view;
      const renderer = raw.debug.app.renderer;
      renderer.render(raw.debug.app.stage);
      const bytes = renderer.extract.pixels(raw.debug.app.stage);
      return { width: canvas.width, height: canvas.height, nonzero: bytes.some((v) => v > 0) };
    });
    assert.ok(pixelCheck.width > 0 && pixelCheck.height > 0 && pixelCheck.nonzero);
    const animationTime = await c.page.evaluate((uid) => globalThis.__SP_VIEW__.raw.debug.views.get(`p:${uid}`).actor.spine.state.tracks[0]?.trackTime, piece.uid);
    await sleep(300);
    assert.ok(await c.page.evaluate((uid, before) => globalThis.__SP_VIEW__.raw.debug.views.get(`p:${uid}`).actor.spine.state.tracks[0]?.trackTime > before, piece.uid, animationTime));
    await c.page.evaluate((uid) => globalThis.__SP_VIEW__.raw.setPieceDir(uid, 'UP'), piece.uid);
    await c.page.waitForFunction((uid) => globalThis.__SP_VIEW__.raw.debug.views.get(`p:${uid}`)?._actorEntry?.skel.includes('kitchen_2/back/'), { timeout: 20000 }, piece.uid);
    await c.shot('back-model');
    await c.page.setViewport({ width: 844, height: 390 }); await sleep(300); await c.shot('mobile-model');
    await c.page.setViewport({ width: 1280, height: 720 });
    const tile = await c.freeTileFor(piece.uid);
    await c.drag(await c.piecePoint(piece.uid), await c.tilePoint(tile.row, tile.col));
    await c.page.waitForSelector('.fwheel__dia'); await c.swipe('UP');
    await c.waitFor((s) => s.board > 0, 'deployed');
    await c.click('.readybtn'); await c.waitFor((s) => s.phase === 'COMBAT', 'combat');
    await c.page.waitForFunction((skin) => {
      const raw = globalThis.__SP_VIEW__?.raw;
      return raw?.mode === 'battle' && [...raw.debug.views.values()].some((v) => v.info?.skin === skin && v.spineReady && v._actorEntry?.skel.includes('kitchen_2'));
    }, { timeout: 30000 }, SKIN);
    await c.shot('battle-model');
    await c.page.evaluate(async () => { const s = await import('/js/ui/skins.js'); s.setSkin('char_498_inside', null); });
    await c.page.waitForFunction((uid) => [...globalThis.__SP_VIEW__.raw.debug.views.values()].some((v) => v.uid === uid && v.spineReady && !v._actorEntry?.skel.includes('kitchen_2')), { timeout: 20000 }, piece.uid);
    assert.deepEqual(c.problems.filter((p) => p.startsWith('pageerror:')), []);
  } finally { await c.close(); await srv.stop(); }
});
