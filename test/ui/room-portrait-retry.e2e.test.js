// SP_E2E=1 node --test test/ui/room-portrait-retry.e2e.test.js
// An injected image request failure must recover without leaving the room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { TestClient } from '../helpers/wsClient.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('room portraits recover from transient failures, bound retries, and release work on leave', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000,
}, async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-background-timer-throttling'] });
  const peer = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
  t.after(async () => { await browser.close(); peer.terminate(); await server.close(); });
  await peer.hello('Retry peer');
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.setCacheEnabled(false);
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  let failure = null;
  page.on('request', request => {
    const url = new URL(request.url());
    const source = { '/js/screens/room.js': 'public/js/screens/room.js', '/js/ui/seatArt.js': 'public/js/ui/seatArt.js' }[url.pathname];
    if (source && process.env.SP_PORTRAIT_CANDIDATE) {
      void request.respond({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(process.env.SP_PORTRAIT_CANDIDATE, source)) });
    } else if (failure && url.pathname === failure.path) {
      failure.requests++;
      if (failure.remaining > 0) { failure.remaining--; void request.abort('failed'); }
      else void request.continue();
    } else void request.continue();
  });
  await page.evaluateOnNewDocument(() => { localStorage.setItem('sp.name', 'Retry host'); sessionStorage.setItem('sp.entered', '1'); });
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__SP__?.net.status === 'online');
  const code = await page.evaluate(async () => {
    const { net, store } = globalThis.__SP__;
    (await import('/js/ui/settingsStore.js')).settingsStore.set({ dynamicIllustrations: 'static' });
    store.patch('session', { entered: true });
    await net.request('room.create', { mode: 'coop', difficulty: 'NORMAL', version: 'act2autochess' });
    return store.get().room.code;
  });
  assert.equal((await peer.request({ t: 'room.join', code })).t, 'ok');
  await page.waitForSelector('.rseat.is-me .rseat__art');
  const select = skin => page.evaluate(async skin => (await import('/js/ui/seatArt.js')).setCard('char_498_inside', skin), skin);
  const loaded = async (wanted, timeout = 6000) => {
    try {
      await page.waitForFunction(wanted => {
        const img = document.querySelector('.rseat.is-me .rseat__art img');
        return img?.complete && img.naturalWidth > 0 && new URL(img.src).pathname === wanted;
      }, { timeout }, wanted);
      return true;
    } catch (error) { if (error.name !== 'TimeoutError') throw error; return false; }
  };
  let failures = 0;
  for (const [skin, wanted] of [['', '/assets/char/portrait/char_498_inside_2.png'],
    ['char_498_inside@kitchen#2', '/assets/seat-portrait/char_498_inside_kitchen_2.png']]) {
    failure = { path: wanted, remaining: 1, requests: 0 };
    await select(skin);
    const recovered = await loaded(wanted);
    const requests = failure.requests;
    const roomStable = await page.evaluate(code => globalThis.__SP__.store.get().room?.code === code, code);
    const available = await page.evaluate(async wanted => (await fetch(wanted)).ok, wanted);
    let rejoinRecovered = null;
    if (!recovered) {
      failures++;
      await page.evaluate(async () => {
        const { net, store } = globalThis.__SP__;
        await net.request('room.leave', {}); store.set({ room: null });
      });
      await page.waitForSelector('.lobby-screen');
      await page.evaluate(code => globalThis.__SP__.net.request('room.join', { code }), code);
      await page.waitForSelector('.room-screen');
      rejoinRecovered = await loaded(wanted);
    }
    console.log(JSON.stringify({ skin: skin || 'default', recoveredWithoutRejoin: recovered, requests, roomStable, resourceAvailable: available, rejoinRecovered }));
    assert.equal(available, true); assert.equal(roomStable, true);
    if (rejoinRecovered !== null) assert.equal(rejoinRecovered, true, 'rejoining reproduces the reported workaround');
  }
  fs.mkdirSync('test/e2e/out', { recursive: true });
  await page.screenshot({ path: `test/e2e/out/room-portrait-retry-${path.basename(process.env.SP_PORTRAIT_CANDIDATE || 'workspace')}.png` });
  if (process.env.SP_PORTRAIT_TRANSIENT_ONLY === '1') {
    assert.deepEqual(errors, []);
    assert.equal(failures, 0, 'transient portrait failures must recover without rebuilding the room');
    return;
  }
  // Fail the default portrait permanently: one initial request plus three bounded retry rounds.
  const plain = '/assets/char/portrait/char_498_inside_2.png';
  failure = { path: plain, remaining: Infinity, requests: 0 };
  await select('');
  await new Promise(resolve => setTimeout(resolve, 15500));
  const exhausted = failure.requests;
  await new Promise(resolve => setTimeout(resolve, 1200));
  const stopped = failure.requests === exhausted;
  if (exhausted !== 4 || !stopped) failures++;
  failure.remaining = 0;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  const onlineRecovered = await loaded(plain);
  if (!onlineRecovered) failures++;
  console.log(JSON.stringify({ permanentFailureRequests: exhausted, retriesStopped: stopped, recoveredOnOnline: onlineRecovered }));
  // Switching away and back gives the same URL a new identity; leaving cancels its retry timer.
  await select('char_498_inside@kitchen#2');
  assert.equal(await loaded('/assets/seat-portrait/char_498_inside_kitchen_2.png'), true);
  failure = { path: plain, remaining: Infinity, requests: 0 };
  await select('');
  await page.waitForFunction(() => !!document.querySelector('.rseat.is-me .rseat__glyph'));
  await page.evaluate(async () => {
    const { net, store } = globalThis.__SP__;
    await net.request('room.leave', {}); store.set({ room: null });
  });
  await page.waitForSelector('.lobby-screen');
  const beforeLeave = failure.requests;
  await new Promise(resolve => setTimeout(resolve, 1600));
  const noWorkAfterLeave = failure.requests === beforeLeave;
  if (!noWorkAfterLeave) failures++;
  console.log(JSON.stringify({ noWorkAfterLeave, failures }));
  assert.deepEqual(errors, []);
  assert.equal(failures, 0, 'transient portrait failures must recover without rebuilding the room');
});
