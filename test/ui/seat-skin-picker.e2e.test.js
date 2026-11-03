import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from '../../server/index.js';
import { TestClient } from '../helpers/wsClient.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('newly installed skin can be picked in the room, synced to another player and retained after reload', {
  skip: process.env.SP_E2E !== '1' || !hasChrome() || !fs.existsSync('public/assets/char/portrait/char_1045_svash2_sale_20.png'), timeout: 90000,
}, async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const host = await TestClient.connect(server.url.replace('http', 'ws') + '/ws');
  const guest = await TestClient.connect(server.url.replace('http', 'ws') + '/ws');
  const hostWelcome = await host.hello('Host'), guestWelcome = await guest.hello('Guest');
  await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const room = [...server.lobby.rooms.values()][0];
  await guest.request({ t: 'room.join', code: room.code });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await host.terminate(); await guest.terminate(); await server.close(); });
  const showRoom = async (page, playerId) => {
    await page.goto(server.url + '/dev/game-mock.html?phase=PREP&render=fallback&shot=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__SP_VIEW__);
    await page.evaluate(async (frame, playerId) => {
      const [{ render, h }, { store }, { RoomScreen }, { data }, { UiHosts }, { installCardSync }] = await Promise.all([
        import('/vendor/preact.module.js'), import('/js/store.js'), import('/js/screens/room.js'),
        import('/js/data.js'), import('/js/ui/components.js'), import('/js/ui/loadoutSync.js'),
      ]);
      await Promise.all(['chess', 'assets', 'seat-art', 'skins', 'bonds'].map(name => data.load(name)));
      await Promise.all(['/css/screens/lobby.css', '/css/screens/room.css'].map(href => new Promise(resolve => {
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.onload = resolve; document.head.appendChild(link);
      })));
      store.set({ me: { playerId, name: playerId }, connection: { status: 'online' }, room: frame });
      globalThis.cardSync = installCardSync({ net: { status: 'online', on: () => () => {}, request: async (type, body) => {
        const result = await globalThis.sendCardSelection(type, body);
        if (result.t === 'error') throw Object.assign(new Error(result.msg), { code: result.code });
        return result;
      } }, gate: () => true, content: null });
      render(h('div', {}, h(RoomScreen), h(UiHosts)), document.getElementById('app'));
    }, room.toState(), playerId);
    await page.waitForSelector('.rseat.is-me .rseat__pick');
  };
  const page = await browser.newPage(), errors = [];
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('sendCardSelection', (type, body) => host.request({ t: type, ...body }));
  await showRoom(page, hostWelcome.playerId);
  await page.click('.rseat.is-me .rseat__pick');
  await page.waitForSelector('.cardpick__search input');
  await page.type('.cardpick__search input', '凛御银灰');
  await page.click('.cardpick__op[title="凛御银灰"]');
  await page.waitForSelector('.cardpick__op[title="雪覆伦城"]');
  await page.click('.cardpick__op[title="雪覆伦城"]');
  await page.evaluate(() => globalThis.cardSync.flush());
  const skinId = 'char_1045_svash2@sale#20';
  await guest.waitFor('room.state', frame => frame.seats.some(seat => seat?.cardSkin === skinId));
  assert.equal(room.seatOf(hostWelcome.playerId).cardSkin, skinId);
  await page.waitForSelector('.rseat.is-me .rseat__art img[src*="char_1045_svash2_sale_20"]');
  await showRoom(page, hostWelcome.playerId);
  await page.waitForSelector('.rseat.is-me .rseat__art img[src*="char_1045_svash2_sale_20"]');
  const other = await browser.newPage();
  await other.exposeFunction('sendCardSelection', (type, body) => guest.request({ t: type, ...body }));
  await showRoom(other, guestWelcome.playerId);
  await other.waitForSelector('.rseat:not(.is-me) .rseat__art img[src*="char_1045_svash2_sale_20"]');
  fs.mkdirSync('test/e2e/out', { recursive: true });
  await page.screenshot({ path: 'test/e2e/out/seat-skin-new.png' });
  assert.deepEqual(errors, []);
});
