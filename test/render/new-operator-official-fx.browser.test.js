import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { startServer } from '../../server/index.js';
import { decodePng } from '../../tools/crop-board-atlas.mjs';

test('all nine new operator skills render real official cast, hit, area and flight effects with cleanup',
  { skip: process.env.RENDER_E2E !== '1' || !hasChrome() || !fs.existsSync('public/assets/local/fx/index.json'), timeout: 150000 }, async t => {
    const output = path.resolve('.cache/dynamic-illustrations-new-operators/followup/official-fx'); fs.mkdirSync(output, { recursive: true });
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--edge-skip-compat-layer-relaunch'] });
    t.after(async () => { await browser.close(); await srv.close(); });
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 960, height: 540 });
    await page.goto(srv.url + '/dev/fx-viewer.html?panel=0&grid=0&bg=%23404040&key=common_hit_01');
    await page.waitForFunction(() => window.__fx?.ready, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__fx.error), null);
    const rows = [];
    for (const [id, code] of [['char_4247_oxi', 'oxi'], ['char_4246_dminon', 'dminon'], ['char_4244_tocka', 'tocka']]) for (let slot = 0; slot < 3; slot++) {
      const result = await page.evaluate(async ({ id, code, slot }) => {
        const f = window.__fx; f.stopTicker(); f.stopDemo(); f.clear(); f.setTier('full');
        const demo = f.skillDemo(id, { s: slot, manual: true, dist: 2, kind: 'none' });
        const { src, tgt } = f.skillUnits();
        const keys = f.wiring.keysFor([src, tgt]); await f.lib.preload(keys);
        f.skillCmd('deploy'); f.skillCmd('on'); f.skillCmd('attack');
        const claim = kind => f.skillCmd('fx', kind, { x: tgt.x, y: tgt.y, target: 2, dur: 4 });
        const claimed = [];
        if (code === 'oxi') {
          claimed.push(claim('zone'));
          if (slot < 2) claimed.push(claim('aoe'));
          else claimed.push(f.skillCmd('fx', 'heatwave', { x: src.x, y: src.y, tx: tgt.x, ty: tgt.y, flame: 'official-test', t: 1.5 }));
        } else if (code === 'dminon') claimed.push(claim('zone'), claim('aoe'));
        else {
          claimed.push(claim('mark'), claim('aoe'));
          if (slot > 0) claimed.push(f.skillCmd('fx', 'link', { x: src.x, y: src.y, tx: tgt.x, ty: tgt.y, target: 2, flame: 'official-test', t: 1.5 }));
        }
        f.step(12, 1 / 60); f.render();
        return { id, slot, sid: demo.sid, claimed, keys: f.liveKeys(), flights: f.wiring.skills.kitFlights.size };
      }, { id, code, slot });
      assert.equal(result.sid, `skchr_${code}_${slot + 1}`);
      assert.ok(result.claimed.every(Boolean), JSON.stringify(result));
      assert.ok(result.keys.some(k => k.includes(code)), JSON.stringify(result));
      const png = Buffer.from(await page.screenshot({ path: path.join(output, `${code}-${slot + 1}.png`) })), image = decodePng(png);
      let visible = 0;
      for (let i = 0; i < image.rgba.length; i += 4) if (Math.abs(image.rgba[i] - 64) + Math.abs(image.rgba[i + 1] - 64) + Math.abs(image.rgba[i + 2] - 64) > 20) visible++;
      assert.ok(visible > 50, `${id}/${slot}: effect pixels must be visible`);
      const cleanup = await page.evaluate(() => {
        const f = window.__fx;
        f.skillCmd('fx', 'heatwaveHit', { flame: 'official-test', x: f.skillUnits().tgt.x, y: f.skillUnits().tgt.y });
        f.step(100, 1 / 60); f.skillCmd('off'); f.skillCmd('die');
        const flights = f.wiring.skills.kitFlights.size;
        f.wiring.clear(); f.clear(); f.render(); return { flights, remaining: f.liveKeys().length };
      });
      assert.deepEqual(cleanup, { flights: 0, remaining: 0 }); rows.push({ ...result, pixels: visible, cleanup });
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ rows, errors }, null, 2));
    assert.deepEqual(errors, []); console.log('9 skills rendered with official textures; all flight and clear handles released');
  });
