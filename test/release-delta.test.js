import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_VERSION } from '../shared/constants.js';
import { RELEASE_TAG } from '../server/release-version.js';
import { createReleaseUpdater, downloadAndStage, stageUpdateZip } from '../server/release-update.js';
import { applyReleaseStage } from '../server/release-install.js';
import { parseUpdate } from '../server/update.js';
import { manifest, put, read, releaseFor, sha, storedZip, tag, until } from './helpers/release-fixture.js';

const hashes = (files) => Object.fromEntries(Object.entries(files).map(([rel, body]) => [rel, { size: Buffer.byteLength(body), sha256: sha(body) }]));
const zipFor = (files) => storedZip(Object.entries(files).map(([rel, body]) => [`Stronghold-Protocol/${rel}`, body]));

function fixture(t, targetTag = tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-release-delta-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = { 'package.json': JSON.stringify({ version: APP_VERSION, type: 'module' }),
    'server/index.js': '// old', 'server/keep.js': '// stable', 'server/retired.js': '// retired' };
  const next = { 'package.json': old['package.json'], 'server/index.js': '// new', 'server/keep.js': '// stable' };
  const oldArt = { 'data/assets.json': JSON.stringify({ same: '/assets/same.png', changed: '/assets/changed.png' }),
    'public/assets/same.png': 'same image', 'public/assets/changed.png': 'old image' };
  const art = { ...oldArt, 'data/assets.json': JSON.stringify({ same: '/assets/same.png', changed: '/assets/changed.png', fresh: '/assets/new.png' }),
    'public/assets/changed.png': 'new image', 'public/assets/new.png': 'new art' };
  for (const [rel, body] of Object.entries({ ...old, ...oldArt })) put(root, rel, body);
  put(root, 'MANIFEST.json', manifest(old));
  const shipped = Object.fromEntries(Object.entries({ ...next, ...art }).filter(([rel, body]) => ({ ...old, ...oldArt })[rel] !== body));
  const update = { format: 1, app: APP_VERSION, tag: targetTag, from: [APP_VERSION], fromTags: [RELEASE_TAG],
    count: Object.keys(shipped).length, bytes: Object.values(shipped).reduce((n, body) => n + Buffer.byteLength(body), 0),
    files: hashes(shipped), art: hashes(art), removed: [{ path: 'server/retired.js', sha256: [sha(old['server/retired.js'])] }] };
  const delta = (change = () => {}, extras = {}) => {
    const doc = structuredClone(update); change(doc);
    return zipFor({ ...shipped, 'MANIFEST.json': manifest(next), 'UPDATE.json': JSON.stringify(doc), ...extras });
  };
  const full = zipFor({ ...next, ...art, 'MANIFEST.json': manifest(next) });
  const stage = (zip = delta()) => {
    const zipPath = path.join(root, 'delta.zip'), stagePath = path.join(root, 'stage');
    fs.writeFileSync(zipPath, zip);
    stageUpdateZip(zipPath, stagePath, targetTag, root);
    return stagePath;
  };
  return { root, next, old, art, delta, full, stage, targetTag };
}

function signedRelease(f, zip = f.delta()) {
  const release = releaseFor(f.full, f.targetTag), fullAsset = release.assets[0];
  const deltaAsset = { ...fullAsset, name: fullAsset.name.replace('-assets.zip', '-update.zip'), size: zip.length, digest: `sha256:${sha(zip)}` };
  deltaAsset.browser_download_url = fullAsset.browser_download_url.replace('-assets.zip', '-update.zip');
  release.assets.unshift(deltaAsset);
  const sums = `${sha(zip)}  ${deltaAsset.name}\n${sha(f.full)}  ${fullAsset.name}\n`;
  const key = crypto.generateKeyPairSync('ed25519');
  const sig = crypto.sign(null, Buffer.concat([Buffer.from(`stronghold-protocol-release\n${f.targetTag}\n`), Buffer.from(sums)]), key.privateKey).toString('base64');
  const base = fullAsset.browser_download_url.replace(/[^/]+$/, '');
  release.assets.push({ name: 'SHA256SUMS.txt', browser_download_url: `${base}SHA256SUMS.txt` },
    { name: 'SHA256SUMS.txt.sig', browser_download_url: `${base}SHA256SUMS.txt.sig` });
  const calls = [];
  return { release, calls, keys: [key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')],
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(url.endsWith('.sig') ? sig : url.endsWith('.txt') ? sums : url.endsWith('-update.zip') ? zip : f.full);
    } };
}

test('delta installs changed art and code transactionally, removes retired code and preserves local settings and extra art', async t => {
  const f = fixture(t), remote = signedRelease(f);
  put(f.root, 'logs/settings.json', 'settings'); put(f.root, 'public/assets/custom.png', 'custom');
  const staged = await downloadAndStage({ root: f.root, ...remote });
  assert.match(staged.asset, /-update\.zip$/);
  assert.equal(read(f.root, 'server/index.js'), '// old');
  assert.equal(fs.existsSync(path.join(staged.stage, 'public/assets/same.png')), false);
  const applied = applyReleaseStage(f.root, staged.stage);
  for (const [rel, body] of Object.entries({ ...f.next, ...f.art })) assert.equal(read(f.root, rel), body, rel);
  assert.equal(applied.removed, 1);
  assert.equal(fs.existsSync(path.join(f.root, 'server/retired.js')), false);
  assert.equal(read(applied.backup, 'server/retired.js'), '// retired');
  assert.equal(read(f.root, 'logs/settings.json'), 'settings'); assert.equal(read(f.root, 'public/assets/custom.png'), 'custom');
  assert.ok(!remote.calls.some(url => url.endsWith('-assets.zip')));
});

test('delta installation failure restores program, deleted files and changed art together', t => {
  const f = fixture(t), stage = f.stage();
  assert.throws(() => applyReleaseStage(f.root, stage, { copyFile(from, to) {
    fs.copyFileSync(from, to);
    if (to.endsWith(`${path.sep}new.png`)) throw new Error('disk full');
  } }), /已恢复/);
  assert.equal(read(f.root, 'server/index.js'), '// old');
  assert.equal(read(f.root, 'public/assets/changed.png'), 'old image');
  assert.equal(read(f.root, 'server/retired.js'), '// retired');
  assert.equal(fs.existsSync(path.join(f.root, 'public/assets/new.png')), false);
});

test('delta rejects tampered retained assets, linked paths and staging changes before replacing any program', async t => {
  for (const mode of ['missing', 'corrupt', 'linked', 'staged']) await t.test(mode, t => {
    const f = fixture(t);
    if (mode === 'missing') fs.unlinkSync(path.join(f.root, 'public/assets/same.png'));
    if (mode === 'corrupt') put(f.root, 'public/assets/same.png', 'bad! image');
    if (mode === 'linked') {
      const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
      fs.rmSync(path.join(f.root, 'public/assets'), { recursive: true });
      fs.symlinkSync(outside, path.join(f.root, 'public/assets'), process.platform === 'win32' ? 'junction' : 'dir');
    }
    if (mode === 'staged') {
      const stage = f.stage(); put(stage, 'public/assets/changed.png', 'tampered');
      assert.throws(() => applyReleaseStage(f.root, stage), /素材校验失败/);
    } else assert.throws(() => f.stage(), /素材校验失败|符号链接/);
    assert.equal(read(f.root, 'server/index.js'), '// old');
  });
});

test('incompatible or malformed signed delta falls back to an independently verified full archive', async t => {
  const cases = [
    ['unsupported base', doc => { doc.from = ['0.0.1']; }],
    ['wrong extension', doc => { doc.fromTags = ['v0.3.1-extended.1']; }],
    ['wrong target', doc => { doc.tag = 'v9.9.9'; }],
    ['legacy art inventory', doc => { delete doc.art; }],
    ['count mismatch', doc => { doc.count++; }],
    ['size mismatch', doc => { doc.bytes++; }],
    ['missing payload', doc => { doc.files['server/missing.js'] = { size: 1, sha256: sha('x') }; }],
    ['reserved art', doc => { doc.art['logs/settings.json'] = { size: 1, sha256: sha('x') }; }],
  ];
  for (const [name, change] of cases) await t.test(name, async t => {
    const f = fixture(t), remote = signedRelease(f, f.delta(change)), progress = [];
    const staged = await downloadAndStage({ root: f.root, ...remote, progress: p => progress.push(p) });
    assert.match(staged.asset, /-assets\.zip$/);
    assert.ok(progress.some(p => p.fallback && p.fallbackReason));
    assert.equal(read(f.root, 'server/index.js'), '// old');
  });
});

test('unsigned releases, same-version repairs and downgrades skip delta downloads', async t => {
  for (const mode of ['unsigned', 'repair', 'downgrade']) await t.test(mode, async t => {
    const target = mode === 'repair' ? RELEASE_TAG : mode === 'downgrade' ? `v${APP_VERSION}` : tag;
    const f = fixture(t, target), remote = signedRelease(f);
    if (mode === 'unsigned') remote.release.assets = remote.release.assets.filter(a => !a.name.startsWith('SHA256SUMS'));
    const staged = await downloadAndStage({ root: f.root, ...remote });
    assert.match(staged.asset, /-assets\.zip$/);
    assert.ok(!remote.calls.some(url => url.endsWith('-update.zip')));
  });
});

test('delta checksum failures use full fallback, while an invalid release signature installs neither archive', async t => {
  const f = fixture(t), remote = signedRelease(f);
  const staged = await downloadAndStage({ root: f.root, ...remote, fetchImpl: async url => url.endsWith('-update.zip')
    ? new Response(Buffer.alloc(remote.release.assets[0].size)) : remote.fetchImpl(url) });
  assert.match(staged.asset, /-assets\.zip$/);
  remote.calls.length = 0;
  await assert.rejects(downloadAndStage({ root: f.root, ...remote, keys: [] }), /签名校验失败/);
  assert.ok(!remote.calls.some(url => url.endsWith('.zip')));
  assert.equal(read(f.root, 'server/index.js'), '// old');
});

test('delta paths, duplicate metadata and target file hashes are checked strictly', async t => {
  const cases = [
    ['traversal', { '../escape.js': 'bad' }, /非法路径/],
    ['reserved', { 'RELEASE-ART.json': '{}' }, /保留路径/],
    ['unlisted', { 'server/unlisted.js': 'bad' }, /未列出的文件/],
    ['wrong hash', { 'server/index.js': '// tampered' }, /文件校验失败/],
  ];
  for (const [name, extras, pattern] of cases) await t.test(name, t => {
    const f = fixture(t); assert.throws(() => f.stage(f.delta(undefined, extras)), pattern);
  });
  const f = fixture(t), entries = [['Stronghold-Protocol/MANIFEST.json', manifest(f.next)],
    ['Stronghold-Protocol/MANIFEST.json', manifest(f.next)]];
  assert.throws(() => f.stage(storedZip(entries)), /重复文件/);
  assert.throws(() => parseUpdate(JSON.stringify({ format: 1, app: APP_VERSION, from: [APP_VERSION], files: {}, count: 0, bytes: 0, removed: [], fromTags: ['bad'] })), /fromTags/);
});

test('console reports delta size for upgrades and full size for repairs or downgrades', async t => {
  for (const targetTag of [tag, RELEASE_TAG, `v${APP_VERSION}`]) await t.test(targetTag, async t => {
    const f = fixture(t, targetTag), remote = signedRelease(f);
    const updater = createReleaseUpdater({ root: f.root, fetchImpl: async () => new Response(JSON.stringify([remote.release])) });
    const view = (await updater.check()).versions.find(v => v.tag === targetTag);
    if (targetTag === tag) {
      assert.match(view.asset, /-update\.zip$/); assert.match(view.fallbackAsset, /-assets\.zip$/);
      assert.equal(view.size, remote.release.assets[0].size);
    } else { assert.match(view.asset, /-assets\.zip$/); assert.equal(view.fallbackAsset, undefined); }
  });
});

test('resuming a prepared full fallback after an active match preserves the actual package and fallback reason', async t => {
  const f = fixture(t), remote = signedRelease(f);
  const full = remote.release.assets.find(a => a.name.endsWith('-assets.zip'));
  let active = false;
  const updater = createReleaseUpdater({ root: f.root, onReady() {}, hasActive: () => active,
    fetchImpl: async () => new Response(JSON.stringify([remote.release])),
    stageRelease: async ({ progress }) => {
      progress({ fallback: true, fallbackReason: 'baseline mismatch', asset: full.name, size: full.size });
      active = true;
      return { stage: path.join(f.root, 'logs/update-staging/fixture/Stronghold-Protocol'), tag, asset: full.name };
    }, schedule: async () => () => {} });
  await updater.check(); updater.install({ tag });
  await until(() => updater.status().state === 'active-matches');
  active = false;
  const resumed = updater.install({ tag });
  assert.equal(resumed.asset, full.name); assert.equal(resumed.size, full.size);
  assert.equal(resumed.fallbackReason, 'baseline mismatch');
  await until(() => updater.status().state === 'scheduled');
});
