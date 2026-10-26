// Actual match UI at ordinary desktop sizes: avatar messages and phase actions.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const CHROME = process.env.CHROME_PATH;
describe('match layout at normal desktop sizes', { skip: process.env.SP_E2E !== '1' || !CHROME || !existsSync(CHROME) }, () => {
  let server, browser;
  before(async () => {
    server = await (await import('../../server/index.js')).startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });
  after(async () => { await browser?.close(); await server?.close(); });
  for (const [width, height] of [[1920, 1080], [1366, 768]]) test(`${width}x${height}: messages, scrolling and phase actions`, { timeout: 90000 }, async () => {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.setViewport({ width, height });
      await page.evaluateOnNewDocument(() => localStorage.setItem('sp.pref.settings', JSON.stringify({ textSize: 'sm', chatBubbles: true })));
      await page.goto(server.url + '/dev/game-mock.html?phase=PREP&render=fallback&shot=1', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!globalThis.__MOCK__ && !!document.querySelector('.team'));
      await page.waitForSelector('.pbanner--overlay', { hidden: true, timeout: 15000 });
      await page.evaluate(async () => {
        const { store } = await import('/js/store.js');
        const { emptyChat, mergeChat } = await import('/js/ui/chatStore.js');
        const { net } = await import('/js/net.js');
        let seq = 0;
        globalThis.sendLayoutMessage = playerId => store.set(s => ({ chat: mergeChat(s.chat, { code: 'MOCK', id: ++seq, playerId, name: playerId, text: '我负责左路，请队友支援右侧。', at: Date.now() }, false, 'observer') }));
        globalThis.configureLayout = count => {
          globalThis.__MOCK__.mutate(s => {
            const base = s.pub.players[0];
            s.pub.players = Array.from({ length: count }, (_, i) => ({ ...base, playerId: i ? 'layout_' + i : 'p1', seat: i, name: '博士' + (i + 1), alive: true, ready: false, status: 'acting', isBot: false }));
            s.pub.poolGroups = count > 4 ? Array.from({ length: Math.ceil(count / 4) }, (_, i) => ({ id: i + 1, playerIds: s.pub.players.slice(i * 4, i * 4 + 4).map(p => p.playerId) })) : [];
            s.priv.ready = false;
          });
          store.patch('room', { textChat: true, convenience: { prepLoadout: true }, seats: globalThis.__MOCK__.S().pub.players });
          store.set({ chat: emptyChat('MOCK') });
        };
        const request = net.request.bind(net);
        globalThis.layoutRequests = [];
        net.request = async (type, fields, ...rest) => {
          if (type === 'g.uniteSkipVote') { globalThis.layoutRequests.push({ type, fields }); return {}; }
          return request(type, fields, ...rest);
        };
      });
      const checkBubble = async (id, nearAvatar = true) => {
        const selector = '.team__message[data-player-id="' + id + '"] .ebubble--chat';
        await page.waitForSelector(selector);
        await page.evaluate(() => document.querySelectorAll('.ebubble--chat').forEach(e => e.getAnimations().forEach(a => { if (a.animationName.includes('pop')) a.finish(); else a.pause(); })));
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const b = await page.$eval(selector, (el, id) => {
          const r = el.getBoundingClientRect(), a = document.querySelector('.team__row[data-player-id="' + id + '"]').getBoundingClientRect(), clipped = [];
          for (let p = el.parentElement; p; p = p.parentElement) {
            const s = getComputedStyle(p), t = p.getBoundingClientRect();
            if ((/auto|scroll|hidden|clip/.test(s.overflowX) && (r.left < t.left - 1 || r.right > t.right + 1)) || (/auto|scroll|hidden|clip/.test(s.overflowY) && (r.top < t.top - 1 || r.bottom > t.bottom + 1))) clipped.push(p.className);
          }
          return { clipped, gap: r.left - a.right, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, opacity: Number(getComputedStyle(el).opacity), layer: !!el.closest('.team__messages'), inList: !!el.closest('.team__list'), offscreen: el.parentElement.hasAttribute('data-offscreen'), author: el.parentElement.dataset.author };
        }, id);
        assert.deepEqual(b.clipped, []); assert.equal(b.inside, true); assert.ok(b.opacity > .9); assert.equal(b.layer, true); assert.equal(b.inList, false);
        if (nearAvatar) assert.ok(Math.abs(b.gap - 8) < 2, JSON.stringify(b));
        return b;
      };
      for (const count of [1, 2, 3, 4, 6, 8, 12, 20]) {
        await page.evaluate(count => globalThis.configureLayout(count), count);
        await page.evaluate(() => globalThis.sendLayoutMessage('p1')); await checkBubble('p1');
        if (count > 6) {
          const id = 'layout_' + (count - 1);
          await page.evaluate(id => globalThis.sendLayoutMessage(id), id);
          const b = await checkBubble(id, false); if (b.offscreen) assert.equal(b.author, '博士' + count);
          await page.$eval('.team__list', e => { e.scrollTop = e.scrollHeight; });
          await page.waitForFunction(id => !document.querySelector('.team__message[data-player-id="' + id + '"]')?.hasAttribute('data-offscreen'), {}, id);
          await checkBubble(id); await page.$eval('.team__list', e => { e.scrollTop = 0; });
        }
      }
      const reachable = selector => page.$eval(selector, e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
      const loadout = '[data-testid=loadout-open]';
      assert.ok(await page.$('.gtop__right ' + loadout)); assert.equal(await page.$('.gm__corner ' + loadout), null); assert.equal(await reachable(loadout), true);
      await page.click(loadout);
      assert.equal(await page.evaluate(async () => (await import('/js/ui/loadoutSync.js')).loadoutStore.get().from), 'prep');
      await page.evaluate(async () => (await import('/js/ui/loadoutSync.js')).closeLoadout());
      await page.evaluate(() => globalThis.__MOCK__.mutate(s => { s.priv.ready = true; })); await page.waitForSelector(loadout, { hidden: true });
      await page.evaluate(() => { globalThis.__MOCK__.setPhase('UNITE'); globalThis.__MOCK__.mutate(s => { s.pub.unite = { ...s.pub.unite, round: 1, roundsMax: 3, skipVote: { id: 'layout-vote', eligible: ['p1', 'p3'], voters: [], needed: 2, passed: false, open: true } }; }); });
      const vote = '[data-testid=unite-skip-vote]';
      await page.waitForSelector('.gtop__right ' + vote); await page.waitForSelector('.pbanner--overlay', { hidden: true, timeout: 15000 });
      assert.equal(await reachable(vote), true); await page.click(vote);
      assert.deepEqual(await page.evaluate(() => globalThis.layoutRequests), [{ type: 'g.uniteSkipVote', fields: { voteId: 'layout-vote' } }]);
      await page.evaluate(() => globalThis.__MOCK__.mutate(s => { s.pub.unite.skipVote.voters = ['p1']; }));
      await page.waitForFunction(() => document.querySelector('[data-testid=unite-skip-vote]').disabled);
      await page.evaluate(() => globalThis.__MOCK__.mutate(s => { s.pub.unite.skipVote.passed = true; }));
      await page.waitForFunction(() => document.querySelector('.unite-vote').textContent.includes('本轮结束后直接结算'));
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});
