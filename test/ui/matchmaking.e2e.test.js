import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { StubMatch } from '../../server/match/StubMatch.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.SP_E2E === '1' && fs.existsSync(CHROME);
test('matching UI: solo cancel, four waiting players, host recruitment, original three home entries and touch layout', { skip: !enabled, timeout: 180000 }, async t => {
  // Several real pages warm their loadouts simultaneously; rate limiting has its own real-socket test.
  const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true, recovery: false, MatchClass: StubMatch, heavyBurst: 64 });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errors = [], base = 'http://127.0.0.1:' + server.port;
  const out = path.resolve('.cache/matchmaking'); fs.mkdirSync(out, { recursive: true });
  t.after(async () => { await browser.close(); await server.close(); });
  const pageIn = async name => {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1280, height: 720 });
    await page.evaluateOnNewDocument(name => { localStorage.setItem('sp.name', name); sessionStorage.setItem('sp.entered', '1'); localStorage.setItem('sp.pref.settings', JSON.stringify({ upstreamReleaseNotes: false, extensionReleaseNotes: false })); }, name);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.lobby-screen'));
    return page;
  };
  const search = async page => {
    await page.evaluate(() => [...document.querySelectorAll('.hub-entry')].find(e => e.textContent.includes('同盟模拟')).click());
    await page.click('[data-testid="matchmaking-open"]');
    await page.waitForSelector('.proto-start');
    await page.evaluate(async () => { await Promise.allSettled(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished)); });
    await page.waitForFunction(() => { const b = document.querySelector('.proto-start'); return b && !b.disabled; });
    await page.click('.proto-start');
  };
  const waitSearch = page => page.waitForFunction(() => globalThis.__SP__.store.get().matchmaking.status === 'searching', { timeout: 15000 });
  const first = await pageIn('匹配一');
  assert.equal(await first.$$eval('.hub-entries .hub-entry', e => e.length), 3);
  await search(first); await waitSearch(first);
  await first.waitForSelector('.mf-stop');
  await first.click('.mf-stop');
  await first.waitForFunction(() => globalThis.__SP__.store.get().matchmaking.status === 'idle');
  assert.equal(server.lobby.matchmaking.solo.size, 0);
  await first.waitForFunction(() => { const b = document.querySelector('.proto:not(.proto--searching) .proto-start'); return b && !b.disabled; });
  await first.evaluate(async () => { await Promise.allSettled(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished)); });
  await first.click('.proto-start'); await waitSearch(first);
  for (const viewport of [{ width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true }, { width: 640, height: 360, isMobile: true, hasTouch: true, isLandscape: true }]) {
    // Use the same touch surface without reloading an active queue: emulation mode is set once on a fresh page.
    const touch = await pageIn('触屏匹配');
    await touch.setViewport(viewport);
    await touch.waitForSelector('.lobby-screen');
    await search(touch); await waitSearch(touch);
    await touch.evaluate(async () => { const { updateSettings } = await import('/js/ui/settings.js'); updateSettings({ textSize: 'xl' }); await Promise.allSettled(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished)); });
    const bounds = await touch.$eval('.mf-stop', el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight, hit: !!hit && (hit === el || el.contains(hit)) }; });
    assert.ok(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= bounds.w + 1 && bounds.bottom <= bounds.h + 1 && bounds.hit, JSON.stringify(bounds));
    await touch.screenshot({ path: path.join(out, 'search-' + viewport.width + '.png') });
    await touch.click('.mf-stop');
    await touch.waitForFunction(() => globalThis.__SP__.store.get().matchmaking.status === 'idle');
    await touch.close();
  }
  const pages = [first];
  for (const name of ['匹配二', '匹配三', '匹配四']) { const page = await pageIn(name); pages.push(page); await search(page); }
  await Promise.all(pages.map(page => page.waitForSelector('.room-screen')));
  const states = await Promise.all(pages.map(page => page.evaluate(() => { const s = globalThis.__SP__.store.get(); return { code: s.room.code, phase: s.match.public?.phase, inMatch: s.room.inMatch, humans: s.room.seats.filter(p => p && !p.isBot).length }; })));
  assert.equal(new Set(states.map(s => s.code)).size, 1);
  assert.ok(states.every(s => !s.inMatch && s.humans === 4));
  await first.waitForSelector('.rs .rseat');
  await first.waitForFunction(() => !document.querySelector('.mf-found'));
  await first.evaluate(async () => { await Promise.allSettled(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished)); });
  await first.screenshot({ path: path.join(out, 'matched-waiting.png') });
  assert.equal(server.lobby.rooms.get(states[0].code).match, null);
  // Verify a party opts in without splitting, and a solo is transferred by the same join route.
  const host = await pageIn('补人房主');
  await host.evaluate(async () => { const { net } = await import('/js/net.js'); await net.request('room.create', { mode: 'coop', difficulty: 'NORMAL', code: 'TEAM' }); });
  await host.waitForSelector('.rs-search');
  await host.evaluate(async () => { await Promise.allSettled(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished)); });
  await host.click('.rs-search');
  await host.waitForFunction(() => !!globalThis.__SP__.store.get().room.matching);
  const recruit = await pageIn('补入队友');
  await recruit.evaluate(async () => { const { net } = await import('/js/net.js'); await net.request('match.queue', { mode: 'coop', difficulty: 'NORMAL', version: 'act2autochess' }); });
  await recruit.waitForFunction(() => globalThis.__SP__.store.get().room?.code === 'TEAM');
  assert.equal(server.lobby.rooms.get('TEAM').activeHumans().length, 2);
  assert.equal(server.lobby.rooms.get('TEAM').match, null);
  await host.waitForSelector('.mf-stop'); await host.click('.mf-stop');
  await host.waitForFunction(() => !globalThis.__SP__.store.get().room.matching);
  assert.equal(server.lobby.rooms.get('TEAM').activeHumans().length, 2);
  await host.waitForFunction(() => !document.querySelector('.mf-search'));
  await host.evaluate(async () => { await Promise.allSettled(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished)); });
  await host.screenshot({ path: path.join(out, 'recruitment-waiting.png') });
  assert.deepEqual(errors, []);
});
