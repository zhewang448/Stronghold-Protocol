import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client, startRealServer, hasChrome, sleep } from '../e2e/client.mjs';

test('animated operator art keeps disabled filters, selected outfits and four-player bubble alignment', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 180000,
}, async t => {
  const srv = await startRealServer({ env: { SP_ASSET_INDEX: '0', SP_VERSIONS: 'act2autochess' } });
  const c = new Client((await import('puppeteer-core')).default, srv.base, 'dynamic-state', { w: 1440, h: 900 });
  t.after(async () => { await c.close(); await srv.stop(); });
  const output = '.cache/dynamic-state'; fs.mkdirSync(output, { recursive: true });
  await c.open('?dev=1'); await c.enter('动态状态验收');
  await c.page.evaluate(async () => {
    const { data } = await import('/js/data.js'); await data.loadAll('chess', 'backups', 'assets', 'bonds', 'bands', 'items', 'garrisons', 'config', 'local');
    const { html } = await import('/js/ui/components.js'), { render } = await import('/vendor/preact.module.js');
    const { UnitThumb } = await import('/js/ui/gameComponents.js'), { ChessCard } = await import('/js/ui/shopBar.js');
    const { DetailPanel, resolveDetail } = await import('/js/ui/detailPanel.js'), { TeamPanel } = await import('/js/ui/teamPanel.js');
    const { setSkins } = await import('/js/ui/skins.js'), { EMOTES } = await import('/shared/constants.js');
    const charId = 'char_172_svrash', skinId = 'char_172_svrash@ambienceSynesthesia#4';
    setSkins({ [charId]: skinId });
    const record = Object.values(data.get('chess')).find(r => r.charId === charId && !r.isGolden && !r.isDiy);
    const host = document.createElement('div'); host.id = 'dynamic-state';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#102018;padding:30px;'; document.body.appendChild(host);
    const style = document.createElement('style');style.textContent = '#dynamic-state .dpanel{position:absolute;top:30px;left:auto;right:30px}';document.head.appendChild(style);
    globalThis.renderDynamicFixture = ({ disabled = true, dim = true, focus = false, bubbles = false } = {}) => {
      const priv = { funds: disabled ? 0 : 50, hand: [], temp: [], board: [], bonds: [], deployCap: 10, deployCount: 0, shop: { level: 6, slots: [] } };
      const players = Array.from({ length: 4 }, (_, i) => ({ playerId: 'fixture-' + i, name: '博士' + (i + 1), seat: i, lp: 28, alive: true, connected: true, status: 'prep', bandId: 'band_bldsk', bonds: [] }));
      const messages = new Map(players.map((p, i) => [p.playerId, { id: EMOTES[i % EMOTES.length], seq: Date.now() + i, at: Date.now() }]));
      render(bubbles ? html`<div class="gm"><div class="gm__hud"><${TeamPanel} pub=${{ mode: 'coop', phase: 'PREP', round: 1, players }} myId="fixture-3" bubbles=${messages} onWatch=${() => {}} /></div></div>`
        : html`<div class=${focus ? 'shopbar has-portrait-focus' : 'shopbar'} style="position:relative;width:400px;display:flex;gap:30px">
          <${UnitThumb} id=${record.chessId} dim=${dim} size="lg" /><${ChessCard} slot=${{ kind: 'chess', id: record.chessId, price: 4 }} idx=${0} priv=${priv} reason=${disabled ? '资金不足' : null} onBuy=${() => {}} onDetail=${() => {}} />
          </div><${DetailPanel} detail=${resolveDetail({ kind: 'chess', id: record.chessId, foreign: true }, new Map(), priv)} editable=${false} onClose=${() => {}} onSell=${() => {}} onDestroy=${() => {}} />`, host);
    };
    globalThis.fixtureChar = charId; globalThis.fixtureSkin = skinId; globalThis.renderDynamicFixture();
  });
  await c.page.waitForSelector('#dynamic-state .scard .dyn-cover[data-state="ready"]', { timeout: 30000 });
  const animationHash = () => c.page.$eval('#dynamic-state .scard .dyn-cover canvas', canvas => {
    const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261; for (let i = 0; i < bytes.length; i += 13) hash = Math.imul(hash ^ bytes[i], 16777619); return hash >>> 0;
  });
  const hash = await animationHash(); await sleep(500); assert.notEqual(await animationHash(), hash, 'disabled artwork keeps animating');
  for (const focus of [false, true]) {
    await c.page.evaluate(focus => globalThis.renderDynamicFixture({ focus }), focus); await sleep(150);
    const filters = await c.page.evaluate(() => ['.uthumb__art', '.scard'].map(selector => {
      const parent = document.querySelector('#dynamic-state ' + selector), image = parent.querySelector(selector === '.scard' ? '.scard__art' : 'img'), live = parent.querySelector(':scope > .dyn-cover');
      return { still: getComputedStyle(image).filter, live: getComputedStyle(live).filter, mask: getComputedStyle(live).maskImage, state: live.dataset.state };
    }));
    for (const f of filters) { assert.equal(f.live, f.still); assert.match(f.live, /grayscale/); assert.equal(f.state, 'ready'); }
    assert.notEqual(filters[1].mask, 'none', 'animated shop art keeps the portrait fade');
    await c.page.screenshot({ path: path.join(output, 'dim-' + focus + '.png') });
  }
  assert.ok(await c.page.$eval('#dynamic-state .dhead__art img', e => e.src.includes('svrash_ambienceSynesthesia_4')), 'public detail uses the chosen outfit');
  await c.page.evaluate(() => globalThis.renderDynamicFixture({ disabled: false, dim: false })); await sleep(150);
  assert.equal(await c.page.$eval('#dynamic-state .scard .dyn-cover', e => getComputedStyle(e).filter), 'none');
  const measurements = [];
  for (const [width, height] of [[1440, 900], [1280, 720], [844, 390], [640, 360]]) {
    await c.page.setViewport({ width, height }); await c.page.evaluate(() => globalThis.renderDynamicFixture({ bubbles: true })); await sleep(350);
    const deltas = await c.page.evaluate(() => [...document.querySelectorAll('#dynamic-state .team__row')].map(row => {
      const a = row.querySelector('.team__btn').getBoundingClientRect(), b = document.querySelector(`#dynamic-state .team__message[data-player-id="${row.dataset.playerId}"]`).getBoundingClientRect();
      return { player: row.dataset.playerId, delta: b.top + b.height / 2 - a.top - a.height / 2, top: b.top, bottom: b.bottom };
    }));
    for (const row of deltas) { assert.ok(Math.abs(row.delta) < 1, `${width}: ${JSON.stringify(row)}`); assert.ok(row.top >= 0 && row.bottom <= height); }
    measurements.push({ width, height, deltas }); await c.page.screenshot({ path: path.join(output, 'bubbles-' + width + '.png') });
  }
  fs.writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2));
});

test('the actual match HUD keeps fourth-seat bubbles beside the avatar and scrolls expanded lists without clipping messages', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000,
}, async t => {
  const srv = await startRealServer({ env: { SP_ASSET_INDEX: '0', SP_VERSIONS: 'act2autochess' } });
  const c = new Client((await import('puppeteer-core')).default, srv.base, 'bubble-hud', { w: 1280, h: 720 });
  t.after(async () => { await c.close(); await srv.stop(); });
  await c.open('?dev=1');
  await c.page.goto(srv.base + '/dev/game-mock.html?shot=1&phase=PREP&render=fallback', { waitUntil: 'domcontentloaded' });
  await c.page.waitForSelector('.team__row[data-player-id="p4"]');
  const send = () => c.page.evaluate(async () => {
    const { EMOTES } = await import('/shared/constants.js'), store = globalThis.__MOCK__.store;
    store.set({ emotes: [{ seq: Date.now(), playerId: 'p4', id: EMOTES[0], at: Date.now() }] });
  });
  for (const [width, height] of [[1280, 720], [844, 390], [640, 360]]) {
    await c.page.setViewport({ width, height }); await send(); await sleep(400);
    const r = await c.page.evaluate(() => {
      const a = document.querySelector('.team__row[data-player-id="p4"] .team__btn').getBoundingClientRect();
      const b = document.querySelector('.team__message[data-player-id="p4"]').getBoundingClientRect();
      const shop = document.querySelector('.shopbar')?.getBoundingClientRect();
      return { delta: (b.top + b.bottom - a.top - a.bottom) / 2, top: b.top, bottom: b.bottom, right: b.right, left: b.left,
        shop: shop && { top: shop.top, left: shop.left, right: shop.right } };
    });
    assert.ok(r.top >= 0 && r.bottom <= height && r.left >= 0 && r.right <= width, JSON.stringify(r));
    if (!r.shop || r.right <= r.shop.left || r.left >= r.shop.right) assert.ok(Math.abs(r.delta) < 1, JSON.stringify(r));
    else assert.ok(Math.abs(r.delta) < 1 || r.bottom <= r.shop.top, 'a constrained bubble moves above the shop: ' + JSON.stringify(r));
  }
  await c.page.evaluate(() => {
    const mock = globalThis.__MOCK__;
    mock.mutate(s => { const template = s.pub.players[0]; for (let i = 4; i < 20; i++) s.pub.players.push({ ...template, playerId: 'extra-' + i, seat: i, name: '博士' + (i + 1) }); });
    mock.pushPublic();
  });
  await c.page.waitForSelector('.team--many');
  await send(); await sleep(300);
  await c.page.$eval('.team__list', el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); }); await sleep(200);
  assert.ok(await c.page.$eval('.team__messages', el => getComputedStyle(el).overflow !== 'hidden'));
  const scrollState = await c.page.evaluate(() => {
    const list = document.querySelector('.team__list'), row = document.querySelector('.team__row[data-player-id="p4"] .team__btn');
    const a = row.getBoundingClientRect(), b = list.getBoundingClientRect();
    return { offscreen: document.querySelector('.team__message[data-player-id="p4"]').hasAttribute('data-offscreen'), scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, height: list.clientHeight, row: [a.top, a.bottom], list: [b.top, b.bottom] };
  });
  assert.ok(scrollState.offscreen, JSON.stringify(scrollState));
});
