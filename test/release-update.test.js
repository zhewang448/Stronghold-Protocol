import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { RELEASE_TAG } from '../server/release-version.js';
import { healthServerSource } from './helpers/release-fixture.js';
import { sign as signReleaseDirectory, assertReleaseRevision } from '../tools/release-sign.mjs';
import { APP_VERSION } from '../shared/constants.js';
import { createReleaseUpdater, compareReleaseTags, installedTag, installedIdentity, normalizeUpdateNetwork, createUpdateRequest, pickReleaseAsset, pickReleaseUpdateAsset, downloadAndStage, stageZip, stageUpdateZip, scheduleInstall, updatePaths } from '../server/release-update.js';
import { freePort } from './e2e/client.mjs';
import { applyReleaseStage } from '../server/release-install.js';
import { archive, storedZip, releaseFor, files, manifest, put, read, tag, sha, signRelease, tick, until } from './helpers/release-fixture.js';
const temp = (t) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-release-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); put(root, 'package.json', JSON.stringify({ version: APP_VERSION })); return root; };
const fetchRelease = async () => new Response(JSON.stringify([releaseFor()]));

test('signing refuses dirty worktrees, changed tags, and changed artifacts under a signed release tag', async (t) => {
  const expected = 'v0.3.1-extended.7', root = 'unused';
  assert.throws(() => assertReleaseRevision('v0.3.1-extended.6', { expected, root, run: () => assert.fail('wrong tag stops first') }), /递增/);
  assert.throws(() => assertReleaseRevision(expected, { expected, root, run: (_bin, args) => args[0] === 'status'
    ? { status: 0, stdout: ' M server/file.js\n' } : { status: 1, stdout: '' } }), /干净工作区/);
  assert.throws(() => assertReleaseRevision(expected, { expected, root, run: (_bin, args) => args[0] === 'status'
    ? { status: 0, stdout: '' } : args[2]?.includes('refs/tags/') ? { status: 0, stdout: 'old-commit\n' } : { status: 0, stdout: 'new-commit\n' } }), /不能覆盖同版/);
  assert.doesNotThrow(() => assertReleaseRevision(expected, { expected, root, run: (_bin, args) => args[0] === 'status'
    ? { status: 0, stdout: '' } : { status: 1, stdout: '' } }));
  const dir = temp(t), key = path.join(dir, 'key.pem'), zip = path.join(dir, `Stronghold-Protocol-${tag}-assets.zip`);
  const pair = crypto.generateKeyPairSync('ed25519'), keys = [pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')];
  fs.writeFileSync(key, pair.privateKey.export({ format: 'pem', type: 'pkcs8' })); fs.writeFileSync(zip, 'first');
  await signReleaseDirectory(tag, dir, { file: key, keys });
  const signed = read(dir, 'SHA256SUMS.txt'); await signReleaseDirectory(tag, dir, { file: key, keys }); assert.equal(read(dir, 'SHA256SUMS.txt'), signed);
  fs.writeFileSync(zip, 'second');
  await assert.rejects(signReleaseDirectory(tag, dir, { file: key, keys }), /immutable/);
});

test('first console open checks once per server launch, concurrent check shares request and only first opener is notified', async (t) => {
  const root = temp(t); let calls = 0, finish;
  const updater = createReleaseUpdater({ root, fetchImpl: async () => {
    calls++; await new Promise((r) => { finish = r; }); return fetchRelease();
  } });
  const first = updater.open(), manual = updater.check();
  assert.equal((await updater.open()).state, 'checking');
  assert.equal((await updater.open()).notify, undefined);
  assert.equal(calls, 1);
  finish();
  assert.equal((await first).notify, true);
  assert.equal((await manual).state, 'available');
  assert.equal((await updater.open()).notify, undefined);
  assert.equal(calls, 1);
  const again = createReleaseUpdater({ root, fetchImpl: fetchRelease });
  assert.equal((await again.open()).notify, true, 'new server lifetime checks again');
  const offline = createReleaseUpdater({ root, fetchImpl: async () => { throw new Error('offline'); }, log: { warn() {} } });
  assert.equal((await offline.open()).notify, false);
  assert.equal((await offline.open()).notify, undefined, 'failed auto check still consumed; manual retry is available');
});

test('Release list: numeric ordering, version relations, missing assets, explicit downgrade confirmation and pagination', async (t) => {
  const root = temp(t), current = RELEASE_TAG, older = 'v0.2.5', base = `v${APP_VERSION}`;
  const list = [releaseFor(undefined, older), releaseFor(), releaseFor(undefined, current),
    { tag_name: `${base}-extended.10`, assets: [] }, { tag_name: `${base}-extended.11`, prerelease: true }, { tag_name: 'other' }];
  let installed;
  const updater = createReleaseUpdater({ root, fetchImpl: async () => new Response(JSON.stringify(list)), onReady() {},
    stageRelease: async ({ release }) => { installed = release.tag_name; throw new Error('stop before restart'); }, log: { warn() {} } });
  const d = await updater.check();
  assert.deepEqual(d.versions.map((r) => [r.tag, r.relation]), [
    [`${base}-extended.10`, 'new'], [tag, 'new'], [current, 'current'], [older, 'old'],
  ]);
  assert.equal(d.versions[0].installable, false);
  assert.match(d.versions[0].reason, /完整素材包/);
  assert.equal(updater.install({ tag: older }).code, 'DOWNGRADE_CONFIRM');
  assert.equal(installed, undefined);
  assert.equal(updater.install({ tag: older, allowDowngrade: true }).state, 'downloading');
  await until(() => updater.status().state === 'error');
  assert.equal(installed, older);
  assert.match(updater.install({ tag: 'unknown' }).error, /列表/);
  const pages = [];
  const paged = createReleaseUpdater({ root, fetchImpl: async (url) => {
    const page = Number(new URL(url).searchParams.get('page')); pages.push(page);
    return new Response(JSON.stringify(page === 1 ? Array.from({ length: 30 }, (_, i) => releaseFor(undefined, `${base}-extended.${i + 2}`)) : [releaseFor(undefined, older)]));
  } });
  assert.equal((await paged.check()).hasMore, true);
  const second = await paged.check(true);
  assert.equal(second.hasMore, false);
  assert.ok(second.versions.some((r) => r.tag === older));
  assert.equal(second.versions[0].tag, `${base}-extended.31`);
  await paged.check(true); assert.deepEqual(pages, [1, 2]);
});

test('downgraded version marker matches installed code; a manual replacement invalidates the old marker', (t) => {
  const root = temp(t);
  put(root, 'package.json', '{"version":"0.2.5"}');
  put(root, 'server/release-version.js', "export const RELEASE_TAG = 'v0.2.5';");
  put(root, 'logs/release-version.json', JSON.stringify({ app: '0.2.5', tag: 'v0.2.5', sourceHash: installedIdentity(root) }));
  assert.equal(installedTag(root), 'v0.2.5');
  put(root, 'server/release-version.js', `export const RELEASE_TAG = '${RELEASE_TAG}';`);
  assert.equal(installedTag(root), RELEASE_TAG);
});

test('network settings validate, persist, disable fallback with empty mirror, reject changes while busy', async (t) => {
  const root = temp(t), updater = createReleaseUpdater({ root, fetchImpl: fetchRelease });
  assert.equal(updater.configure({ proxy: 'http://127.0.0.1:7890', mirror: '' }).saved, true);
  const again = createReleaseUpdater({ root });
  assert.deepEqual(again.status().network, { proxy: 'http://127.0.0.1:7890/', mirror: '' });
  for (const proxy of ['bad', 'socks5://localhost:7890', 'http://user:pass@localhost:7890', 'https://localhost/path', 'http://localhost/?a=b']) assert.ok(updater.configure({ proxy }).error);
  for (const mirror of ['http://mirror.test', 'https://mirror.test/?q=secret', 'https://user:pass@mirror.test']) assert.ok(updater.configure({ mirror }).error);
  assert.equal(normalizeUpdateNetwork({ mirror: 'https://mirror.test' }).mirror, 'https://mirror.test/');
  let finish;
  const busy = createReleaseUpdater({ root, fetchImpl: () => new Promise((r) => { finish = r; }) });
  const check = busy.check();
  assert.match(busy.configure({}).error, /进行中/);
  finish(new Response('[]')); await check;
});

test('bad API JSON/HTTP/proxy falls back to mirror; direct success never visits mirror', async (t) => {
  const root = temp(t), calls = [];
  const updater = createReleaseUpdater({ root, fetchImpl: async (url) => {
    calls.push(url); return url.startsWith('https://gh-proxy.com/') ? fetchRelease() : new Response('<html>blocked</html>');
  } });
  const d = await updater.check();
  assert.equal(d.state, 'available'); assert.equal(d.source, 'mirror');
  assert.equal(calls[1], `https://gh-proxy.com/${calls[0]}`);
  calls.length = 0;
  const direct = createReleaseUpdater({ root, fetchImpl: async (url) => { calls.push(url); return fetchRelease(); } });
  assert.equal((await direct.check()).source, 'direct'); assert.equal(calls.length, 1);
  const routed = [];
  const request = createUpdateRequest({ proxy: 'http://127.0.0.1:7890/', mirror: 'https://mirror.test/' }, { fetchImpl: async (url, options) => {
    routed.push([url, !!options.dispatcher]);
    return new Response('ok', { status: options.dispatcher ? 502 : 200 });
  } });
  assert.equal(await request('https://github.com/test', (r) => r.text()), 'ok');
  assert.deepEqual(routed, [['https://github.com/test', true], ['https://mirror.test/https://github.com/test', false]]);
});

test('download retries failed checksum and interrupted body through mirror, checksum text is also validated before fallback', async (t) => {
  const root = temp(t), zip = archive(), release = releaseFor(zip);
  const { sums, sig, keys } = signRelease(release, zip);
  for (const mode of ['checksum', 'interrupted']) {
    const calls = [];
    const request = createUpdateRequest({ mirror: 'https://mirror.test/' }, { fetchImpl: async (url) => {
      calls.push(url);
      const mirror = url.startsWith('https://mirror.test/');
      if (url.endsWith('.sig')) return new Response(sig);
      if (url.endsWith('.txt')) return new Response(mirror ? sums : '<html>unavailable</html>');
      if (mirror) return new Response(zip);
      if (mode === 'checksum') return new Response(Buffer.alloc(zip.length));
      return new Response(new ReadableStream({ start(c) { c.enqueue(zip.subarray(0, 80)); c.error(new Error('connection reset')); } }));
    } });
    const staged = await downloadAndStage({ root, release, request, keys, listing: 'mirror' });
    assert.equal(read(staged.stage, 'server/index.js'), '// new server');
    assert.equal(calls.length, 5, mode);
  }
  const invalid = createUpdateRequest({ mirror: 'https://mirror.test/' }, { fetchImpl: async () => new Response('<html>no zip</html>') });
  await assert.rejects(downloadAndStage({ root, release: releaseFor(zip), request: invalid }), /均失败/);
  assert.equal(fs.readdirSync(path.join(root, 'logs/update-staging')).length, 2, 'failed work directory cleaned');
});

test('runtime HTTP proxy uses a real CONNECT tunnel on Node 22 without changing startup environment', { timeout: 10000 }, async (t) => {
  const sockets = new Set(), hits = [];
  const target = http.createServer((req, res) => { hits.push(req.url); res.end('proxied'); });
  const proxy = http.createServer((_req, res) => res.writeHead(500).end());
  proxy.on('connect', (req, client, head) => {
    hits.push(`CONNECT ${req.url}`);
    const url = new URL(`http://${req.url}`);
    const upstream = net.connect(Number(url.port), url.hostname, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
  });
  for (const server of [target, proxy]) server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(() => { for (const socket of sockets) socket.destroy(); target.close(); proxy.close(); });
  const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  const targetPort = await listen(target), proxyPort = await listen(proxy);
  const request = createUpdateRequest({ proxy: `http://127.0.0.1:${proxyPort}`, mirror: '' });
  assert.equal(await request(`http://127.0.0.1:${targetPort}/release`, (r) => r.text(), 3000), 'proxied');
  assert.deepEqual(hits, [`CONNECT 127.0.0.1:${targetPort}`, '/release']);
});

test('release identity: extension revisions sort numerically, app version stays separate, rejects reinstall', async (t) => {
  const root = temp(t);
  assert.equal(compareReleaseTags('v0.2.5-extended.10', 'v0.2.5-extended.2'), 1);
  assert.equal(compareReleaseTags('v0.2.6-extended.1', 'v0.2.5-extended.10'), 1);
  assert.equal(compareReleaseTags(tag, tag), 0);
  assert.throws(() => compareReleaseTags('latest', tag));
  put(root, 'logs/release-version.json', JSON.stringify({ app: APP_VERSION, tag }));
  assert.equal(installedTag(root), tag);
  const updater = createReleaseUpdater({ root, fetchImpl: fetchRelease, onReady() {} });
  assert.equal((await updater.check()).state, 'up-to-date');
  assert.match(updater.install({ tag }).error, /当前版本/);
  assert.equal(pickReleaseAsset({ assets: [{ name: 'source.zip' }] }), undefined);
});

test('download verifies ZIP checksum and program manifest, stages art and retains new MANIFEST', async (t) => {
  const root = temp(t), zip = archive([['Stronghold-Protocol/public/assets/local/x.png', 'art']]);
  const release = releaseFor(zip);
  const states = [];
  const staged = await downloadAndStage({ root, release, fetchImpl: async () => new Response(zip), progress: (p) => states.push(p.state) });
  assert.equal(read(staged.stage, 'server/index.js'), files['server/index.js']);
  assert.equal(read(staged.stage, 'MANIFEST.json'), manifest(files));
  assert.equal(read(staged.stage, 'public/assets/local/x.png'), 'art');
  assert.equal(read(staged.stage, 'data/assets.json'), '{}');
  assert.ok(states.includes('downloading') && states.includes('verifying'));
  const sums = `${sha(zip)}  ${release.assets[0].name}\n`;
  release.assets.push({ name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/zhewang448/Stronghold-Protocol/releases/download/test/SHA256SUMS.txt' });
  await downloadAndStage({ root, release, fetchImpl: async (url) => new Response(url.endsWith('.txt') ? sums : zip) });
  await assert.rejects(downloadAndStage({ root, release: releaseFor(zip), fetchImpl: async () => new Response(Buffer.alloc(zip.length)) }), /SHA-256/);
  await assert.rejects(downloadAndStage({ root, release: { ...releaseFor(zip), assets: [{ ...releaseFor(zip).assets[0], browser_download_url: 'https://example.com/x.zip' }] } }), /不属于/);
  const zipFile = path.join(root, 'test.zip');
  for (const [extra, pattern] of [
    [[['Stronghold-Protocol/../outside.js', 'bad']], /非法路径/],
    [[['Stronghold-Protocol/server/extra.js', 'bad']], /不在程序清单/],
    [[['Stronghold-Protocol/UPDATE.json', '{}']], /增量/],
    [[['Stronghold-Protocol/server/INDEX.js', 'bad']], /重复/],
  ]) {
    fs.writeFileSync(zipFile, archive(extra));
    assert.throws(() => stageZip(zipFile, path.join(root, `stage-${Math.random()}`), tag), pattern);
  }
  const broken = archive().toString('binary').replace('// new server', '// bad server');
  fs.writeFileSync(zipFile, Buffer.from(broken, 'binary'));
  assert.throws(() => stageZip(zipFile, path.join(root, 'broken'), tag), /校验失败|CRC/);
});

test('signed update prefers an applicable delta, stages unchanged files locally, then falls back to full on a bad delta', async (t) => {
  const root = temp(t), next = tag, baseFiles = { 'package.json': JSON.stringify({ version: APP_VERSION, type: 'module' }),
    'server/index.js': '// old server', 'server/keep.js': '// stable' };
  for (const [rel, body] of Object.entries(baseFiles)) put(root, rel, body);
  put(root, 'MANIFEST.json', manifest(baseFiles)); put(root, 'data/assets.json', '{}');
  const targetFiles = { ...baseFiles, 'server/index.js': '// new server' };
  const changed = { 'server/index.js': targetFiles['server/index.js'] };
  const update = JSON.stringify({ format: 1, app: APP_VERSION, from: [APP_VERSION], count: 1,
    tag: next, fromTags: [RELEASE_TAG], art: { 'data/assets.json': { size: 2, sha256: sha('{}') } },
    bytes: Buffer.byteLength(changed['server/index.js']), removed: [],
    files: Object.fromEntries(Object.entries(changed).map(([rel, body]) => [rel, { size: Buffer.byteLength(body), sha256: sha(body) }])) });
  const delta = storedZip([['Stronghold-Protocol/MANIFEST.json', manifest(targetFiles)],
    ['Stronghold-Protocol/UPDATE.json', update], ['Stronghold-Protocol/server/index.js', changed['server/index.js']]]);
  const full = storedZip([...Object.entries({ ...targetFiles, 'MANIFEST.json': manifest(targetFiles), 'data/assets.json': '{}' })
    .map(([rel, body]) => [`Stronghold-Protocol/${rel}`, body])]);
  const release = releaseFor(full, next), deltaName = `Stronghold-Protocol-${next}-update.zip`;
  release.assets.unshift({ name: deltaName, size: delta.length, digest: `sha256:${sha(delta)}`,
    browser_download_url: `https://github.com/zhewang448/Stronghold-Protocol/releases/download/${next}/${deltaName}` });
  const key = crypto.generateKeyPairSync('ed25519');
  const sums = `${sha(delta)}  ${deltaName}\n${sha(full)}  ${release.assets[1].name}\n`;
  const signed = crypto.sign(null, Buffer.concat([Buffer.from(`stronghold-protocol-release\n${next}\n`), Buffer.from(sums)]), key.privateKey).toString('base64');
  release.assets.push({ name: 'SHA256SUMS.txt', browser_download_url: `https://github.com/zhewang448/Stronghold-Protocol/releases/download/${next}/SHA256SUMS.txt` },
    { name: 'SHA256SUMS.txt.sig', browser_download_url: `https://github.com/zhewang448/Stronghold-Protocol/releases/download/${next}/SHA256SUMS.txt.sig` });
  const calls = [];
  const deltaPath = path.join(root, 'delta.zip'); fs.writeFileSync(deltaPath, delta);
  stageUpdateZip(deltaPath, path.join(root, 'direct-stage'), next, root);
  const request = async (url, consume) => {
    calls.push(url);
    if (url.endsWith('.sig')) return consume(new Response(signed));
    if (url.endsWith('.txt')) return consume(new Response(sums));
    return consume(new Response(url.endsWith(deltaName) ? delta : full));
  };
  assert.equal(pickReleaseUpdateAsset(release).name, deltaName);
  const staged = await downloadAndStage({ root, release, request, keys: [key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')] });
  assert.equal(staged.asset, deltaName);
  assert.equal(read(staged.stage, 'server/index.js'), '// new server');
  assert.equal(read(staged.stage, 'server/keep.js'), '// stable');
  assert.ok(calls.some((url) => url.endsWith(deltaName)));
  assert.ok(!calls.some((url) => url.endsWith(release.assets[1].name)));
  assert.equal(read(root, 'server/index.js'), '// old server', 'staging does not mutate the running install');
  put(root, 'server/keep.js', '// locally changed');
  calls.length = 0;
  const fallback = await downloadAndStage({ root, release, request, keys: [key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')] });
  assert.equal(fallback.asset, release.assets[1].name);
  assert.equal(read(fallback.stage, 'server/keep.js'), '// stable');
  assert.ok(calls.some((url) => url.endsWith(deltaName)) && calls.some((url) => url.endsWith(release.assets[1].name)));
});

test('updater protects active matches before and after download, starts one job, catches network failure', async (t) => {
  const root = temp(t); let active = true, starts = 0, scheduled = 0, resolveStage;
  const updater = createReleaseUpdater({ root, onReady() {}, fetchImpl: fetchRelease, hasActive: () => active,
    stageRelease: async () => { starts++; return new Promise((r) => { resolveStage = r; }); }, schedule: async () => { scheduled++; } });
  assert.match(updater.install({ tag }).error, /先检查/);
  await updater.check();
  assert.equal(updater.install({ tag }).state, 'active-matches'); assert.equal(starts, 0);
  active = false;
  assert.equal(updater.install({ tag }).state, 'downloading');
  updater.install({ tag, force: true }); await updater.check(); assert.equal(starts, 1);
  active = true; resolveStage({ stage: path.join(root, 'stage'), tag });
  await until(() => updater.status().state === 'active-matches'); assert.equal(scheduled, 0);
  updater.install({ tag, force: true }); await until(() => updater.status().state === 'scheduled'); assert.equal(scheduled, 1);
  const bad = createReleaseUpdater({ root, fetchImpl: async () => new Response('', { status: 403 }), log: { warn() {} } });
  assert.match((await bad.check()).error, /403/);
  const fails = createReleaseUpdater({ root, onReady() {}, fetchImpl: fetchRelease, stageRelease: async () => { throw new Error('bad checksum'); }, schedule: async () => assert.fail('must not schedule') });
  await fails.check(); fails.install({ tag }); await tick(); assert.match(fails.status().error, /bad checksum/);
});

test('file replacement preserves local state, backs up old files, removes only unmodified obsolete files', (t) => {
  const root = temp(t), stage = path.join(root, 'staged');
  const old = { 'package.json': '{"version":"0.2.4"}', 'server/index.js': '// old', 'server/gone.js': '// gone', 'server/custom.js': '// default' };
  for (const [rel, body] of Object.entries(old)) put(root, rel, body);
  put(root, 'MANIFEST.json', manifest(old, '0.2.4')); put(root, 'server/custom.js', '// customized');
  put(root, 'logs/admin-settings.json', 'settings'); put(root, 'public/assets/local/x.png', 'art'); put(root, 'scripts/service.env.cmd', 'config'); put(root, 'packs/custom/pack.json', 'pack'); put(root, 'UPDATE.json', 'old pending');
  for (const [rel, body] of Object.entries(files)) put(stage, rel, body);
  put(stage, 'MANIFEST.json', manifest(files));
  const result = applyReleaseStage(root, stage);
  assert.equal(read(root, 'server/index.js'), '// new server');
  assert.equal(read(result.backup, 'server/index.js'), '// old');
  assert.equal(read(root, 'server/custom.js'), '// customized');
  for (const [rel, body] of [['logs/admin-settings.json', 'settings'], ['public/assets/local/x.png', 'art'], ['scripts/service.env.cmd', 'config'], ['packs/custom/pack.json', 'pack']]) assert.equal(read(root, rel), body);
  assert.equal(fs.existsSync(path.join(root, 'server/gone.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'UPDATE.json')), false);
  assert.equal(read(root, 'MANIFEST.json'), manifest(files));
});

test('a match starting during the restart notification cancels shutdown and requires confirmation', async (t) => {
  const root = temp(t); let active = false, canceled = 0, stopped = 0;
  const updater = createReleaseUpdater({ root, fetchImpl: fetchRelease, hasActive: () => active,
    onReady: () => stopped++, stageRelease: async () => ({ stage: root, tag }), schedule: async () => () => canceled++ });
  await updater.check(); updater.install({ tag });
  await until(() => updater.status().state === 'scheduled');
  active = true;
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal(updater.status().state, 'active-matches');
  assert.equal(canceled, 1); assert.equal(stopped, 0);
});

test('failed replacement rolls back every touched file and rejects junction destinations', (t) => {
  const root = temp(t), stage = path.join(root, 'staged');
  put(root, 'server/index.js', '// old'); const oldPkg = read(root, 'package.json');
  for (const [rel, body] of Object.entries(files)) put(stage, rel, body);
  put(stage, 'MANIFEST.json', manifest(files));
  let copied = 0;
  assert.throws(() => applyReleaseStage(root, stage, { copyFile: (from, to) => { fs.copyFileSync(from, to); if (++copied === 2) throw new Error('disk failure'); } }), /已恢复/);
  assert.equal(read(root, 'server/index.js'), '// old'); assert.equal(read(root, 'package.json'), oldPkg);
  assert.equal(fs.existsSync(path.join(root, 'server/new.js')), false);
  fs.rmSync(path.join(root, 'server'), { recursive: true });
  const outside = temp(t); fs.symlinkSync(outside, path.join(root, 'server'), 'junction');
  assert.throws(() => applyReleaseStage(root, stage), /符号链接/);
  assert.equal(fs.existsSync(path.join(outside, 'index.js')), false);
  assert.equal(fs.existsSync(updatePaths(root).lock), false);
});

test('detached installer waits for the old PID, replaces files, records extension tag and restarts a temporary server', { timeout: 60000 }, async (t) => {
  const root = temp(t), stage = path.join(root, 'logs', 'update-staging', 'integration', 'Stronghold-Protocol');
  const port = await freePort();
  const index = healthServerSource(port);
  const content = { 'package.json': files['package.json'], 'server/index.js': index };
  for (const [rel, body] of Object.entries(content)) put(stage, rel, body);
  put(stage, 'MANIFEST.json', manifest(content));
  put(root, 'server/index.js', '// old');
  const old = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  await new Promise((r, reject) => { old.once('spawn', r); old.once('error', reject); });
  let newPid;
  t.after(() => { if (old.exitCode === null) old.kill(); if (newPid) { try { process.kill(newPid); } catch {} } });
  const before = process.env.SP_UPDATE_RESTART;
  delete process.env.SP_UPDATE_RESTART;
  try { await scheduleInstall({ root, stage, tag, parentPid: old.pid, port }); }
  finally { if (before !== undefined) process.env.SP_UPDATE_RESTART = before; }
  assert.equal(read(root, 'server/index.js'), '// old', 'no copying while old process lives');
  assert.ok(fs.existsSync(updatePaths(root).lock));
  old.kill();
  for (let i = 0; i < 450; i++) {
    try {
      if (JSON.parse(read(root, 'logs/release-update-status.json')).state !== 'installed') throw new Error('waiting for health validation');
      newPid = (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).pid; break;
    } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  assert.ok(newPid, 'replacement server starts');
  assert.equal(read(root, 'server/index.js'), index);
  assert.equal(installedTag(root), tag);
  assert.equal(fs.existsSync(updatePaths(root).lock), false);
  assert.equal(JSON.parse(read(root, 'logs/release-update-status.json')).state, 'installed');
  process.kill(newPid); newPid = null;
  await new Promise((r) => setTimeout(r, 100));
});
