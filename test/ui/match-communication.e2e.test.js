import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome, OUT } from '../e2e/client.mjs';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';
import { setBlockedWords } from '../../server/chat.js';

test('reference communication: exact compact proportions, drafts, IME, history, avatar bubbles and read-only spectators', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(12000);
    page.on('pageerror', e => errors.push(e.message));
    fs.mkdirSync(OUT, { recursive: true });
    for (const [width, height] of [[1440, 900], [844, 390], [640, 360]]) {
      await page.setViewport({ width, height, hasTouch: width < 900 });
      await page.goto(`${server.url}/dev/game-mock.html?phase=PREP&render=fallback&shot=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.gm__corner');
      await page.evaluate(async () => {
        const { store } = await import('/js/store.js');
        const { emptyChat, mergeChat } = await import('/js/ui/chatStore.js');
        const { net } = await import('/js/net.js');
        const { updateSettings } = await import('/js/ui/settings.js');
        updateSettings({ chatBubbles: true }); net.status = 'online';
        store.patch('room', { textChat: true });
        store.set({ chat: emptyChat('MOCK') });
        globalThis.chatRequests = [];
        globalThis.receiveCommunication = (text, playerId = 'p1', role = 'player', history = false) => store.set(s => {
          const event = { code: 'MOCK', id: s.chat.lastId + 1, text, playerId, role, name: '凯尔希', at: Date.now() };
          return { chat: mergeChat(s.chat, history ? { code: 'MOCK', messages: [event] } : event, history, 'p1') };
        });
        const original = net.request.bind(net);
        net.request = async (type, fields, ...rest) => {
          if (type !== 'room.chat') return original(type, fields, ...rest);
          globalThis.chatRequests.push(fields);
          if (fields.text === 'fail') throw Error('offline');
          globalThis.receiveCommunication(fields.text);
          return {};
        };
      });
      await page.click('.ewheel__btn');
      await page.waitForSelector('.echat__input');
      assert.ok(await page.$('[aria-label="聊天历史"] svg'));
      assert.equal(await page.$('.chat__toggle'), null);
      await page.evaluate(async () => {
        await Promise.all([...document.querySelector('.ewheel__dialog').getAnimations({ subtree: true })].map(a => a.finished.catch(() => {})));
      });
      assert.ok(await page.$eval('.ewheel__dialog', el => {
        const r = el.getBoundingClientRect(), tabs = el.querySelector('.echat__tabs').getBoundingClientRect();
        const input = el.querySelector('.echat__input').getBoundingClientRect();
        const mobile = innerWidth < 1100;
        return r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && Math.abs(r.width - (mobile ? 220 : 260)) < 1
          && Math.abs(tabs.width - 40) < 1 && input.height === 24 && el.querySelector('input[type="text"]')
          && [...el.querySelectorAll('.ewheel__item')].length === 6
          && [...el.querySelectorAll('.ewheel__item')].every(e => Math.abs(e.getBoundingClientRect().height - (mobile ? 32 : 44)) < 1);
      }), `${width}: reference dimensions and single-line composer`);
      await page.evaluate(async () => {
        await Promise.all([...document.querySelectorAll('.ewheel__item img')].map(img => img.decode().catch(() => {})));
        await Promise.all([...document.querySelector('.ewheel__page').getAnimations()].map(a => a.finished.catch(() => {})));
      });
      await page.screenshot({ path: `${OUT}/reference-communication-emotes-${width}.png` });
      await page.type('.echat__input', '我守左路');
      await page.$eval('.echat__input', el => {
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
      });
      assert.equal(await page.evaluate(() => globalThis.chatRequests.length), 0);
      await page.$eval('.echat__input', el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      await page.keyboard.press('Enter');
      await page.waitForSelector('.ebubble--chat');
      assert.equal(await page.$eval('.echat__input', el => el.value), '');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.ewheel__dialog'));
      await page.waitForFunction(() => document.querySelector('.ewheel__btn') === document.activeElement);
      await page.waitForFunction(() => [...document.querySelector('.ebubble--chat').getAnimations()].every(a => !a.animationName.includes('pop') || a.playState === 'finished'));
      await page.screenshot({ path: `${OUT}/reference-communication-bubble-${width}.png` });
      assert.ok(await page.$eval('.ebubble--chat', el => {
        const style = getComputedStyle(el);
        return style.borderRadius === '6px' && style.backgroundColor === 'rgb(23, 36, 30)'
          && getComputedStyle(el, '::after').content === 'none' && el.closest('.team__messages') && !el.closest('.team__list');
      }));
      await page.click('.ewheel__btn');
      await page.type('.echat__input', 'fail'); await page.click('.echat__send');
      await page.waitForSelector('.echat__error');
      assert.equal(await page.$eval('.echat__input', el => el.value), 'fail');
      assert.equal(await page.$eval('.echat__input', el => el === document.activeElement), true);
      await page.keyboard.press('Escape'); await page.click('.ewheel__btn');
      assert.equal(await page.$eval('.echat__input', el => el.value), 'fail', 'draft survives closing');
      await page.click('[aria-label="聊天历史"]');
      await page.waitForSelector('.echat__history');
      await page.evaluate(() => globalThis.receiveCommunication('<img src=x onerror=alert(1)>'));
      assert.equal(await page.$('.echat__history img'), null);
      await page.waitForFunction(() => document.querySelector('.echat__text')?.textContent === '我守左路');
      await page.screenshot({ path: `${OUT}/reference-communication-history-${width}.png` });
      await page.evaluate(async () => {
        const { updateSettings } = await import('/js/ui/settings.js');
        updateSettings({ chatBubbles: false });
      });
      await page.waitForFunction(() => !document.querySelector('.ebubble--chat'));
      await page.evaluate(async () => (await import('/js/ui/settings.js')).updateSettings({ chatBubbles: true }));
      assert.equal(await page.$('.ebubble--chat'), null, 'reenabling does not replay seen bubbles');
      await page.evaluate(() => globalThis.receiveCommunication('历史补发不弹出', 'p1', 'player', true));
      assert.equal(await page.$('.ebubble--chat'), null);
      await page.click('[aria-label="表情"]');
      const theme = await page.$eval('.ewheel__page', el => el.dataset.theme);
      if (width < 900) {
        const box = await (await page.$('.ewheel__viewport')).boundingBox();
        await page.touchscreen.touchStart(box.x + box.width * .85, box.y + box.height / 2);
        for (let i = 1; i <= 8; i++) await page.touchscreen.touchMove(box.x + box.width * (.85 - i * .08), box.y + box.height / 2);
        await page.touchscreen.touchEnd();
      } else await page.click('.ewheel__nav.is-next');
      await page.waitForFunction(theme => document.querySelector('.ewheel__page').dataset.theme !== theme, {}, theme);
      assert.notEqual(await page.$eval('.ewheel__page', el => el.dataset.theme), theme);
      await page.click('.ewheel__item');
      await page.waitForFunction(() => !document.querySelector('.ewheel__dialog'));
      await page.waitForSelector('.ebubble:not(.ebubble--chat)');
      await page.evaluate(async () => {
        const { store } = await import('/js/store.js');
        store.patch('room', { seats: [], spectators: [{ playerId: 'p1', name: 'Host' }] });
      });
      await page.click('.ewheel__btn');
      await page.waitForSelector('.echat__input:disabled');
      assert.ok(await page.$('.ewheel__item:disabled'));
      await page.click('[aria-label="聊天历史"]');
      assert.match(await page.$eval('.echat', el => el.textContent), /观战者只能阅读聊天/);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});

test('reference chat uses real room transport, moderation and 200-character drafts', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 45000,
}, async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, MatchClass: StubMatch });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  let peer;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__SP__);
    await page.evaluate(() => globalThis.__SP__.net.setName('RefHost'));
    await page.waitForFunction(() => globalThis.__SP__.net.status === 'online');
    const code = await page.evaluate(async () => {
      globalThis.__SP__.store.patch('session', { entered: true });
      await globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' });
      return globalThis.__SP__.store.get().room.code;
    });
    peer = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
    await peer.hello('RefPeer'); await peer.request({ t: 'room.join', code });
    await page.evaluate(async () => {
      const { render } = await import('/vendor/preact.module.js');
      const { useState } = await import('/vendor/hooks.module.js');
      const { html } = await import('/js/ui/components.js');
      const { MatchCommunication } = await import('/js/ui/matchCommunication.js');
      const root = document.createElement('div'); root.className = 'gm__corner'; document.body.append(root);
      function Harness() { const [open, setOpen] = useState(true); return html`<${MatchCommunication} open=${open} onToggle=${setOpen} onSend=${() => {}} disabled=${false} />`; }
      render(html`<${Harness} />`, root);
    });
    await page.waitForSelector('.echat__input');
    setBlockedWords(['屏蔽测试']);
    await page.type('.echat__input', '屏蔽测试'); await page.keyboard.press('Enter');
    const message = await peer.waitFor('chat.message', m => m.text === '***');
    assert.equal(message.name, 'RefHost');
    await page.waitForFunction(() => !globalThis.__SP__.store.get().chat.sending);
    const hostId = await page.evaluate(() => globalThis.__SP__.store.get().me.playerId);
    server.lobby.rooms.get(code).chat.muted.add(hostId);
    await page.type('.echat__input', '汉'.repeat(200));
    await page.waitForFunction(() => document.querySelector('.echat__input').value.length === 200);
    await page.click('.echat__send');
    await page.waitForSelector('.echat__error');
    assert.equal(await page.$eval('.echat__input', el => el.value.length), 200, 'server refusal preserves full draft');
    server.lobby.rooms.get(code).chat.muted.delete(hostId);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1050)));
    await page.click('.echat__send');
    assert.equal((await peer.waitFor('chat.message', m => [...m.text].length === 200)).text.length, 200);
    await page.waitForFunction(() => document.querySelector('.echat__input').value === '');
  } finally { setBlockedWords([]); await peer?.terminate(); await browser.close(); await server.close(); }
});
