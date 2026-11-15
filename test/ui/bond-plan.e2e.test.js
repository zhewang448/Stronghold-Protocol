// SP_E2E=1 node --test test/ui/bond-plan.e2e.test.js
// Click the actual waiting-room picker: new-season bonds must reach teammates and survive reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, problemsOf } from '../e2e/client.mjs';
import { startServer } from '../../server/index.js';

const REG = 'act3autochess@V3_1';

test('room bond picker syncs new regulation bonds, clears them and restores them after reload', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000,
}, async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false,
    versions: { enabled: 'all', default: REG } });
  const P = (await import('puppeteer-core')).default;
  const host = new Client(P, srv.url, 'host', { prefix: 'bond-plan', w: 1280, h: 800, lobbyVersion: REG });
  const peer = new Client(P, srv.url, 'peer', { prefix: 'bond-plan', w: 1280, h: 800, lobbyVersion: REG });
  const waitPlan = (c, playerId, bondId) => c.page.waitForFunction((playerId, bondId) =>
    globalThis.__SP__.store.get().room?.seats.some(s => s?.playerId === playerId && s.bondPlan === bondId),
  { timeout: 10000 }, playerId, bondId);
  const waitBackground = (c, camp) => c.page.waitForFunction(camp => {
    const seat = [...document.querySelectorAll('.rseat')].find(el => el.querySelector('.rseat__name')?.textContent === 'PlanHost');
    const img = seat?.querySelector('.room-nc img');
    return camp ? img?.complete && img.naturalWidth > 0 && new URL(img.src).pathname.endsWith(`/logo_${camp}.png`) : !!seat && !img;
  }, { timeout: 10000 }, camp);
  try {
    await host.open('?render=fallback'); await host.enter('PlanHost');
    await host.page.evaluate(version => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL', version }), REG);
    await host.page.waitForSelector('[data-testid="bond-plan-open"]');
    const { code, playerId } = await host.page.evaluate(() => {
      const s = globalThis.__SP__.store.get(); return { code: s.room.code, playerId: s.me.playerId };
    });
    await peer.open('?render=fallback'); await peer.enter('PlanPeer');
    await peer.page.evaluate(code => globalThis.__SP__.net.request('room.join', { code }), code);
    await host.click('[data-testid="bond-plan-open"]');
    await host.page.waitForSelector('[data-testid="bond-plan-ursusShip"]');
    assert.equal(await host.page.$$eval('.bplan__cell', cells => cells.length), 10);
    assert.equal(await host.page.$('[data-testid="bond-plan-lateranoShip"]'), null);
    for (const [bondId, camp] of [['ursusShip', 'ursus'], ['iberiaShip', 'iberia'], ['lethaniaShip', 'leithanien']]) {
      await host.click(`[data-testid="bond-plan-${bondId}"]`);
      await waitPlan(host, playerId, bondId);
      await waitPlan(peer, playerId, bondId);
      await waitBackground(host, camp); await waitBackground(peer, camp);
      assert.equal(await host.page.$eval(`[data-testid="bond-plan-${bondId}"]`, el => el.getAttribute('aria-selected')), 'true');
    }
    await host.shot('regulation-selected');
    await host.click('.bplan .modal__actions button', '关闭');
    await host.click('.room-nc-open');
    await host.click('.room-nc-modes button', '跟随预选盟约');
    await host.page.waitForFunction(() => document.querySelector('.room-nc-preview img')?.src.includes('logo_leithanien.png'));
    await host.shot('namecard-new-bond-preview');
    // A manual background stays selected until the user explicitly returns to automatic mode.
    await host.click('.room-nc-tabs button', '阵营与组织');
    await host.click('.room-nc-grid button', '炎');
    await waitBackground(host, 'yan'); await waitBackground(peer, 'yan');
    await host.click('.room-namecard-picker .modal__actions button', '完成');
    await host.click('[data-testid="bond-plan-open"]');
    await host.click('[data-testid="bond-plan-ursusShip"]');
    await waitPlan(peer, playerId, 'ursusShip');
    await waitBackground(host, 'yan'); await waitBackground(peer, 'yan');
    await host.click('[data-testid="bond-plan-lethaniaShip"]');
    await waitPlan(peer, playerId, 'lethaniaShip');
    await host.click('.bplan .modal__actions button', '关闭');
    await host.click('.room-nc-open');
    await host.click('.room-nc-modes button', '跟随预选盟约');
    await waitBackground(host, 'leithanien'); await waitBackground(peer, 'leithanien');
    await host.click('.room-namecard-picker .modal__actions button', '完成');
    await host.click('[data-testid="bond-plan-open"]');
    // Clicking the selected option clears it; the explicit clear action must work too.
    await host.click('[data-testid="bond-plan-lethaniaShip"]');
    await waitPlan(peer, playerId, null);
    await waitBackground(host, null); await waitBackground(peer, null);
    await host.click('[data-testid="bond-plan-ursusShip"]');
    await waitPlan(peer, playerId, 'ursusShip');
    await host.click('[data-testid="bond-plan-clear"]');
    await waitPlan(peer, playerId, null);
    await host.click('[data-testid="bond-plan-iberiaShip"]');
    await waitPlan(peer, playerId, 'iberiaShip');
    await host.page.reload({ waitUntil: 'domcontentloaded' });
    await host.page.waitForSelector('[data-testid="bond-plan-open"]');
    await waitPlan(host, playerId, 'iberiaShip');
    await waitBackground(host, 'iberia'); await waitBackground(peer, 'iberia');
    await host.click('[data-testid="bond-plan-open"]');
    await host.page.waitForSelector('[data-testid="bond-plan-iberiaShip"][aria-selected="true"]');
    await host.page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
    // Switching to mobile emulation reloads Chromium; reopen the room dialog after reconnect.
    await host.page.waitForSelector('[data-testid="bond-plan-open"]');
    await host.click('[data-testid="bond-plan-open"]');
    await host.page.waitForSelector('[data-testid="bond-plan-ursusShip"]');
    await host.page.$eval('[data-testid="bond-plan-ursusShip"]', el => el.scrollIntoView({ block: 'center' }));
    await host.click('[data-testid="bond-plan-ursusShip"]');
    await waitPlan(peer, playerId, 'ursusShip');
    await waitBackground(host, 'ursus'); await waitBackground(peer, 'ursus');
    await host.shot('regulation-mobile');
    assert.deepEqual(problemsOf([host, peer]), []);
  } finally { await host.close(); await peer.close(); await srv.close(); }
});
