import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateResourcePacks, RESOURCE_PACK_MAX_BYTES, resourcePackPercent } from '../../public/js/resources/common.js';
import { readTransportPack } from '../../public/js/resources/archive.js';
import { Sha1Stream } from '../../public/js/resources/sha1Stream.js';
import { CACHE_NAME, MANIFEST_URL } from '../../public/js/resources/common.js';
import { fetchTransportPack } from '../../public/js/resources/transport.js';

test('resource pack index validation accepts only 16 MB same-origin ZIP metadata', () => {
  const good = { format: 'stronghold-resource-pack-index', version: 1, maxBytes: RESOURCE_PACK_MAX_BYTES,
    packs: [{ id: 'ui-01', url: '/resource-packs/ui-01.zip', size: 100, sha1: 'a'.repeat(40), tier: 1,
      files: [{ url: '/assets/ui/a.webp', size: 4, hash: '0123456789ab' }] }] };
  assert.equal(validateResourcePacks(good).length, 1);
  // The server embeds the index's pack entries as `manifest.packs`, without the
  // standalone index envelope. This is the shape consumed by resourceContext().
  assert.equal(validateResourcePacks(good.packs).length, 1);
  assert.equal(validateResourcePacks({
    ...good, packs: [{ ...good.packs[0], url: 'https://cdn.example/resource-packs/ui-01-0123456789ab.zip' }],
  }).length, 1);
  assert.equal(validateResourcePacks({
    ...good, packs: [{ ...good.packs[0], sha1: 'bad' }],
  }).length, 0);
  assert.equal(validateResourcePacks({ ...good, maxBytes: 16000001 }).length, 0);
  assert.equal(validateResourcePacks({ ...good, packs: [{ ...good.packs[0], url: 'https://evil/x.zip' }] }).length, 0);
  assert.equal(validateResourcePacks({ ...good, packs: [{ ...good.packs[0], size: RESOURCE_PACK_MAX_BYTES + 1 }] }).length, 0);
});

test('incremental package SHA-1 handles split input and standard vectors', async () => {
  const hash = new Sha1Stream();
  hash.update(new TextEncoder().encode('123'));
  hash.update(new TextEncoder().encode('456789'));
  assert.equal(hash.digest(), 'f7c3bc1d808e04732adf679965ccc34ca7ae3441');
});

test('transport pack progress covers both streamed download bytes and import files', () => {
  assert.equal(resourcePackPercent({ phase: 'download', loaded: 25, totalBytes: 100 }), 25);
  assert.equal(resourcePackPercent({ phase: 'import', done: 3, totalFiles: 6 }), 50);
  assert.equal(resourcePackPercent({ phase: 'download', loaded: 120, totalBytes: 100 }), 100);
  assert.equal(resourcePackPercent({ downloadedBytes: 75, totalBytes: 100 }), 75);
  assert.equal(resourcePackPercent({ phase: 'import', done: 0, totalFiles: 0 }), 0);
});

test('Python packs are byte-stable across clocks, global versions, input ordering and unrelated content changes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-resource-packs-stable-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'public');
  const manifestPath = path.join(root, 'manifest.json');
  const indexPath = path.join(root, 'index.json');
  const output = path.join(root, 'packs');
  const { createHash } = await import('node:crypto');
  const data = [
    { url: '/assets/ui/a.png', tier: 1, body: 'unchanged UI' },
    { url: '/assets/audio/voice/en/a.mp3', tier: 2, body: 'unchanged voice' },
    { url: '/assets/local/fx/index.json', tier: 2, body: '{"fx":1}' },
  ];
  const build = async (version, clock, reverse = false) => {
    const files = [];
    for (const row of data) {
      const body = Buffer.from(row.body);
      const file = path.join(assets, row.url.slice(1));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      files.push({ url: row.url, tier: row.tier, size: body.length, hash: createHash('sha1').update(body).digest('hex').slice(0, 12) });
    }
    await writeFile(manifestPath, JSON.stringify({ version, files: reverse ? files.reverse() : files }));
    const wrapper = 'import runpy,sys; from unittest.mock import patch; '
      + 'clock=int(sys.argv.pop(1)); script=sys.argv[1]; sys.argv=sys.argv[1:]; '
      + 'p=patch("zipfile.time.localtime",return_value=(2026,10,16,10,0,clock,4,289,-1)); '
      + 'p.start(); runpy.run_path(script,run_name="__main__")';
    const result = spawnSync(process.env.PYTHON || 'python', ['-c', wrapper, String(clock), path.resolve('tools/resource_packs.py'),
      '--manifest', manifestPath, '--assets-root', assets, '--output', output, '--index', indexPath], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    const bytes = new Map();
    for (const pack of index.packs) bytes.set(pack.id, await readFile(path.join(output, path.basename(pack.url))));
    return { index, bytes };
  };
  const first = await build('global-v1', 0);
  const clockOnly = await build('global-v1', 8);
  assert.deepEqual(clockOnly.index, first.index, 'clock changes must not change ZIP names, bytes or hashes');
  const versionOnly = await build('global-v2', 16, true);
  assert.equal(versionOnly.index.resourceVersion, 'global-v2', 'outer index still tracks the current global manifest');
  assert.deepEqual(versionOnly.index.packs, first.index.packs, 'global version and input order do not invalidate unchanged packages');
  for (const pack of first.index.packs) {
    assert.deepEqual(clockOnly.bytes.get(pack.id), first.bytes.get(pack.id));
    assert.deepEqual(versionOnly.bytes.get(pack.id), first.bytes.get(pack.id));
    assert.ok((await readTransportPack(new Response(versionOnly.bytes.get(pack.id)), pack)).length > 0,
      'stable per-package resourceVersion remains compatible with the browser importer');
  }
  data[0].body = 'updated UI';
  const changed = await build('global-v3', 24);
  for (const pack of first.index.packs) {
    const updated = changed.index.packs.find(p => p.id === pack.id);
    if (pack.group === 'ui') {
      assert.notEqual(updated.sha1, pack.sha1);
      assert.notEqual(updated.url, pack.url);
    } else {
      assert.deepEqual(updated, pack, 'unrelated voice and FX packages stay byte-identical');
      assert.deepEqual(changed.bytes.get(pack.id), first.bytes.get(pack.id));
    }
  }
});

test('Python packs separate voices, official FX and terminal metadata without changing required board FX', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-resource-pack-scope-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'public');
  const { createHash } = await import('node:crypto');
  const entries = [
    ['/assets/audio/voice/en/char_test/cn_019.mp3', 2, 'voice_en'],
    ['/assets/audio/voice/kr/char_test/cn_019.mp3', 2, 'voice_kr'],
    ['/assets/local/fx/index.json', 2, 'fx'],
    ['/assets/local/fx/textures.json', 2, 'fx'],
    ['/assets/local/fx/index-regulation-80c05d5a8f0e.json', 2, 'fx'],
    ['/assets/local/fx/textures-regulation-806beefbeaf6.json', 2, 'fx'],
    ['/assets/local/fx/prefabs/probe.json', 2, 'fx'],
    ['/assets/local/fx/mesh/probe.json', 2, 'fx'],
    ['/assets/local/fx/tex/half/probe.webp', 2, 'fx'],
    ['/assets/local/map/fx/materials.json', 1, 'map'],
    ['/assets/terminal-themes/ac_s_closur/manifest.json', 1, 'ui'],
    ['/assets/terminal-themes/ac_s_closur/config/skin_config.json', 1, 'ui'],
    ['/assets/terminal-themes/ac_s_closur/config/effect_preview_config.json', 1, 'ui'],
    ['/assets/terminal-themes/ac_s_closur/spine/mascot.json', 1, 'spine'],
  ];
  const files = [];
  for (const [url, tier] of entries) {
    const file = path.join(assets, url.slice(1));
    const body = Buffer.from('{}');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    files.push({ url, tier, size: body.length, hash: createHash('sha1').update(body).digest('hex').slice(0, 12) });
  }
  const manifestPath = path.join(root, 'manifest.json');
  const indexPath = path.join(root, 'resource-packs.json');
  await writeFile(manifestPath, JSON.stringify({ version: 'scope', files }));
  const result = spawnSync(process.env.PYTHON || 'python', [path.resolve('tools/resource_packs.py'),
    '--manifest', manifestPath, '--assets-root', assets, '--output', path.join(root, 'packs'), '--index', indexPath], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  assert.equal(index.packs.length, 6);
  for (const [url, tier, group] of entries) {
    const pack = index.packs.find(p => p.files.some(f => f.url === url));
    assert.ok(pack, url);
    assert.equal(pack.group, group);
    assert.equal(pack.tier, tier);
  }
});

test('Python pack builder keeps every pack below 16 MB and records verified resource hashes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-resource-packs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'public');
  const data = path.join(root, 'data');
  await mkdir(path.join(assets, 'assets', 'ui'), { recursive: true });
  await mkdir(data, { recursive: true });
  const body = Buffer.alloc(1200, 7);
  await writeFile(path.join(assets, 'assets', 'ui', 'a.png'), body);
  await writeFile(path.join(assets, 'assets', 'ui', 'b.png'), Buffer.alloc(1200, 8));
  const crypto = await import('node:crypto');
  const hash = (bytes) => crypto.createHash('sha1').update(bytes).digest('hex');
  const manifest = { version: 'fixture', files: [
    { url: '/assets/ui/a.png', tier: 1, size: body.length, hash: hash(body).slice(0, 12) },
    { url: '/assets/ui/b.png', tier: 1, size: 1200, hash: hash(Buffer.alloc(1200, 8)).slice(0, 12) },
  ] };
  const manifestPath = path.join(root, 'manifest.json');
  const indexPath = path.join(data, 'resource-packs.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const script = path.resolve('tools/resource_packs.py');
  const result = spawnSync(process.env.PYTHON || 'python', [script, '--manifest', manifestPath,
    '--assets-root', assets, '--output', path.join(root, 'resource-packs'), '--index', indexPath], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  assert.equal(index.maxBytes, RESOURCE_PACK_MAX_BYTES);
  assert.equal(index.packs.length, 1);
  assert.ok(index.packs[0].size <= RESOURCE_PACK_MAX_BYTES);
  assert.match(index.packs[0].sha1, /^[0-9a-f]{40}$/);
  assert.match(index.packs[0].url, /\/resource-packs\/ui-01-[0-9a-f]{12}\.zip$/);
  const zipPath = path.join(root, 'resource-packs', path.basename(index.packs[0].url));
  const zipBytes = await readFile(zipPath);
  const entries = await readTransportPack(new Response(zipBytes), index.packs[0]);
  assert.equal(entries.length, 2);
  assert.equal(new TextDecoder().decode(entries[0].bytes), body.toString());
  assert.equal(new TextDecoder().decode(entries[1].bytes), Buffer.alloc(1200, 8).toString());
  const partial = await readTransportPack(new Response(zipBytes), index.packs[0], {
    selectedPaths: new Set(['/assets/ui/a.png']),
  });
  assert.equal(partial.length, 1);
  assert.equal(partial[0].row.url, '/assets/ui/a.png');
  const corrupted = Buffer.from(zipBytes);
  corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(() => readTransportPack(new Response(corrupted), index.packs[0]), /整包校验失败/);

  await t.test('mirrors retry HTTP, network, stream and digest errors in order before CDN', async () => {
    const pack = { ...index.packs[0], url: 'https://cdn.example/game/resource-packs/ui.zip',
      urls: ['https://one.example/data/renamed.zip', 'https://two.example/data/ui.zip',
        'https://three.example/data/ui.zip', 'https://four.example/data/ui.zip'] };
    const calls = [];
    const payload = await fetchTransportPack(pack, {
      fetcher: async (url) => {
        calls.push(url);
        if (calls.length === 1) return new Response(null, { status: 503 });
        if (calls.length === 2) throw new TypeError('network failed');
        if (calls.length === 3) return new Response(new ReadableStream({ start(c) { c.error(new Error('stream failed')); } }));
        return new Response(calls.length === 4 ? corrupted : zipBytes);
      },
    });
    assert.deepEqual(calls, [...pack.urls, pack.url]);
    assert.equal(payload.length, 2);
    assert.deepEqual(Buffer.from(payload[0].bytes), body);
  });

  await t.test('successful first route skips later routes and keeps selected resource identities', async () => {
    const calls = [];
    const pack = { ...index.packs[0], urls: ['https://mirror.example/data/renamed.zip', 'https://other.example/a.zip'] };
    const payload = await fetchTransportPack(pack, { selectedPaths: new Set(['/assets/ui/b.png']),
      fetcher: async (url) => { calls.push(url); return new Response(zipBytes); } });
    assert.deepEqual(calls, [pack.urls[0]]);
    assert.deepEqual(payload.map(({ row }) => row.url), ['/assets/ui/b.png']);
  });

  await t.test('controller verifies routed ZIPs, imports selected files and uses the unified worker', { timeout: 15000 }, async (t) => {
    const saved = new Map(['fetch', 'caches', 'navigator', 'location', 'isSecureContext']
      .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    });
    const origin = 'https://pack.example';
    const entries = new Map();
    let requests = 0;
    const cache = {
      async match(key) { return entries.get(typeof key === 'string' ? key : key.url)?.clone(); },
      async keys() { return [...entries.keys()].map((url) => new Request(url)); },
      async delete(key) { return entries.delete(typeof key === 'string' ? key : key.url); },
      async put(key, value) {
        entries.set(typeof key === 'string' ? key : key.url, value.clone());
      },
    };
    const mirrorRequests = [];
    const packs = [1, 2, 3].map((n) => ({ ...index.packs[0], id: `ui-${n}`, url: `/resource-packs/ui-${n}.zip`,
      urls: [`https://mirror.example/data/ui-${n}.zip`] }));
    for (const [key, value] of Object.entries({
      isSecureContext: true, location: { origin },
      caches: { open: async () => cache, keys: async () => [CACHE_NAME], delete: async () => true },
      navigator: { serviceWorker: { register: async (url, options) => {
        assert.equal(url, '/sw.js', 'preload and imported assets share the unified classic worker');
        assert.equal(options.scope, '/');
        assert.notEqual(options.type, 'module');
        return {};
      }, getRegistrations: async () => [] } },
      fetch: async (url) => {
        if (url === MANIFEST_URL) return Response.json({ format: 1, version: 'packs', files: manifest.files, packs });
        if (url.startsWith('https://mirror.example/')) {
          mirrorRequests.push(url);
          return new Response(null, { status: 503 });
        }
        assert.match(url, /^\/resource-packs\//, 'no per-file fallback on a valid transport pack');
        requests++;
        return new Response(zipBytes);
      },
    })) Object.defineProperty(globalThis, key, { configurable: true, value });
    const controller = await import('../../public/js/resources/index.js?pack-pipeline-regression');
    const progress = [];
    const unsubscribe = controller.subscribeResources((s) => {
      if (s.packProgress) progress.push(s.packProgress);
    });
    try {
      await controller.syncResources(true, false);
      assert.equal(requests, 3);
      assert.equal(mirrorRequests.length, 3);
      assert.equal(controller.resourceState().selectionComplete, true);
      assert.deepEqual([...new Set(progress.map(p => p.phase))], ['download', 'verify', 'import']);
      assert.ok(progress.some(p => p.phase === 'import' && p.done === p.totalFiles && p.totalFiles > 0));
      assert.equal(controller.resourceState().packProgress, null);
      assert.ok(await cache.match(`${origin}/assets/ui/a.png`));
      assert.ok(await cache.match(`${origin}/assets/ui/b.png`));
    } finally {
      unsubscribe();
      await controller.syncResources(false);
    }
  });
});

test('Python pack builder decodes canonical bracket URLs when reading local files', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-resource-packs-brackets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'public');
  const data = path.join(root, 'data');
  await mkdir(path.join(assets, 'assets', 'local', 'map', 'fx'), { recursive: true });
  await mkdir(data, { recursive: true });
  const body = Buffer.from('bracket texture');
  await writeFile(path.join(assets, 'assets', 'local', 'map', 'fx', '[opt]x.webp'), body);
  const crypto = await import('node:crypto');
  const full = crypto.createHash('sha1').update(body).digest('hex');
  const manifestPath = path.join(root, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ version: 'fixture', files: [{
    url: '/assets/local/map/fx/%5Bopt%5Dx.webp', tier: 1, size: body.length, hash: full.slice(0, 12),
  }] }));
  const result = spawnSync(process.env.PYTHON || 'python', [path.resolve('tools/resource_packs.py'),
    '--manifest', manifestPath, '--assets-root', assets, '--output', path.join(root, 'packs'),
    '--index', path.join(data, 'resource-packs.json')], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(await readFile(path.join(data, 'resource-packs.json'), 'utf8'));
  assert.equal(index.packs[0].files[0].url, '/assets/local/map/fx/%5Bopt%5Dx.webp');
});

 test('Python ZIP builder and browser importer accept only the official effect JSON paths', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-fx-pack-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const body = Buffer.from('{"fx":1}'), { createHash } = await import('node:crypto');
  const hash = createHash('sha1').update(body).digest('hex').slice(0,12);
  const urls = ['index.json', 'textures.json', 'index-regulation-80c05d5a8f0e.json',
    'textures-regulation-806beefbeaf6.json', 'prefabs/skill_probe.json', 'mesh/probe.json'].map(p => '/assets/local/fx/'+p);
  for (const url of urls) { const dest = path.join(root, 'public', url); await mkdir(path.dirname(dest), { recursive:true }); await writeFile(dest, body); }
  const manifestPath = path.join(root,'manifest.json'), indexPath = path.join(root,'resource-packs.json');
  const run = () => spawnSync(process.env.PYTHON || 'python', [path.resolve('tools/resource_packs.py'), '--manifest', manifestPath,
    '--assets-root', path.join(root,'public'), '--output', path.join(root,'packs'), '--index', indexPath], {encoding:'utf8', windowsHide: true});
  await writeFile(manifestPath, JSON.stringify({version:'fixture',files:urls.map(url => ({url,tier:2,size:body.length,hash}))}));
  const result = run(); assert.equal(result.status,0,result.stderr);
  const doc = JSON.parse(await readFile(indexPath,'utf8'));
  assert.equal(validateResourcePacks(doc).length,doc.packs.length);
  assert.ok(doc.packs.every(pack => pack.tier === 2 && pack.group === 'fx'));
  const seen = [];
  for (const pack of doc.packs) {
    const entries = await readTransportPack(new Response(await readFile(path.join(root,'packs',path.basename(pack.url)))),pack);
    seen.push(...entries.map(e => e.row.url));
  }
  assert.deepEqual(seen.sort(), urls.sort());
  await writeFile(manifestPath, JSON.stringify({version:'fixture',files:[{url:'/assets/local/fx/private.json',tier:1,size:body.length,hash}]}));
  assert.notEqual(run().status,0);
});
