import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { startServer } from '../../server/index.js';

test('installed illustration catalogue renders every real animation and crop with complete pages',
  { skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 420000 }, async t => {
    const root = path.resolve(import.meta.dirname, '../..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/assets.json')));
    const registry = JSON.parse(fs.readFileSync(path.join(root, 'docs/research/dynamic-illustrations.json')));
    const entries = Object.entries(registry.skins).map(([id, r]) => {
      const art = r.field ? manifest.chars[r.charId] : manifest.chars[r.charId]?.skins?.[id];
      return { id, entry: r.field ? art?.[r.field] : art?.dynamic, still: r.field ? art?.illustE2 : art?.illust };
    }).filter(e => e.entry);
    assert.ok(entries.length, 'install real illustration assets before running this test');
    const output = path.join(root, '.cache/dynamic-illustrations-new-operators/followup/catalogue'); fs.mkdirSync(output, { recursive: true });
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--edge-skip-compat-layer-relaunch'] });
    t.after(async () => { await browser.close(); await srv.close(); });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1024, height: 900 }); await page.goto(srv.url);
    await page.evaluate(async () => {
      const [{ h, render }, { DynamicIllustration, CoverIllustration }, { createDynamicStage }, { cropFraming }] = await Promise.all([
        import('/vendor/preact.module.js'), import('/js/ui/dynamicIllustration.js'), import('/js/ui/dynamicStage.js'), import('/js/ui/dynamicFraming.js')]);
      const host = document.createElement('div'); Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: 999999, background: '#18221f', padding: '20px' }); document.body.appendChild(host);
      window.catalogueDraw = data => render(h(DynamicIllustration, { key: data.id, entry: data.entry, staticSrc: data.still, name: data.id }), host);
      window.catalogueClose = () => render(null, host);
      window.catalogueCrop = (entry, kind) => {
        window.catalogueClose();
        const stage = createDynamicStage(), wrapper = document.createElement('div');
        Object.assign(wrapper.style, { position: 'relative', width: '180px', height: kind === 'avatar' ? '180px' : '360px' });
        host.appendChild(wrapper);
        render(h(CoverIllustration, { entry, explicit: true, playing: false, stage, framing: cropFraming(entry, kind) }), wrapper);
        window.catalogueCropClose = () => { render(null, wrapper); stage.destroy(); wrapper.remove(); };
      };
    });
    const results = [];
    for (const item of entries) {
      await page.evaluate(data => window.catalogueDraw(data), item);
      await page.waitForFunction(() => ['ready', 'fallback'].includes(document.querySelector('[data-testid="dynamic-illustration"] .dyn-cover')?.dataset.state));
      assert.equal(await page.$eval('[data-testid="dynamic-illustration"] .dyn-cover', el => el.dataset.state), 'ready', item.id);
      const clips = await page.$$eval('[aria-label="动作"] option', options => options.map(o => o.value));
      const samples = [];
      for (const clip of clips.length ? clips : [null]) {
        if (clip) await page.select('[aria-label="动作"]', clip);
        await new Promise(resolve => setTimeout(resolve, 65));
        const pixels = await page.$eval('[data-testid="dynamic-illustration"] canvas', canvas => {
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let visible = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 8) visible++;
          return { visible, width: canvas.width, height: canvas.height };
        });
        assert.ok(pixels.visible > 100, item.id + ' ' + clip + ': visible pixels'); samples.push({ clip, ...pixels });
      }
      await page.click('[data-testid="dynamic-pause"]');
      await page.screenshot({ path: path.join(output, item.id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.png') });
      for (const kind of ['avatar', 'portrait']) if (item.entry.frames?.[kind]) {
        await page.evaluate(({ entry, kind }) => window.catalogueCrop(entry, kind), { entry: item.entry, kind });
        await page.waitForFunction(() => ['ready', 'fallback'].includes(document.querySelector('.dyn-cover')?.dataset.state));
        assert.equal(await page.$eval('.dyn-cover', el => el.dataset.state), 'ready', item.id + ' ' + kind);
        await page.screenshot({ path: path.join(output, item.id.replace(/[^a-zA-Z0-9_-]/g, '_') + '-' + kind + '.png') });
        await page.evaluate(() => window.catalogueCropClose());
      }
      results.push({ id: item.id, identity: item.entry.identity, pages: item.entry.textures.length, samples, crops: Object.keys(item.entry.frames || {}), sourceLayers: item.entry.nativeLayers || null });
    }
    await page.evaluate(() => window.catalogueClose());
    await page.waitForFunction(async () => (await import('/js/assets.js')).assets.spine.stats().refs === 0);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
    assert.deepEqual(errors, []);
    console.log(`${results.length} installed illustrations rendered with real textures and all listed animations; final Spine refs 0`);
  });
