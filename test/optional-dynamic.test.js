import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isOptionalDynamicArt } from '../shared/dynamicDownload.js';
import { resourceGroup, selectedResourceGroup, resourceSelection } from '../public/js/resources/common.js';
import { createAssetDownload } from '../public/js/assetDownload.js';
import { buildResourceManifest } from '../server/http/resourceManifest.js';
import { pruneMissingDynamicArt } from '../server/http/assetViews.js';
import { parseSplitIndex } from '../server/release-split.js';
import { readStagedArt, verifyStagedArt } from '../server/release-art.js';
import { clientPreferenceDefaults } from '../shared/clientPreferences.js';
import { sha } from './helpers/release-fixture.js';

test('dynamic download is independent, default off, and static fallbacks remain required', async t => {
  assert.equal(clientPreferenceDefaults()['settings.preloadDynamic'], false);
  assert.equal(selectedResourceGroup('dynamic', true, 'cn'), false);
  assert.equal(selectedResourceGroup('dynamic', false, 'cn', true), true);
  assert.equal(selectedResourceGroup('voice_cn', false, 'cn', true), false);
  assert.equal(isOptionalDynamicArt('public/assets/dynamic/x/portrait.png'), false);
  assert.equal(isOptionalDynamicArt('public/assets/dynamic/x/page.png'), true);
  assert.equal(resourceGroup({ url: '/assets/~123/dynamic/x/portrait.png', tier: 2 }), 'skins');
  const groups = [{ id: 'dynamic', wanted: 2, present: 0, bytes: 0, totalBytes: 20, unknownSize: 0 }];
  assert.equal(resourceSelection({ groups }, true, 'cn').selectedWanted, 0);
  assert.equal(resourceSelection({ groups }, false, 'cn', true).selectedWanted, 2);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-optional-dynamic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets/dynamic/x'), { recursive: true });
  for (const name of ['portrait.png', 'page.png', 'anim.skel']) fs.writeFileSync(path.join(root, 'assets/dynamic/x', name), name);
  const manifest = await buildResourceManifest({ publicDir: root });
  assert.equal(manifest.files.find(f => f.url.endsWith('portrait.png')).tier, 1);
  assert.equal(manifest.files.find(f => f.url.endsWith('anim.skel')).tier, 2);
});

test('compatibility download omits animations by default and adds them after opting in', async () => {
  const urls = ['/assets/dynamic/x/portrait.png', '/assets/dynamic/x/anim.skel', '/assets/dynamic/x/page.png'];
  const requests = [];
  const queue = createAssetDownload({ lookupImported: async () => new Set(), retries: 0, fetch: async url => {
    requests.push(url);
    if (url === '/data/assets.json') return Response.json({ images: urls });
    if (url.startsWith('/data/')) return new Response('', { status: 404 });
    return new Response('bytes');
  } });
  await queue.start();
  assert.ok(requests.includes(urls[0]));
  assert.ok(!requests.includes(urls[1]));
  assert.equal(queue.get().done, 1);
  requests.length = 0;
  await queue.start({ dynamic: true });
  assert.ok(requests.includes(urls[1]) && requests.includes(urls[2]));
  assert.equal(queue.get().done, 3);
  requests.length = 0;
  await queue.start({ dynamic: false });
  assert.equal(queue.get().done, 1);
  assert.ok(!requests.includes(urls[1]));
});

test('switching a paused compatibility queue resumes with the newly selected scope', async () => {
  let started;
  const inFile = new Promise(resolve => { started = resolve; });
  const calls = [];
  const queue = createAssetDownload({ retries: 0, lookupImported: async () => new Set(), fetch: async (url, options) => {
    if (url === '/data/assets.json') return Response.json({ files: ['/assets/static.png', '/assets/dynamic/x/anim.skel'] });
    if (url.startsWith('/data/')) return new Response('', { status: 404 });
    calls.push(url);
    if (calls.length === 1) {
      started();
      await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    }
    return new Response('bytes');
  } });
  const first = queue.start();
  await inFile;
  queue.pause();
  const resumed = queue.start({ dynamic: true });
  await Promise.all([first, resumed]);
  assert.equal(queue.get().phase, 'complete');
  assert.equal(queue.get().done, 2);
  assert.ok(calls.includes('/assets/dynamic/x/anim.skel'));
});

test('missing animation prunes only the dynamic record and preserves skin static artwork', async () => {
  const dynamic = { skel: '/assets/dynamic/x/anim.skel', textures: ['/assets/dynamic/x/page.png'] };
  const doc = { chars: { x: { dynamicE2: dynamic, skins: { y: { portrait: '/assets/dynamic/x/portrait.png', dynamic } } } } };
  const missing = await pruneMissingDynamicArt(doc, rel => !rel.endsWith('page.png'));
  assert.equal(missing.chars.x.dynamicE2, undefined);
  assert.equal(missing.chars.x.skins.y.dynamic, undefined);
  assert.equal(missing.chars.x.skins.y.portrait, doc.chars.x.skins.y.portrait);
  assert.ok(doc.chars.x.dynamicE2, 'source manifest is unchanged');
  assert.deepEqual(await pruneMissingDynamicArt(doc, () => true), doc);
});

test('optional art validation cannot exempt static files or arbitrary optional groups', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-optional-verify-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'data'));
  const body = JSON.stringify({ dynamic: '/assets/dynamic/x/anim.skel' });
  fs.writeFileSync(path.join(root, 'data/assets.json'), body);
  const files = { 'data/assets.json': { size: Buffer.byteLength(body), sha256: sha(body) } };
  const write = optionalDynamic => fs.writeFileSync(path.join(root, 'RELEASE-ART.json'), JSON.stringify({ format: 1, app: '0.3.3', files, optionalDynamic }));
  write(false);
  assert.throws(() => verifyStagedArt(root, root, readStagedArt(root, '0.3.3')), /素材缺失/);
  write(true);
  verifyStagedArt(root, root, readStagedArt(root, '0.3.3'));
  const tag = 'v0.3.3-extended.999';
  const index = { format: 1, app: '0.3.3', tag, groups: { dynamic: `Stronghold-Protocol-${tag}-dynamic-art.zip` },
    files: { ...files, 'public/assets/static.png': { size: 1, sha256: 'a'.repeat(64), group: 'dynamic' } } };
  index.files['data/assets.json'].group = 'dynamic';
  assert.throws(() => parseSplitIndex(JSON.stringify(index), tag), /必备素材/);
});
