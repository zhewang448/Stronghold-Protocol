import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { splitRelease } from '../tools/split-release.mjs';
import { downloadAndStage, pickReleaseAsset } from '../server/release-update.js';
import { applyReleaseStage } from '../server/release-install.js';
import { APP_VERSION } from '../shared/constants.js';
import { RELEASE_TAG } from '../server/release-version.js';
import { manifest, put, read, sha, storedZip, tag } from './helpers/release-fixture.js';

test('signed split packages reuse local assets and download only missing groups', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-split-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = { 'package.json': JSON.stringify({ version: APP_VERSION }), 'server/index.js': 'new' };
  const art = {
    'data/assets.json': JSON.stringify({ image: '/assets/common.png' }),
    'data/local-assets.json': JSON.stringify({ scene: '/assets/local/scene.png' }),
    'data/local-fx.json': JSON.stringify({ effect: '/assets/local/fx/effect.png' }),
    'public/assets/common.png': 'common',
    'public/assets/local/scene.png': 'scene',
    'public/assets/local/fx/effect.png': 'effect',
  };
  const full = storedZip(Object.entries({ ...files, ...art, 'MANIFEST.json': manifest(files) })
    .map(([rel, body]) => [`Stronghold-Protocol/${rel}`, body]));
  const fullPath = path.join(root, 'full.zip'), out = path.join(root, 'release');
  fs.writeFileSync(fullPath, full);
  const source = 'https://raw.githubusercontent.com/example/assets/main/common.png';
  const ledger = path.join(root, 'ledger.json');
  fs.writeFileSync(ledger, JSON.stringify({ files: { 'common.png': { url: source, bytes: Buffer.byteLength(art['public/assets/common.png']) } } }));
  const result = splitRelease(fullPath, tag, out, { ledgerPath: ledger });
  assert.deepEqual(Object.keys(result.groups).sort(), ['common', 'fx', 'local']);
  const liteName = `Stronghold-Protocol-${tag}-lite.zip`;
  const lite = storedZip(Object.entries({ ...files, 'data/assets.json': art['data/assets.json'], 'MANIFEST.json': manifest(files) })
    .map(([rel, body]) => [`Stronghold-Protocol/${rel}`, body]));
  const fullName = `Stronghold-Protocol-${tag}-assets.zip`;
  const all = new Map([[liteName, lite], [fullName, full], [result.index, fs.readFileSync(path.join(out, result.index))]]);
  for (const name of Object.values(result.groups)) all.set(name, fs.readFileSync(path.join(out, name)));
  const deltaName = `Stronghold-Protocol-${tag}-update.zip`, delta = Buffer.alloc(100000);
  const deltaIndexName = `Stronghold-Protocol-${tag}-update-index.json`;
  all.set(deltaName, delta);
  all.set(deltaIndexName, JSON.stringify({ format: 1, tag, fromTags: [RELEASE_TAG], archive: deltaName, size: delta.length, sha256: sha(delta) }));
  const base = `https://github.com/zhewang448/Stronghold-Protocol/releases/download/${tag}/`;
  const release = { tag_name: tag, assets: [...all].map(([name, bytes]) => ({ name, size: name === fullName ? 1000000 : bytes.length, browser_download_url: base + name })) };
  const sums = [...all].map(([name, bytes]) => `${sha(bytes)}  ${name}`).join('\n') + '\n';
  const key = crypto.generateKeyPairSync('ed25519');
  const signature = crypto.sign(null, Buffer.from(`stronghold-protocol-release\n${tag}\n${sums}`), key.privateKey).toString('base64');
  const keys = [key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')];
  release.assets.push({ name: 'SHA256SUMS.txt', browser_download_url: `${base}SHA256SUMS.txt` },
    { name: 'SHA256SUMS.txt.sig', browser_download_url: `${base}SHA256SUMS.txt.sig` });
  assert.equal(pickReleaseAsset({ assets: [...release.assets].reverse() }).name, fullName);
  const installation = path.join(root, 'install');
  put(installation, 'package.json', files['package.json']);
  put(installation, 'server/index.js', 'old');
  for (const [rel, body] of Object.entries(art)) if (!rel.includes('/fx/') && rel !== 'data/local-fx.json') put(installation, rel, body);
  const calls = [];
  const request = async (url, consume) => {
    if (url === source) { calls.push(url); return consume(new Response('common'), 'direct'); }
    const name = url.slice(base.length);
    calls.push(name);
    return consume(new Response(name === 'SHA256SUMS.txt' ? sums : name === 'SHA256SUMS.txt.sig' ? signature : all.get(name)), 'direct');
  };
  const staged = await downloadAndStage({ root: installation, release, releases: [release], request, keys, platform: 'linux' });
  assert.equal(staged.split, true);
  assert.deepEqual(staged.groups, ['fx']);
  assert.ok(calls.includes(liteName));
  assert.ok(calls.includes(result.groups.fx));
  assert.ok(!calls.includes(result.groups.local));
  assert.ok(!calls.includes(result.groups.common));
  assert.ok(!calls.includes(fullName));
  assert.ok(!calls.includes(deltaName), 'the smaller split path is chosen before downloading the delta');
  assert.equal(read(installation, 'server/index.js'), 'old');
  applyReleaseStage(installation, staged.stage);
  for (const [rel, body] of Object.entries({ ...files, ...art })) assert.equal(read(installation, rel), body, rel);
  const sourceInstall = path.join(root, 'source-install');
  put(sourceInstall, 'package.json', files['package.json']);
  put(sourceInstall, 'server/index.js', 'old');
  for (const [rel, body] of Object.entries(art)) if (rel !== 'public/assets/common.png') put(sourceInstall, rel, body);
  calls.length = 0;
  const sourced = await downloadAndStage({ root: sourceInstall, release, releases: [release], request, keys, platform: 'linux' });
  assert.deepEqual(sourced.groups, []);
  assert.ok(calls.includes(source));
  assert.ok(!calls.includes(result.groups.common));
  applyReleaseStage(sourceInstall, sourced.stage);
  assert.equal(read(sourceInstall, 'public/assets/common.png'), 'common');
  const staleInstall = path.join(root, 'stale-install');
  put(staleInstall, 'package.json', files['package.json']);
  put(staleInstall, 'server/index.js', 'old');
  for (const [rel, body] of Object.entries(art)) if (rel !== 'public/assets/common.png') put(staleInstall, rel, body);
  calls.length = 0;
  const staleRequest = async (url, consume) => url === source
    ? consume(new Response('stale!'), 'direct') : request(url, consume);
  const recovered = await downloadAndStage({ root: staleInstall, release, releases: [release], request: staleRequest, keys, platform: 'linux' });
  assert.deepEqual(recovered.groups, ['common']);
  assert.ok(calls.includes(result.groups.common));
  assert.equal(read(staleInstall, 'server/index.js'), 'old');
  applyReleaseStage(staleInstall, recovered.stage);
  assert.equal(read(staleInstall, 'public/assets/common.png'), 'common');
  const brokenInstall = path.join(root, 'broken-install');
  put(brokenInstall, 'package.json', files['package.json']);
  put(brokenInstall, 'server/index.js', 'old');
  for (const [rel, body] of Object.entries(art)) if (!rel.includes('/fx/') && rel !== 'data/local-fx.json') put(brokenInstall, rel, body);
  const brokenRequest = async (url, consume) => url === base + result.groups.fx
    ? consume(new Response(Buffer.alloc(all.get(result.groups.fx).length)), 'direct') : request(url, consume);
  calls.length = 0;
  await assert.rejects(downloadAndStage({ root: brokenInstall, release, releases: [release], request: brokenRequest, keys, platform: 'linux' }), /下载包大小不符/);
  assert.ok(calls.includes(fullName), 'a damaged signed split group attempts the full-package fallback');
  assert.equal(read(brokenInstall, 'server/index.js'), 'old');
  assert.equal(fs.existsSync(path.join(brokenInstall, 'public/assets/local/fx/effect.png')), false);
});
