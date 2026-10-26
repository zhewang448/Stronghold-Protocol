import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { TestClient } from '../helpers/wsClient.js';
import { StubMatch } from '../../server/match/StubMatch.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && fs.existsSync(CHROME);

test('public directory: join, running spectator, privacy, retry, shared polling and touch layout', { skip: !ENABLED, timeout: 120000 }, async t => {
  const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true, recovery: false, MatchClass: StubMatch });
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const sockets = [], errors = [];
  t.after(async () => { await browser.close(); await Promise.all(sockets.map(c => c.terminate())); await server.close(); });
  const socket = async (name, options) => {
    const c = await TestClient.connect('ws://127.0.0.1:' + server.port + '/ws');
    sockets.push(c); await c.hello(name);
    assert.equal((await c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', ...options })).t, 'ok');
    return c;
  };
  const host = await socket('大厅房主', { code: 'OPEN', capacity: 8 });
  await socket('私密房主', { code: 'PRIV', private: true });
  await socket('独立房主', { code: 'SOLO', mode: 'solo' });
  const full = await socket('满员房主', { code: 'FULL' });
  for (let i = 0; i < 3; i++) assert.equal((await full.request({ t: 'room.addBot' })).t, 'ok');
  const pageIn = async () => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 720 });
    await page.evaluateOnNewDocument(() => { localStorage.setItem('sp.name', '大厅测试'); sessionStorage.setItem('sp.entered', '1'); });
    await page.goto('http://127.0.0.1:' + server.port, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.lobby-screen'));
    return page;
  };
  const page = await pageIn();
  const open = async p => { await p.click('[data-testid="public-room-lobby"]'); await p.waitForSelector('[data-room-code="OPEN"]'); };
  await open(page);
  await page.waitForFunction(() => document.activeElement?.closest('.mm-modal'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.mm-modal', { hidden: true });
  assert.equal(await page.$eval('[data-testid="public-room-lobby"]', e => document.activeElement === e), true);
  await open(page);
  assert.deepEqual(await page.$$eval('[data-room-code]', rows => rows.map(r => r.dataset.roomCode)), ['OPEN', 'FULL']);
  assert.equal(await page.$eval('[data-room-code="FULL"] .mm-btn-join', e => e.disabled), true);
  assert.equal(await page.$eval('[data-room-code="FULL"] .mm-btn-spectate', e => e.disabled), false);
  const fullRoom = server.lobby.rooms.get('FULL');
  fullRoom.spectators = [{ playerId: 'held-a', connected: false }, { playerId: 'held-b', connected: false }];
  await page.click('.mm-refresh-btn');
  await page.waitForFunction(() => document.querySelector('[data-room-code="FULL"] .mm-btn-spectate')?.disabled);
  fullRoom.spectators = [];
  const out = path.resolve('.cache/room-directory'); fs.mkdirSync(out, { recursive: true });
  for (const [lang, textSize, viewport] of [
    ['zh', 'sm', { width: 1280, height: 720 }],
    ['zh', 'xl', { width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true }],
    ['en', 'xl', { width: 640, height: 360, isMobile: true, hasTouch: true, isLandscape: true }],
  ]) {
    await page.setViewport(viewport);
    // Changing mobile emulation reloads Chromium; restore the same lobby dialog afterward.
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.lobby-screen'));
    if (!await page.$('.mm-modal')) await open(page);
    await page.evaluate(async (locale, size) => {
      const { switchLang } = await import('/js/ui/lang.js');
      const { updateSettings } = await import('/js/ui/settings.js');
      await switchLang(locale); updateSettings({ textSize: size });
    }, lang, textSize);
    await page.waitForFunction(() => document.querySelector('.mm-modal__box')?.getBoundingClientRect().width > 0);
    const bounds = await page.$eval('.mm-modal__box', el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, overflow: el.scrollWidth - el.clientWidth }; });
    assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= bounds.width + 1 && bounds.bottom <= bounds.height + 1 && bounds.overflow <= 1, JSON.stringify(bounds));
    const content = await page.$eval('.mm-modal__body', el => {
      const list = el.querySelector('.mm-room-list').getBoundingClientRect();
      const foot = el.querySelector('.mm-modal__foot').getBoundingClientRect();
      const cards = [...el.querySelectorAll('.mm-room-card')].map(card => {
        const r = card.getBoundingClientRect();
        return [...card.querySelectorAll('button')].every(button => { const b = button.getBoundingClientRect(); return b.top >= r.top && b.bottom <= r.bottom + 1 && b.right <= r.right + 1; });
      });
      return { separated: foot.top >= list.bottom - 1, cards: cards.every(Boolean) };
    });
    assert.deepEqual(content, { separated: true, cards: true }, 'footer and room actions never overlap');
    const codeFits = await page.$$eval('.mm-room-code', codes => codes.map(el => ({ text: el.textContent, scroll: el.scrollWidth, width: el.clientWidth })));
    assert.ok(codeFits.every(cell => cell.scroll <= cell.width + 1), JSON.stringify(codeFits));
    await page.screenshot({ path: path.join(out, lang + '-' + textSize + '-' + viewport.width + '.png') });
  }
  await page.setViewport({ width: 1280, height: 720 });
  await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.lobby-screen'));
  if (!await page.$('.mm-modal')) await open(page);
  await page.evaluate(async () => { const { switchLang } = await import('/js/ui/lang.js'); await switchLang('zh'); });
  await page.evaluate(async () => {
    const { net } = await import('/js/net.js');
    const request = net.request.bind(net);
    globalThis.directoryRequests = 0; globalThis.directoryFail = true;
    net.request = (type, ...args) => { if (type === 'room.list') { globalThis.directoryRequests++; if (globalThis.directoryFail) return Promise.reject(new Error('test network failure')); } return request(type, ...args); };
  });
  await page.click('.mm-refresh-btn');
  await page.waitForFunction(() => document.querySelector('.mm-modal [role="status"]')?.textContent.includes('加载失败'));
  assert.ok(await page.$('[data-room-code="OPEN"]'), 'refresh failure keeps prior list');
  await page.evaluate(() => { globalThis.directoryFail = false; globalThis.directoryRequests = 0; });
  await page.click('.mm-refresh-btn');
  await page.waitForFunction(() => !document.querySelector('.mm-modal [role="status"]'));
  await page.waitForFunction(() => globalThis.directoryRequests >= 2, { timeout: 7000 });
  assert.ok(await page.evaluate(() => globalThis.directoryRequests <= 3), 'shared poll avoids duplicate requests');
  await page.click('[data-room-code="OPEN"] .mm-btn-join');
  await page.waitForFunction(() => globalThis.__SP__.store.get().room?.code === 'OPEN');
  await page.click('.rs-pill__gear');
  assert.equal(await page.$eval('[name="private-room"]', e => e.disabled), true, 'guest privacy is read-only');
  const observer = await pageIn();
  await open(observer);
  await host.request({ t: 'room.setPrivate', private: true });
  await observer.click('.mm-refresh-btn');
  await observer.waitForSelector('[data-room-code="OPEN"]', { hidden: true });
  await host.request({ t: 'room.setPrivate', private: false });
  await page.click('.rs-exit');
  await page.waitForSelector('.lobby-screen');
  await host.request({ t: 'room.start' });
  await observer.click('.mm-refresh-btn');
  await observer.waitForFunction(() => document.querySelector('[data-room-code="OPEN"] .mm-btn-join')?.disabled);
  await observer.click('[data-room-code="OPEN"] .mm-btn-spectate');
  await observer.waitForFunction(() => { const s = globalThis.__SP__.store.get(); return s.room?.spectators?.some(p => p.playerId === s.me.playerId); });
  const empty = await pageIn();
  await empty.click('[data-testid="public-room-lobby"]');
  for (const code of ['OPEN', 'FULL']) server.lobby.rooms.get(code).private = true;
  await empty.click('.mm-refresh-btn');
  await empty.waitForFunction(() => document.querySelector('.mm-room-empty')?.textContent.includes('暂无公开同盟房间'));
  assert.deepEqual(errors, []);
});
