import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { PLAYER_COLORS } from '../../public/js/ui/playerSeries.js';

test('both avatar components share twenty-seat chart colors and retain status markers', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  fs.mkdirSync('.cache/migration/avatar-colors', { recursive: true });
  try {
    for (const [width, height] of [[1440, 900], [844, 390], [640, 360]]) {
      const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      try {
        await page.setViewport({ width, height, hasTouch: width < 1000, isMobile: width < 1000 });
        await page.goto(srv.url + '/dev/game-mock.html?phase=PREP&render=fallback&shot=1', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!globalThis.__SP_VIEW__);
        await page.evaluate(async () => {
          const [{ render, h }, { AvatarFrame }, { PlayerAvatar }] = await Promise.all([import('/vendor/preact.module.js'), import('/js/ui/components.js'), import('/js/ui/gameComponents.js')]);
          const roster = Array.from({ length: 20 }, (_, seat) => ({ playerId: 'p' + seat, seat, name: 'Doctor ' + (seat + 1), alive: seat !== 18, connected: seat !== 19 }));
          const row = p => h('div', { style: 'display:flex;align-items:center;gap:8px;min-width:0' },
            h(AvatarFrame, { name: p.name, seat: p.seat, size: 'sm', self: p.seat === 0, ready: p.seat === 1, offline: p.seat === 19, dead: p.seat === 18 }),
            h(PlayerAvatar, { player: p, size: 'sm' }), h('span', {}, String(p.seat + 1)));
          render(h('main', { style: 'position:fixed;inset:12px;overflow:auto;background:#101311;color:#dfe6e2;padding:12px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;font-size:14px' }, roster.map(row)), document.getElementById('app'));
          await document.fonts.ready;
        });
        for (const selector of ['.avatar', '.pavatar']) {
          assert.deepEqual(await page.$$eval(selector, es => es.map(e => e.style.getPropertyValue('--seat-color'))), PLAYER_COLORS);
          const shades = await page.$$eval(selector, es => es.map(e => getComputedStyle(e.querySelector('.avatar__img') || e).backgroundImage));
          assert.equal(new Set(shades).size, 20, selector + ' has twenty distinct tinted backgrounds');
        }
        assert.equal(await page.$$eval('.avatar.is-self', es => es.length), 1);
        assert.equal(await page.$$eval('.avatar.is-ready', es => es.length), 1);
        assert.equal(await page.$$eval('.pavatar.is-dead .pavatar__x', es => es.length), 1);
        assert.match(await page.$eval('.pavatar.is-offline .pavatar__img', e => getComputedStyle(e).filter), /grayscale/);
        assert.match(await page.$eval('.avatar.is-dead .avatar__img', e => getComputedStyle(e).filter), /grayscale/);
        assert.deepEqual(errors, []);
        await page.screenshot({ path: `.cache/migration/avatar-colors/avatars-${width}.png` });
      } finally { await page.close(); }
    }
  } finally { await browser.close(); await srv.close(); }
});
