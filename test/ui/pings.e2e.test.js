import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('field ping placement in the browser', { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1', '--enable-unsafe-swiftshader'] });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  for (const [render, width, height] of [['fallback', 1600, 900], ['engine', 1600, 900], ['fallback', 844, 390]]) {
    test(`${render} ${width}×${height}: placement, watched field, expiry and usable controls`, async (t) => {
      const page = await browser.newPage();
      t.after(() => page.close());
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewport({ width, height, hasTouch: width < 900 });
      await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?phase=PREP&render=${render}&shot=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('.gm__ping-tools', { timeout: 30000 });
      await page.waitForFunction((kind) => globalThis.__SP_VIEW__?.kind === kind, { timeout: 30000 }, render);
      await page.evaluate(async () => {
        const { net } = await import('/js/net.js');
        const { audio } = await import('/js/audio.js');
        audio.setVolumes({ bgm: 0, voice: 0 });
        const original = net.request.bind(net);
        globalThis.pingRequests = [];
        globalThis.shopRequests = [];
        globalThis.pingSounds = [];
        const originalPing = audio.ping.bind(audio);
        audio.ping = (kind) => { globalThis.pingSounds.push(kind); return originalPing(kind); };
        net.request = (type, fields, ...rest) => {
          if (type === 'g.ping') globalThis.pingRequests.push(fields);
          if (type === 'g.refresh' || type === 'g.freeze') globalThis.shopRequests.push(type);
          return original(type, fields, ...rest);
        };
      });
      assert.ok(await page.evaluate(() => {
        const panel = document.querySelector('.gm__ping-tools').getBoundingClientRect();
        return [...document.querySelectorAll('.shopbar__tools button')].every((el) => {
          const r = el.getBoundingClientRect();
          const overlaps = panel.left < r.right && panel.right > r.left && panel.top < r.bottom && panel.bottom > r.top;
          return !overlaps && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === el;
        });
      }), 'ping palette leaves refresh and freeze unobscured and clickable');
      await page.click('.toolbtn--ice');
      await page.waitForFunction(() => document.querySelector('.toolbtn--ice.is-on'));
      await page.click('.toolbtn--amber');
      await page.waitForFunction(() => globalThis.shopRequests.includes('g.refresh'));
      await page.$eval('.gm__ping-btn--question', el => el.scrollIntoView({ block: 'nearest', inline: 'center' }));
      assert.ok(await page.$eval('.gm__ping-btn--question', (el) => {
        const r = el.getBoundingClientRect();
        const compact = el.closest('[data-compact]');
        return r.width >= (compact ? 30 : 44) && r.height >= (compact ? 30 : 44) && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === el;
      }), 'question button scales visually while its center stays reachable');
      await page.click('.gm__ping-btn--question');
      await page.waitForSelector('.gm__ping-target');
      await page.evaluate(async () => {
        const { audio } = await import('/js/audio.js');
        globalThis.pingOscillators = 0;
        const create = audio.ctx.createOscillator.bind(audio.ctx);
        audio.ctx.createOscillator = () => { globalThis.pingOscillators++; return create(); };
        const analyser = audio.ctx.createAnalyser();
        audio.sfxGain.connect(analyser);
        const wave = new Float32Array(analyser.fftSize);
        globalThis.pingAudioPeak = 0;
        const sample = () => {
          analyser.getFloatTimeDomainData(wave);
          globalThis.pingAudioPeak = Math.max(globalThis.pingAudioPeak, ...wave.map(Math.abs));
          requestAnimationFrame(sample);
        };
        sample();
      });
      const point = await page.evaluate(() => globalThis.__SP_VIEW__.tileScreen(10, 4));
      assert.ok(point && point.x > 0 && point.x < width && point.y > 0 && point.y < height, 'tile is on screen');
      if (width < 900) await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
      await page.waitForSelector('.gm__ping--question');
      assert.equal(await page.$eval('.gm__ping-name', (el) => el.textContent), await page.evaluate(async () => {
        const { store } = await import('/js/store.js');
        return store.get().match.public.players.find((p) => p.playerId === store.get().me.playerId).name;
      }), 'ping identifies its sender');
      assert.deepEqual(await page.evaluate(() => globalThis.pingRequests.at(-1)), { fieldId: 'n:p1', area: 'board', row: 10, col: 4, kind: 'question' });
      assert.equal(await page.$('.gm__ping-target'), null, 'placement exits after one ping');
      await page.waitForFunction(() => globalThis.pingOscillators > 0 && globalThis.pingAudioPeak > 0.001);
      assert.deepEqual(await page.evaluate(() => globalThis.pingSounds), ['question'], 'one cue for the accepted visible ping');
      assert.ok(await page.$eval('.gm__ping-badge', (el) => el.getBoundingClientRect().width >= 56), 'marker stays legible on a small screen');
      assert.equal(await page.$$eval('.gm__ping-ring', (els) => els.length), 2, 'location has two ground ripples');
      const marker = await page.$eval('.gm__ping', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      assert.ok(Math.abs(marker.x - point.x) < 2 && Math.abs(marker.y - point.y) < 2, 'marker follows the tile viewport geometry');
      if (process.env.PING_QA_SCREENSHOTS === '1') {
        mkdirSync('.cache/ping-qa', { recursive: true });
        await page.waitForFunction(() => [...document.querySelectorAll('.gm__ping-drop')].every((el) => !el.getAnimations().some((a) => a.playState === 'running')));
        await page.screenshot({ path: `.cache/ping-qa/own-${render}-${width}.png` });
      }
      const ground = await page.evaluate(() => globalThis.__SP_VIEW__.tileScreen(12, 9));
      await page.mouse.click(ground.x, ground.y, { button: 'right' });
      await page.waitForFunction(() => globalThis.pingRequests.length === 2);
      assert.deepEqual(await page.evaluate(() => globalThis.pingRequests.at(-1)), { fieldId: 'n:p1', area: 'board', row: 12, col: 9, kind: 'question' });
      const occupied = await page.evaluate(async () => {
        const { store } = await import('/js/store.js');
        for (const piece of store.get().match.private.board) {
          const point = globalThis.__SP_VIEW__.tileScreen(piece.row, piece.col);
          if (point && document.elementFromPoint(point.x, point.y)?.closest('.gm__field')) return { ...point, row: piece.row, col: piece.col };
        }
        return null;
      });
      assert.ok(occupied, 'an occupied operator tile is reachable');
      await page.mouse.click(occupied.x, occupied.y, { button: 'right' });
      await page.waitForFunction(() => globalThis.pingRequests.length === 3);
      assert.deepEqual(await page.evaluate(() => globalThis.pingRequests.at(-1)), {
        fieldId: 'n:p1', area: 'board', row: occupied.row, col: occupied.col, kind: 'question',
      }, 'right-clicking an operator sends the selected ping');
      assert.equal(await page.$('.dpanel'), null, 'right-click does not open operator details');
      await page.mouse.click(occupied.x, occupied.y);
      await page.waitForSelector('.dpanel');
      await page.click('.dpanel__close');
      await page.click('.team__row:nth-child(3) .team__btn', { clickCount: 2 });
      await page.waitForFunction(() => !document.querySelector('.gm__ping'), { timeout: 1500 });
      const heardBefore = await page.evaluate(() => globalThis.pingSounds.length);
      await page.evaluate(async () => {
        const { store } = await import('/js/store.js');
        store.set((s) => ({ pings: [...s.pings, { fieldId: 'n:p1', area: 'board', row: 10, col: 4, kind: 'danger', seq: Date.now(), at: Date.now() }] }));
      });
      await page.waitForFunction(() => !document.querySelector('.gm__ping'));
      // Let Preact's effects flush, then prove another battlefield's ping stayed silent.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => globalThis.pingSounds.length), heardBefore);
      await page.click('.gm__ping-btn--question');
      await page.waitForSelector('.gm__ping-target');
      const watchedPoint = await page.evaluate(() => globalThis.__SP_VIEW__.tileScreen(10, 4));
      if (width < 900) await page.touchscreen.tap(watchedPoint.x, watchedPoint.y);
      else await page.mouse.click(watchedPoint.x, watchedPoint.y);
      await page.waitForSelector('.gm__ping--question');
      assert.equal(await page.evaluate(() => globalThis.pingRequests.at(-1).fieldId), 'n:p3');
      if (process.env.PING_QA_SCREENSHOTS === '1') {
        mkdirSync('.cache/ping-qa', { recursive: true });
        await page.waitForFunction(() => [...document.querySelectorAll('.gm__ping-drop')].every((el) => !el.getAnimations().some((a) => a.playState === 'running')));
        await page.screenshot({ path: `.cache/ping-qa/${render}-${width}.png` });
      }
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.waitForFunction(() => {
        const el = document.querySelector('.gm__ping');
        if (!el) return false;
        const ring = getComputedStyle(el.querySelector('.gm__ping-ring'));
        return getComputedStyle(el.querySelector('.gm__ping-badge')).animationName === 'none'
          && ring.animationName === 'none' && Number(ring.opacity) > 0;
      }, { timeout: 1500 });
      assert.ok(await page.$eval('.gm__ping', (el) => {
        const badge = getComputedStyle(el.querySelector('.gm__ping-badge'));
        const ring = getComputedStyle(el.querySelector('.gm__ping-ring'));
        return badge.animationName === 'none' && ring.animationName === 'none' && Number(ring.opacity) > 0;
      }), 'reduced motion preserves a visible target without spatial animation');
      await page.waitForFunction(() => !document.querySelector('.gm__ping'), { timeout: 4000 });
      assert.ok(await page.evaluate(async () => {
        const { audio } = await import('/js/audio.js');
        const before = globalThis.pingOscillators;
        audio.setVolumes({ muted: true }); audio.ping('danger');
        const muted = globalThis.pingOscillators === before;
        audio.setVolumes({ muted: false, sfx: 0 }); audio.ping('danger');
        const silent = globalThis.pingOscillators === before;
        audio.setVolumes({ sfx: 0.8 }); audio.ping('danger');
        return muted && silent && globalThis.pingOscillators > before;
      }), 'ping sounds respect mute and zero SFX volume, and resume when enabled');
      await page.click('.gm__ping-btn--danger');
      await page.waitForSelector('.gm__ping-target');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.gm__ping-target'));
      await page.$eval('.gm__ping-btn--heart', el => el.scrollIntoView({ block: 'nearest', inline: 'center' }));
      assert.ok(await page.$eval('.gm__ping-btn--heart', el => {
        const r = el.getBoundingClientRect();
        const compact = el.closest('[data-compact]');
        return r.width >= (compact ? 30 : 44) && r.height >= (compact ? 30 : 44) && r.right <= innerWidth
          && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === el;
      }), 'heart is reachable alongside the five existing pings');
      await page.click('.gm__ping-btn--heart');
      await page.waitForSelector('.gm__ping-target');
      await page.mouse.click(watchedPoint.x, watchedPoint.y);
      await page.waitForSelector('.gm__ping--heart');
      await page.waitForFunction(() => globalThis.pingSounds.at(-1) === 'heart');
      assert.equal(await page.evaluate(() => globalThis.pingRequests.at(-1).kind), 'heart');
      assert.equal(await page.evaluate(() => globalThis.pingSounds.at(-1)), 'heart');
      if (process.env.PING_QA_SCREENSHOTS === '1') await page.screenshot({ path: `.cache/ping-qa/heart-${render}-${width}.png` });
      assert.deepEqual(errors, []);
    });
  }

  for (const render of ['fallback', 'engine']) for (const [variant, col] of [['boss', 4], ['bossR', 16]]) {
    test(`${render} ${variant}: owner and scout agree on boss prep ping coordinates`, async (t) => {
      const page = await browser.newPage();
      t.after(() => page.close());
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?phase=PREP&variant=${variant}&render=${render}&shot=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.gm__ping-btn--attention', { timeout: 30000 });
      await page.waitForFunction((kind) => globalThis.__SP_VIEW__?.kind === kind && globalThis.__SP_VIEW__.tileScreen(10, 4), { timeout: 30000 }, render);
      await page.evaluate(async () => {
        const { net } = await import('/js/net.js');
        const original = net.request.bind(net);
        globalThis.pingRequests = [];
        net.request = (type, fields, ...rest) => {
          if (type === 'g.ping') globalThis.pingRequests.push(fields);
          return original(type, fields, ...rest);
        };
      });
      await page.click('.gm__ping-btn--attention');
      const own = await page.evaluate(() => globalThis.__SP_VIEW__.tileScreen(10, 4));
      await page.mouse.click(own.x, own.y);
      await page.waitForFunction(() => globalThis.pingRequests.length === 1);
      assert.deepEqual(await page.evaluate(() => globalThis.pingRequests[0]), { fieldId: 'n:p1', area: 'board', row: 3, col, kind: 'attention' });
      await page.waitForSelector('.gm__ping--attention');
      const marker = await page.$eval('.gm__ping', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      assert.ok(Math.abs(marker.x - own.x) < 2 && Math.abs(marker.y - own.y) < 2);

      await page.click('.team__row:nth-child(3) .team__btn', { clickCount: 2 });
      await page.waitForSelector('.gm__watching');
      await page.waitForFunction(() => globalThis.__MOCK__?.store.get().match.field?.fieldId === 'n:p3');
      await page.evaluate(async () => {
        const { store } = await import('/js/store.js');
        const { GEO } = await import('/shared/constants.js');
        const field = store.get().match.field;
        store.patch('match', { field: { ...field, kind: 'boss', side: 'L', rect: GEO.BOSS_RECT, prep: true, units: [] } });
      });
      await page.waitForFunction(() => globalThis.__SP_VIEW__?.tileScreen(3, 4), { timeout: 10000 });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await page.click('.gm__ping-btn--attention');
      const watched = await page.evaluate(() => globalThis.__SP_VIEW__.tileScreen(3, 4));
      await page.mouse.click(watched.x, watched.y);
      await page.waitForFunction(() => globalThis.pingRequests.length === 2);
      assert.deepEqual(await page.evaluate(() => globalThis.pingRequests[1]), { fieldId: 'n:p3', area: 'board', row: 3, col: 4, kind: 'attention' });
    });
  }

  for (const render of ['fallback', 'engine']) {
    test(`${render}: a watched boss combat ping remains on its battlefield tile`, async (t) => {
      const page = await browser.newPage();
      t.after(() => page.close());
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?phase=FINAL_ASSAULT&variant=dead&render=${render}&shot=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction((kind) => globalThis.__SP_VIEW__?.kind === kind && globalThis.__SP_VIEW__.tileScreen(3, 4), { timeout: 30000 }, render);
      await page.click('.team__row:nth-child(3) .team__btn');
      await page.waitForFunction(() => globalThis.__MOCK__?.store.get().match.field?.fieldId === 'b2');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const point = await page.evaluate(() => globalThis.__SP_VIEW__.tileScreen(3, 4));
      await page.evaluate(async () => {
        const { store } = await import('/js/store.js');
        store.set((s) => ({ pings: [...s.pings, { fieldId: 'b2', area: 'board', row: 3, col: 4, kind: 'danger', seq: Date.now(), at: Date.now() }] }));
      });
      await page.waitForSelector('.gm__ping--danger');
      const marker = await page.$eval('.gm__ping--danger', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      assert.ok(Math.abs(marker.x - point.x) < 2 && Math.abs(marker.y - point.y) < 2);
      await page.evaluate(async () => {
        const { net } = await import('/js/net.js');
        const original = net.request.bind(net);
        globalThis.pingRequests = [];
        net.request = (type, fields, ...rest) => {
          if (type === 'g.ping') { globalThis.pingRequests.push(fields); return Promise.resolve({}); }
          return original(type, fields, ...rest);
        };
      });
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page.waitForFunction(() => globalThis.pingRequests.length === 1);
      assert.deepEqual(await page.evaluate(() => ({ row: globalThis.pingRequests[0].row, col: globalThis.pingRequests[0].col })), { row: 3, col: 4 });
    });
  }

  for (const side of ['L', 'R']) {
    test(`engine: watched boss prep ground pings use battlefield coordinates, ${side} scout`, async (t) => {
      const page = await browser.newPage();
      t.after(() => page.close());
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?phase=PREP&variant=boss&render=engine&shot=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__SP_VIEW__?.kind === 'engine', { timeout: 30000 });
      await page.click('.team__row:nth-child(3) .team__btn', { clickCount: 2 });
      await page.waitForFunction(() => globalThis.__MOCK__?.store.get().match.field?.fieldId === 'n:p3');
      await page.evaluate(async (fieldSide) => {
        const { store } = await import('/js/store.js');
        const { net } = await import('/js/net.js');
        const { GEO } = await import('/shared/constants.js');
        const field = store.get().match.field;
        const occupant = { ...field.units[0], x: fieldSide === 'L' ? 3 : 17, y: 3 };
        globalThis.pingRequests = [];
        const original = net.request.bind(net);
        net.request = (type, fields, ...rest) => {
          if (type === 'g.ping') { globalThis.pingRequests.push(fields); return Promise.resolve({}); }
          return original(type, fields, ...rest);
        };
        store.patch('match', { field: { ...field, kind: 'boss', side: fieldSide, rect: GEO.BOSS_RECT, prep: true, units: [occupant] } });
      }, side);
      await page.waitForFunction(() => globalThis.__SP_VIEW__?.raw.stats?.().mode === 'battle' && globalThis.__SP_VIEW__.raw.stats().units === 1, { timeout: 10000 });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const observed = await page.evaluate(async (fieldSide) => {
        const view = globalThis.__SP_VIEW__;
        view.setCamera('prep', { side: fieldSide, rect: { r0: 0, r1: 5, c0: 0, c1: 20 }, fit: true, instant: true });
        const canvas = document.querySelector('.gm__field canvas[aria-label="战场"]');
        const found = [];
        const events = [];
        const offTile = view.on('tileClick', (event) => events.push({ type: 'tile', row: event.row, col: event.col }));
        const offPiece = view.on('pieceClick', (event) => events.push({ type: 'piece', uid: event.uid }));
        for (const row of [1, 2, 3, 4, 5]) for (const col of [3, 7, 13, 17]) {
          const point = view.tileScreen(row, col);
          if (!point || point.x < 0 || point.x >= innerWidth || point.y < 0 || point.y >= innerHeight) continue;
          const before = globalThis.pingRequests.length;
          const previousEvents = events.length;
          canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2, pointerType: 'mouse', clientX: point.x, clientY: point.y }));
          await new Promise((resolve) => setTimeout(resolve, 10));
          const actual = globalThis.pingRequests.length > before ? globalThis.pingRequests.at(-1) : null;
          found.push({ expected: { row, col }, actual: actual && { row: actual.row, col: actual.col }, events: events.slice(previousEvents) });
        }
        offTile(); offPiece();
        return found;
      }, side);
      assert.ok(observed.length >= 8, `enough projected battlefield tiles: ${observed.length}`);
      assert.ok(observed.some((row) => row.expected.col < 10) && observed.some((row) => row.expected.col > 10), 'both battlefield halves are visible');
      assert.deepEqual(observed.filter((row) => JSON.stringify(row.actual) !== JSON.stringify(row.expected)), []);
      assert.ok(observed.some((row) => row.events.some((event) => event.type === 'piece')), 'occupied operator tiles are included');
      const ownSide = side === 'L' ? [3, 7] : [13, 17];
      for (const col of ownSide) {
        const point = await page.evaluate((column) => globalThis.__SP_VIEW__.tileScreen(3, column), col);
        if (!point || point.x < 0 || point.x >= 1600 || point.y < 0 || point.y >= 900) continue;
        await page.mouse.click(point.x, point.y, { button: 'right' });
        assert.deepEqual(await page.evaluate(() => ({ row: globalThis.pingRequests.at(-1).row, col: globalThis.pingRequests.at(-1).col })), { row: 3, col });
      }
    });
  }

  for (const [variant, oppositeCol] of [['boss', 16], ['bossR', 4]]) {
    test(`engine: ${variant} own boss prep can ping the opposite half`, async (t) => {
      const page = await browser.newPage();
      t.after(() => page.close());
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?phase=PREP&variant=${variant}&render=engine&shot=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__SP_VIEW__?.kind === 'engine' && globalThis.__SP_VIEW__.tileScreen(10, 16), { timeout: 30000 });
      await page.evaluate(async () => {
        const { net } = await import('/js/net.js');
        const original = net.request.bind(net);
        globalThis.pingRequests = [];
        net.request = (type, fields, ...rest) => {
          if (type === 'g.ping') globalThis.pingRequests.push(fields);
          return original(type, fields, ...rest);
        };
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await page.click('.gm__ping-btn--attention');
      const point = await page.evaluate((side) => {
        globalThis.__SP_VIEW__.setCamera('bossPrep', { side, rect: { r0: 0, r1: 5, c0: 0, c1: 20 }, fit: true, instant: true });
        return globalThis.__SP_VIEW__.tileScreen(10, 16);
      }, variant === 'bossR' ? 'R' : 'L');
      assert.ok(point.x > 0 && point.x < 1600 && point.y > 0 && point.y < 900, `opposite tile is on screen: ${JSON.stringify(point)}`);
      await page.$eval('.gm__ping-target', (target, pos) => target.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, button: 0, pointerType: 'mouse', clientX: pos.x, clientY: pos.y,
      })), point);
      const armed = await page.evaluate(() => globalThis.pingRequests.at(-1) || null);
      assert.deepEqual(armed && { row: armed.row, col: armed.col }, { row: 3, col: oppositeCol });
      await page.mouse.click(point.x, point.y, { button: 'right' });
      const ground = await page.evaluate(() => globalThis.pingRequests.at(-1) || null);
      assert.equal(await page.evaluate(() => globalThis.pingRequests.length), 2);
      assert.deepEqual(ground && { row: ground.row, col: ground.col }, { row: 3, col: oppositeCol });
    });
  }

  for (const render of ['fallback', 'engine']) {
    test(`${render}: watched normal prep pings remain on the selected tile`, async (t) => {
      const page = await browser.newPage();
      t.after(() => page.close());
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?phase=PREP&render=${render}&shot=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction((kind) => globalThis.__SP_VIEW__?.kind === kind, { timeout: 30000 }, render);
      await page.click('.team__row:nth-child(3) .team__btn', { clickCount: 2 });
      await page.waitForFunction(() => globalThis.__MOCK__?.store.get().match.field?.fieldId === 'n:p3');
      await new Promise((resolve) => setTimeout(resolve, 700));
      await page.evaluate(async () => {
        const { net } = await import('/js/net.js');
        const original = net.request.bind(net);
        globalThis.pingRequests = [];
        net.request = (type, fields, ...rest) => {
          if (type === 'g.ping') { globalThis.pingRequests.push(fields); return Promise.resolve({}); }
          return original(type, fields, ...rest);
        };
      });
      const point = await page.evaluate(() => globalThis.__SP_VIEW__.tileScreen(10, 4));
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page.waitForFunction(() => globalThis.pingRequests.length === 1);
      assert.deepEqual(await page.evaluate(() => ({ row: globalThis.pingRequests[0].row, col: globalThis.pingRequests[0].col })), { row: 10, col: 4 });
    });
  }
});
