import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { buildResourceManifest } from '../../server/http/resourceManifest.js';
import { ResourceStore } from '../../public/js/resources/store.js';
import { handleResourceRequest } from '../../public/js/resources/service.js';
import { resourceGroup, isResourcePath, validateManifest } from '../../public/js/resources/common.js';
import { preloadPlan } from '../../public/js/ui/preload.js';
import { exportResourceZip, importResourceZip } from '../../public/js/resources/archive.js';
import { ZipReader, BlobReader, BlobWriter, ZipWriter } from '../../public/js/resources/zip.js';
import { resourceCaches } from '../helpers/resourceCache.js';

const origin = 'https://game.test';
const bytes = Buffer.from('image bytes'), sha = (algorithm, n) => createHash(algorithm).update(bytes).digest('hex').slice(0,n);
const file = { url: '/assets/char/skin_avatar/outfit.png', hash: sha('sha1',12), assetHash: sha('sha256',16), size: bytes.length, tier: 1 };
const manifest = { format: 1, version: 'fixture', files: [file] };
const makeStore = (caches, fetcher = async () => new Response(bytes, { headers: { 'Content-Type': 'image/png' } })) => new ResourceStore(manifest, { origin, caches, fetcher });

test('five-version resource inventories can exceed 50,000 files while retaining a bounded manifest', () => {
  const expanded = { ...manifest, files: Array(50001).fill(file) };
  assert.equal(validateManifest(expanded), expanded);
  assert.throws(() => validateManifest({ ...manifest, files: Array(100001).fill(file) }), /资源清单过大/);
});

test('resource inventory includes all installed visuals, outfits, fonts and community GIFs; audio stays optional', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sp-resource-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['assets/char/skin_avatar/skin.png', 'assets/spine/op/char/outfit/front/model.skel', 'assets/local/emoticon/custom/image.gif', 'assets/local/scene/test/scene.json', 'assets/audio/voice/cn/a.mp3', 'fonts/main.woff2']) {
    await mkdir(path.dirname(path.join(root,name)), { recursive: true }); await writeFile(path.join(root,name), name);
  }
  const m = await buildResourceManifest({ publicDir: root });
  assert.equal(m.count, 6); assert.equal(m.tier1, 5);
  assert.equal(m.files.find(f => f.url.includes('voice')).tier, 2);
  assert.equal(resourceGroup(m.files.find(f => f.url.includes('skin_avatar'))), 'skins');
  assert.deepEqual(m, await buildResourceManifest({ publicDir: root }), 'stable content/version');
  const assets = JSON.parse(await readFile(new URL('../../data/assets.json', import.meta.url)));
  let local = null; try { local = JSON.parse(await readFile(new URL('../../data/local-assets.json', import.meta.url))); } catch { /* optional */ }
  const installed = await buildResourceManifest({ publicDir: new URL('../../public/', import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1') });
  const indexed = new Set(installed.files.filter(f => f.tier === 1).map(f => decodeURI(f.url)));
  const missing = [];
  for (const url of preloadPlan(assets,local,'visual')) {
    if (url.startsWith('/vendor/')) continue; // These keep normal HTTP warming and bypass the asset worker.
    try { await readFile(new URL('../../public' + url, import.meta.url)); } catch { continue; }
    if (!indexed.has(decodeURI(url))) missing.push(url);
  }
  assert.deepEqual(missing, [], 'no installed visual from the old plan is dropped');
});

test('cache downloads verify bytes, retry only failures, and serve offline hashed URLs plus ranges', async () => {
  const caches = resourceCaches(); let requests = 0;
  const store = makeStore(caches, async () => { requests++; return new Response(bytes); });
  await store.download(); assert.equal(requests,1); assert.equal((await store.status()).count,1);
  await store.download(); assert.equal(requests,1);
  const url = `${origin}/assets/~${file.assetHash}/char/skin_avatar/outfit.png`;
  const hit = await handleResourceRequest(new Request(url, { headers: { Range: 'bytes=1-4' } }), { caches });
  assert.equal(hit.status,206); assert.equal(await hit.text(),bytes.subarray(1,5).toString());
  assert.equal(await handleResourceRequest(new Request(url.replace(file.assetHash,'0'.repeat(16))),{caches}),null,'a different content hash never gets stale bytes');
  for (const pathname of ['/js/main.js','/shared/protocol.js','/api/rooms','/ws','/vendor/pixi.min.js']) assert.equal(isResourcePath(pathname),false);
  const broken = makeStore(resourceCaches(), async () => new Response('wrong'));
  assert.equal((await broken.download()).failed,1);
  assert.equal((await broken.status()).count,0,'a failed second hash check cannot mark a file cached');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(makeStore(resourceCaches()).download({signal:controller.signal}),e=>e.name==='AbortError');
});

test('ZIP export/import round-trips checked bytes; corruption and invalid local headers are refused', async () => {
  const store = makeStore(resourceCaches()); await store.download();
  const archive = await exportResourceZip(store);
  const imported = makeStore(resourceCaches()); await importResourceZip(imported,archive.blob);
  assert.equal((await imported.status()).count,1);
  const bad = new Uint8Array(await archive.blob.arrayBuffer()); bad[0] = 0;
  await assert.rejects(importResourceZip(makeStore(resourceCaches()),new Blob([bad])));
  const writer = new ZipWriter(new BlobWriter()); await writer.add('a',new BlobReader(new Blob(['test'])));
  const zip = new Uint8Array(await (await writer.close()).arrayBuffer());
  // Convert a known stored entry into DEFLATE with a matching central directory to exercise the native path.
  const payload = deflateRawSync(Buffer.from('test')), extra = payload.length - 4;
  const compressed = new Uint8Array(zip.length + extra); compressed.set(zip.subarray(0,31)); compressed.set(payload,31); compressed.set(zip.subarray(35),31+payload.length);
  const d = new DataView(compressed.buffer), central = 31+payload.length, end = compressed.length-22;
  d.setUint16(8,8,true); d.setUint32(18,payload.length,true); d.setUint16(central+10,8,true); d.setUint32(central+20,payload.length,true); d.setUint32(end+16,central,true);
  const reader = new ZipReader(new BlobReader(new Blob([compressed]))); let body='';
  for await (const entry of reader.getEntriesGenerator()) await entry.getData(new WritableStream({write(chunk){body+=new TextDecoder().decode(chunk);}}));
  assert.equal(body,'test');
});
