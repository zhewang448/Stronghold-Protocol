import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from '../../server/index.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('top bond popup shows live pool copies without changing member actions on desktop and mobile', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async testContext => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const harness = makeMatch({ mode: 'coop', humans: 2, fake: true, seed: 7 }).start().toPrep(1);
  testContext.after(async () => { harness.m.dispose(); await browser.close(); await server.close(); });
  const buyer = harness.ps('p_0'), viewer = harness.ps('p_1'), bondId = 'yanShip';
  const id = [...buyer.pool.entries.keys()].find(id => buyer.gd.chess(id).bonds?.includes(bondId));
  assert.ok(id);
  fs.mkdirSync('test/e2e/out', { recursive: true });
  for (const [width, height] of [[1440, 900], [844, 390]]) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width, height });
    await page.goto(server.url + '/dev/game-mock.html?shot=1&phase=PREP&render=fallback', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__MOCK__);
    await page.waitForFunction(() => !document.querySelector('.pbanner--overlay'));
    const updateStock = counts => page.evaluate(counts => {
      const { store } = globalThis.__MOCK__, state = store.get();
      store.patch('match', { private: { ...state.match.private, shop: { ...state.match.private.shop, chessStock: counts } } });
    }, counts);
    await page.evaluate(({ bondId, counts, banned }) => {
      const { store } = globalThis.__MOCK__, state = store.get();
      store.patch('match', { public: { ...state.match.public, bannedChess: banned,
        poolGroups: [{ id: 1, playerIds: [state.me.playerId, 'p3'] }] }, private: {
        ...state.match.private, playerId: state.me.playerId,
        bonds: [{ bondId, count: 1, tier: 0, active: false, layers: 0 }],
        shop: { ...state.match.private.shop, chessStock: counts },
      } });
    }, { bondId, counts: viewer.privateView().shop.chessStock, banned: harness.m.bannedChess });
    await page.click('.bslot[data-bond="' + bondId + '"] .bond');
    const stockSelector = '.bpop [data-stock-id="' + id + '"]';
    await page.waitForSelector(stockSelector);
    assert.match(await page.$eval('.bpop__stock-scope', element => element.textContent), /同组共享卡池/);
    const initial = buyer.pool.left(id);
    assert.equal(await page.$eval(stockSelector, element => Number(element.dataset.stock)), initial);
    buyer.funds = 100;
    buyer.shop.slots[0] = { kind: 'chess', id, basePrice: 1, frozen: false, sold: false };
    assert.deepEqual(harness.m.handle(buyer.playerId, { t: 'g.buy', slot: 0 }), { ok: true });
    harness.flushAll();
    await updateStock(harness.lastTo(viewer.playerId, 'm.private').shop.chessStock);
    await page.waitForFunction((selector, count) => Number(document.querySelector(selector)?.dataset.stock) === count, {}, stockSelector, initial - 1);
    const acquired = buyer.allChess().find(piece => piece.id === id);
    assert.ok(acquired);
    assert.deepEqual(harness.m.handle(buyer.playerId, { t: 'g.sell', uid: acquired.uid }), { ok: true });
    harness.flushAll();
    await updateStock(harness.lastTo(viewer.playerId, 'm.private').shop.chessStock);
    await page.waitForFunction((selector, count) => Number(document.querySelector(selector)?.dataset.stock) === count, {}, stockSelector, initial);
    const counts = viewer.privateView().shop.chessStock;
    counts[id] = 0;
    await updateStock(counts);
    await page.waitForSelector(stockSelector + '.is-empty');
    assert.equal(await page.$eval(stockSelector, element => element.getAttribute('aria-label')), '卡池剩余 0 张');
    await page.$eval('.bpop__members-heading', element => element.scrollIntoView({ block: 'center' }));
    const fits = await page.$eval('.bpop__members', element => {
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll('.bpop__member, .bpop__stock')].every(child => {
        const rectangle = child.getBoundingClientRect(); return rectangle.left >= bounds.left - 1 && rectangle.right <= bounds.right + 1;
      });
    });
    await page.screenshot({ path: 'test/e2e/out/bond-stock-' + width + '.png' });
    assert.equal(fits, true, 'stock labels stay within the existing member grid');
    await page.$eval(stockSelector, element => element.closest('.bpop__member').click());
    await page.waitForSelector('.dpanel');
    await page.evaluate(() => {
      const { store } = globalThis.__MOCK__, state = store.get();
      store.patch('match', { public: { ...state.match.public, independentPools: true } });
    });
    await page.waitForFunction(() => document.querySelector('.bpop__stock-scope')?.textContent.includes('个人独立卡池'));
    await updateStock(undefined);
    await page.waitForFunction(() => !document.querySelector('.bpop__stock'));
    assert.deepEqual(errors, []);
    await page.close();
  }
});
