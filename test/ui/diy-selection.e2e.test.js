import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, startRealServer, hasChrome, sleep } from '../e2e/client.mjs';

test('briefing optional roster: discard, atomic apply, confirmed summary, reload and responsive modal', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 240000,
}, async t => {
  const srv = await startRealServer({ env: { SP_ASSET_INDEX: '0', SP_VERSIONS: 'act2autochess' } });
  const c = new Client((await import('puppeteer-core')).default, srv.base, 'roster-selection', { w: 1440, h: 900 });
  t.after(async () => { await c.close(); await srv.stop(); });
  const output = path.resolve('.cache/diy-selection/screenshots'); fs.mkdirSync(output, { recursive: true });
  await c.open('?dev=1'); await c.enter('自选验收');
  await c.page.evaluate(async () => {
    (await import('/js/ui/loadoutSync.js')).setDiyPicks({
      chess_char_5_diy1_a: { charId: 'char_601_cguard' }, chess_char_5_diy2_a: { charId: 'char_602_cdfend' },
      diyBench_5_1: { charId: 'char_603_csnipe' }, diyBench_5_2: { charId: 'char_604_ccast' },
      chess_char_6_diy1_a: { charId: 'char_608_acpion' }, chess_char_6_diy2_a: { charId: 'char_609_acguad' },
      diyBench_6_1: { charId: 'char_610_acfend' }, diyBench_6_2: { charId: 'char_611_acnipe' },
    });
  });
  await sleep(600); await c.createCoop(); await c.click('.rs-go');
  await c.page.waitForSelector('[data-testid="diy-choice-open"]');
  assert.equal(await c.page.$('.brief__diy-dock'), null, 'full candidate list no longer consumes briefing height');
  const confirmed = () => c.page.evaluate(() => globalThis.__SP__.store.get().match.private.diy);
  const summaryCounts = () => c.page.$$eval('[data-summary-tier]', els => els.map(el => el.innerText.trim()));
  const before = await confirmed();
  await c.click('[data-testid="diy-choice-open"]');
  await c.page.waitForFunction(() => document.querySelector('[data-testid="brief-ready"]')?.matches(':disabled'));
  const topButton = await c.page.$eval('.diy-choice-modal .modal__actions button', e => { const r=e.getBoundingClientRect(); return [r.left,r.right]; });
  const chatBox = await c.page.$eval('.chat', e => { const r=e.getBoundingClientRect(); return [r.left,r.right,r.top,r.bottom]; });
  assert.ok(topButton[1] <= chatBox[0] || (chatBox[3] < 0) || (chatBox[2] > 900), 'modal controls clear the floating chat button');
  await c.click('[data-testid="diy-clear-5"]');
  assert.deepEqual(await confirmed(), before, 'clearing remains local until Apply');
  assert.match((await summaryCounts())[0], /2/);
  await c.click('[data-testid="diy-discard"]');
  assert.deepEqual(await confirmed(), before);
  await c.click('[data-testid="diy-choice-open"]');
  assert.equal(await c.page.$$eval('[data-tier="5"] .diychoice__c.is-on', e => e.length), 2);
  const layouts = [];
  for (const [width, height] of [[1440, 900], [1280, 720], [844, 390], [640, 360]]) {
    await c.page.setViewport({ width, height });
    for (const textSize of ['sm', 'md', 'lg', 'xl']) for (const ui of [75, 100]) {
      await c.page.evaluate(async (textSize, ui) => {
        (await import('/js/ui/settings.js')).updateSettings({ textSize });
        (await import('/js/ui/screenFit.js')).updateFit({ ui });
      }, textSize, ui);
      await sleep(40);
      const layout = await c.page.evaluate(() => {
        const r = document.querySelector('.diy-choice-modal').getBoundingClientRect();
        const body = document.querySelector('.diy-choice-modal .modal__body');
        const actions = document.querySelector('.diy-choice-modal .modal__actions').getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, actionTop: actions.top, actionBottom: actions.bottom,
          bodyOverflowX: body.scrollWidth > body.clientWidth + 2, buttons: [...document.querySelectorAll('.diy-choice-modal .modal__actions button')].map(e => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; }) };
      });
      assert.ok(layout.left >= -1 && layout.right <= width + 1 && layout.top >= -1 && layout.bottom <= height + 1, JSON.stringify({ width, height, textSize, ui, layout }));
      assert.ok(layout.actionTop >= -1 && layout.actionBottom <= height + 1, JSON.stringify({ width, height, textSize, ui, layout }));
      assert.equal(layout.bodyOverflowX, false);
      for (const b of layout.buttons) assert.ok(b.left >= 0 && b.right <= width + 1 && b.top >= 0 && b.bottom <= height + 1);
      const footer = await c.page.$$eval('.brief__foot button', els => els.map(e => {const r=e.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
      for (const b of footer) assert.ok(b.left >= -1 && b.right <= width + 1 && b.top >= -1 && b.bottom <= height + 1, JSON.stringify({ width, height, textSize, ui, footer }));
      layouts.push({ width, height, textSize, ui, ...layout });
      if (textSize === 'sm' && ui === 100) await c.page.screenshot({ path: path.join(output, `editor-${width}.png`) });
    }
  }
  await c.page.setViewport({ width: 1440, height: 900 });
  await c.page.evaluate(async () => { (await import('/js/ui/settings.js')).updateSettings({ textSize: 'sm' }); (await import('/js/ui/screenFit.js')).updateFit({ ui: 100 }); });
  const open = await c.page.$('[data-testid="diy-choice-open"]'); await open.focus();
  await c.page.keyboard.press('Escape');
  await c.page.waitForFunction(() => !document.querySelector('.diy-choice-modal'));
  await c.page.waitForFunction(() => !document.querySelector('[data-testid="brief-ready"]')?.matches(':disabled'));
  assert.equal(await c.page.$eval('[data-testid="diy-choice-open"]', e => e === document.activeElement), true, 'closing restores focus');
  await c.page.evaluate(() => { globalThis.__ROSTER_PUB__ = globalThis.__SP__.store.get().match.public; });
  for (const players of [4, 20]) {
    await c.page.setViewport({ width: 640, height: 360 });
    await c.page.evaluate(players => {
      const store = globalThis.__SP__.store, state = store.get(), pub = globalThis.__ROSTER_PUB__, first = pub.players[0];
      store.set({ match: { ...state.match, public: { ...pub, players: [first, ...Array.from({ length: players - 1 }, (_, seat) => ({ ...first, playerId: 'layout-' + seat, seat: seat + 1, name: 'Layout ' + seat, ready: false }))] } } });
    }, players);
    await sleep(100);
    const buttons = await c.page.$$eval('.brief__foot button', els => els.map(e => { const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; }));
    for (const b of buttons) assert.ok(b.left >= -1 && b.right <= 641 && b.top >= -1 && b.bottom <= 361, JSON.stringify({ players, b }));
  }
  await c.page.evaluate(() => { const store=globalThis.__SP__.store;store.set({match:{...store.get().match,public:globalThis.__ROSTER_PUB__}}); });
  await c.page.setViewport({ width: 1440, height: 900 }); await sleep(150);
  await c.page.screenshot({ path: path.join(output, 'summary-1440.png') });
  await c.page.setViewport({ width: 844, height: 390 }); await sleep(250);
  await c.page.screenshot({ path: path.join(output, 'summary-mobile.png') });
  await c.page.setViewport({ width: 640, height: 360, hasTouch: true });
  await c.click('[data-testid="diy-choice-open"]');
  assert.equal(await c.page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
  await c.page.waitForFunction(() => { const box=document.querySelector('.diy-choice-modal'); return box && getComputedStyle(box).transform === 'none'; });
  const touchHeights = await c.page.$$eval('.diy-choice-modal .btn, .diychoice__c', els => els.map(e => e.getBoundingClientRect().height));
  assert.ok(touchHeights.every(height => height >= 44), `touch targets remain at least 44 CSS pixels: ${touchHeights.join(', ')}`);
  await c.page.keyboard.press('Escape');
  await c.page.setViewport({ width: 1440, height: 900 });
  await c.click('[data-testid="diy-choice-open"]');
  await c.click('[data-testid="diy-clear-5"]');
  await c.click('[data-tier="6"] .diychoice__c.is-on', null, { nth: 0 });
  const appliedBefore = await confirmed();
  await c.page.evaluate(() => {
    const net = globalThis.__SP__.net;
    globalThis.__ROSTER_REQUEST__ = net.request;
    net.request = function (type, ...args) {
      if (type === 'g.diyApply') { net.request = globalThis.__ROSTER_REQUEST__; return Promise.reject(Object.assign(new Error('temporary test failure'), { code: 'BAD_TARGET' })); }
      return globalThis.__ROSTER_REQUEST__.call(this, type, ...args);
    };
  });
  await c.click('[data-testid="diy-apply"]');
  await c.page.waitForFunction(() => document.querySelector('.diychoice__status')?.textContent.includes('名单未应用'));
  assert.ok(await c.page.$('.diy-choice-modal'), 'a rejected apply leaves the editor open for retry');
  assert.deepEqual(await confirmed(), appliedBefore, 'a rejected apply never changes the confirmed store');
  assert.equal(await c.page.evaluate(() => {
    const toast = document.querySelector('.toast-host');
    return !!document.querySelector('.app-root > .diy-choice-portal')
      && Number(getComputedStyle(toast).zIndex) > Number(getComputedStyle(document.querySelector('.diy-choice-portal')).zIndex);
  }), true, 'request errors remain above the editor while floating chat stays below it');
  await c.page.evaluate(() => { if (globalThis.__ROSTER_REQUEST__) globalThis.__SP__.net.request = globalThis.__ROSTER_REQUEST__; });
  await c.click('[data-testid="diy-apply"]');
  await c.page.waitForFunction(() => !document.querySelector('.diy-choice-modal'));
  await c.page.waitForFunction(() => { const d = globalThis.__SP__.store.get().match.private.diy; return Object.keys(d).filter(k => k.includes('_5_')).length === 0 && Object.keys(d).filter(k => k.includes('_6_')).length === 1; });
  assert.match((await summaryCounts())[0], /不带/);
  const applied = await confirmed();
  await c.page.reload({ waitUntil: 'domcontentloaded' });
  await c.page.waitForSelector('[data-testid="diy-choice-open"]');
  assert.deepEqual(await confirmed(), applied, 'reload retains confirmed zero/one selections');
  assert.match((await summaryCounts())[0], /不带/);
  await c.click('[data-testid="diy-choice-open"]');
  await c.click('[data-testid="diy-clear-6"]');
  await c.click('[data-testid="diy-apply"]');
  await c.page.waitForFunction(() => !document.querySelector('.diy-choice-modal'));
  assert.deepEqual(await confirmed(), {});
  assert.ok((await summaryCounts()).every(text => /不带/.test(text)));
  await c.page.screenshot({ path: path.join(output, 'summary-none.png') });
  await c.click('[data-testid="diy-choice-open"]');
  await c.click('[data-tier="5"] .diychoice__c', null, { nth: 0 });
  assert.deepEqual(await confirmed(), {}, 'even a valid one-person draft stays local until Apply');
  await c.page.evaluate(async () => { const s = globalThis.__SP__.store.get(); await globalThis.__SP__.net.request('g.infoReady', { setupRevision: s.match.public.setupRevision || 0 }); });
  await c.page.waitForSelector('.draft-stage');
  assert.equal(await c.page.$('.diy-choice-modal'), null, 'phase advancement unmounts and discards the editor');
  assert.deepEqual(await confirmed(), {}, 'entering the match does not restore default picks');
  fs.writeFileSync(path.join(output, 'layout.json'), JSON.stringify(layouts, null, 2));
  assert.deepEqual(c.problems.filter(p => p.startsWith('pageerror:')), []);
});
