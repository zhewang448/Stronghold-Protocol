import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { startServer } from '../../server/index.js';
import { buildResourceManifest } from '../../server/http/resourceManifest.js';
import { CHROME, ROOT, hasChrome } from '../e2e/client.mjs';
import path from 'node:path';

test('resource manager downloads to real Cache Storage; the worker answers offline hashed/range requests', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async t => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await srv.close(); });
  const actual = await buildResourceManifest({ publicDir: path.join(ROOT,'public') });
  const files = [actual.files.find(f=>f.url.includes('/emoticon/kano/')),actual.files.find(f=>f.url.endsWith('/fonts.css'))];
  assert.ok(files.every(Boolean));
  const animationBytes = Buffer.from('optional animation fixture');
  const animation = { url: '/assets/dynamic/browser-fixture/anim.skel', tier: 2, size: animationBytes.length,
    hash: createHash('sha1').update(animationBytes).digest('hex').slice(0, 12) };
  const manifest = { ...actual, version: 'browser-fixture', files: [...files, animation], count: 3, tier1: 2, totalBytes: files.reduce((n,f)=>n+f.size,animation.size) };
  let animationRequests = 0;
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e=>errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().endsWith('/data/resource-manifest.json')) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
    if (req.url().endsWith(animation.url)) { animationRequests++; return req.respond({ status: 200, contentType: 'application/octet-stream', body: animationBytes }); }
    return req.continue();
  });
  await page.goto(`http://127.0.0.1:${srv.port}/`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.res-pill__head'); await page.click('.res-pill__head');
  await page.waitForSelector('.resource-modal');
  await page.waitForSelector('[data-testid=resource-download]');
  assert.equal(await page.$('[data-testid="asset-download"]'), null, 'the duplicate download entry is removed');
  assert.equal(await page.$$eval('[data-testid="resource-download"]', (items) => items.length), 1, 'one primary download action');
  await page.waitForFunction(()=>document.querySelector('.resource-manager__tiers').textContent.includes('2'));
  assert.equal(await page.$eval('[data-testid=preload-dynamic]', e => e.checked), false);
  await page.click('.resource-modal .modal__actions .btn--primary');
  await page.waitForFunction(async()=>{const m=await import('/js/resources/index.js');return m.resourceState().done===2&&m.resourceState().phase==='ready';},{timeout:30000});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.waitForSelector('.resource-modal .modal__actions .btn--primary:not([disabled])');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 600))); // settle progress and entrance transitions
  await mkdir(path.join(ROOT,'.cache/ui-hub-port/shots'),{recursive:true});
  await page.screenshot({path:path.join(ROOT,'.cache/ui-hub-port/shots/resources.png')});
  await page.setViewport({width:844,height:390});
  await page.screenshot({path:path.join(ROOT,'.cache/ui-hub-port/shots/resources-mobile.png')});
  await page.setOfflineMode(true);
  const results = await page.evaluate(async f=>{
    const hashed=f.url.replace('/assets/',`/assets/~${f.assetHash}/`);
    const full=await fetch(hashed), range=await fetch(hashed,{headers:{Range:'bytes=0-7'}});
    const a=new Uint8Array(await full.arrayBuffer()),b=new Uint8Array(await range.arrayBuffer());
    return {status:full.status,range:range.status,length:a.length,bytes:[...a.subarray(0,8)],slice:[...b]};
  },files[0]);
  assert.equal(results.status,200);assert.equal(results.range,206);assert.equal(results.length,files[0].size);assert.deepEqual(results.bytes,results.slice);
  await page.setOfflineMode(false);
  await page.evaluate(async()=>{const m=await import('/js/resources/index.js');const zip=await m.exportResources();await m.clearResources();await m.importResources(new File([zip.blob],'resources.zip'));});
  assert.equal(await page.evaluate(async()=> (await import('/js/resources/index.js')).resourceState().done),2);
  assert.equal(animationRequests, 0, 'optional checkbox off never requests animation');
  await page.setBypassServiceWorker(true); // The synthetic animation is served by this page's request fixture.
  await page.click('[data-testid=preload-dynamic]');
  try { await page.waitForFunction(async () => (await import('/js/resources/index.js')).resourceState().done === 3); }
  catch (error) { throw new Error(JSON.stringify({ animationRequests, state: await page.evaluate(async () => ({ resource: (await import('/js/resources/index.js')).resourceState(), settings: (await import('/js/ui/settingsStore.js')).settingsStore.get() })), errors }), { cause: error }); }
  assert.ok(animationRequests > 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.res-pill__head'); await page.click('.res-pill__head');
  await page.waitForSelector('[data-testid=preload-dynamic]');
  assert.equal(await page.$eval('[data-testid=preload-dynamic]', e => e.checked), true, 'choice survives reload');
  for (const [width, height] of [[1440, 900], [1280, 720], [844, 390], [640, 360]]) {
    await page.setViewport({ width, height });
    await page.evaluate(() => document.querySelector('[data-testid=preload-dynamic]').scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(ROOT, '.cache/ui-hub-port/shots', `optional-dynamic-${width}.png`) });
    assert.equal(await page.$eval('.resource-modal .modal__body', e => e.scrollWidth > e.clientWidth + 2), false);
  }
  assert.deepEqual(errors,[]);
});
