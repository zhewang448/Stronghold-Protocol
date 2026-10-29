import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RELEASE_TAG } from '../server/release-version.js';
import { APP_VERSION } from '../shared/constants.js';
import { downloadAndStage, planUpdateRoute, stageUpdateZip } from '../server/release-update.js';
import { applyReleaseStage } from '../server/release-install.js';
import { restoreReleaseBackup } from '../server/update-backups.js';
import { manifest, put, read, sha, storedZip } from './helpers/release-fixture.js';

const revision = Number(RELEASE_TAG.match(/\d+$/)[0]);
const version = (offset) => RELEASE_TAG.replace(/\d+$/, String(revision + offset));
const hashes = (files) => Object.fromEntries(Object.entries(files).map(([rel, body]) => [rel, { size: Buffer.byteLength(body), sha256: sha(body) }]));

test('route planning chooses the least downloaded compatible chain', () => {
  const candidates = [
    { tag: version(1), fromTags: [RELEASE_TAG], size: 3 },
    { tag: version(2), fromTags: [RELEASE_TAG, version(1)], size: 5 },
    { tag: version(3), fromTags: [version(1), version(2)], size: 2 },
  ];
  assert.deepEqual(planUpdateRoute(RELEASE_TAG, version(3), candidates), [version(1), version(3)]);
  assert.deepEqual(planUpdateRoute(RELEASE_TAG, version(3), candidates.map(item => item.tag === version(1) ? { ...item, requiresStartup: true } : item)), [version(2), version(3)]);
  assert.equal(planUpdateRoute(RELEASE_TAG, version(4), candidates), null);
  assert.deepEqual(planUpdateRoute(RELEASE_TAG, RELEASE_TAG, candidates), []);
});

test('two signed-compatible deltas build one complete final stage without changing the running install', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-update-chain-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initial = { 'package.json': JSON.stringify({ version: APP_VERSION }), 'server/index.js': 'old', 'server/keep.js': 'keep' };
  const first = { ...initial, 'server/index.js': 'first' };
  const last = { ...initial, 'server/index.js': 'last' };
  const initialArt = { 'data/assets.json': JSON.stringify({ image: '/assets/first.png' }), 'public/assets/first.png': 'old art' };
  const firstArt = { ...initialArt, 'public/assets/first.png': 'first art', 'public/assets/extra.png': 'extra' };
  const lastArt = { ...firstArt, 'data/assets.json': JSON.stringify({ image: '/assets/first.png', extra: '/assets/extra.png' }) };
  for (const [rel, body] of Object.entries({ ...initial, ...initialArt, 'MANIFEST.json': manifest(initial) })) put(root, rel, body);
  const makeDelta = (baseTag, targetTag, before, after, beforeArt, afterArt, filename) => {
    const shipped = Object.fromEntries(Object.entries({ ...after, ...afterArt }).filter(([rel, body]) => ({ ...before, ...beforeArt })[rel] !== body));
    const update = { format: 1, app: APP_VERSION, tag: targetTag, from: [APP_VERSION], fromTags: [baseTag],
      count: Object.keys(shipped).length, bytes: Object.values(shipped).reduce((sum, body) => sum + Buffer.byteLength(body), 0),
      files: hashes(shipped), art: hashes(afterArt), removed: [] };
    const entries = { ...shipped, 'MANIFEST.json': manifest(after), 'UPDATE.json': JSON.stringify(update) };
    const zip = path.join(root, filename);
    fs.writeFileSync(zip, storedZip(Object.entries(entries).map(([rel, body]) => [`Stronghold-Protocol/${rel}`, body])));
    return zip;
  };
  const firstZip = makeDelta(RELEASE_TAG, version(1), initial, first, initialArt, firstArt, 'first.zip');
  const lastZip = makeDelta(version(1), version(2), first, last, firstArt, lastArt, 'last.zip');
  const firstStage = path.join(root, 'stage-first'), lastStage = path.join(root, 'stage-last');
  stageUpdateZip(firstZip, firstStage, version(1), root);
  stageUpdateZip(lastZip, lastStage, version(2), root, { baseTag: version(1), previousStages: [firstStage], consolidate: true });
  assert.equal(read(root, 'server/index.js'), 'old');
  assert.equal(read(root, 'public/assets/first.png'), 'old art');
  assert.equal(read(lastStage, 'public/assets/first.png'), 'first art');
  assert.equal(read(lastStage, 'public/assets/extra.png'), 'extra');
  const applied = applyReleaseStage(root, lastStage);
  for (const [rel, body] of Object.entries({ ...last, ...lastArt })) assert.equal(read(root, rel), body, rel);
  restoreReleaseBackup(root, path.basename(applied.backup));
  for (const [rel, body] of Object.entries({ ...initial, ...initialArt })) assert.equal(read(root, rel), body, rel);
  assert.equal(fs.existsSync(path.join(root, 'public/assets/extra.png')), false);
  applyReleaseStage(root, lastStage);
  assert.equal(read(root, 'server/index.js'), 'last');
});

test('signed route indexes avoid downloading an unused, larger intermediate archive', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-update-route-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initial = { 'package.json': JSON.stringify({ version: APP_VERSION }), 'server/index.js': 'old' };
  const middle = { ...initial, 'server/index.js': 'middle' };
  const final = { ...initial, 'server/index.js': 'final' };
  const art = { 'data/assets.json': '{}', 'public/assets/keep.png': 'kept art' };
  for (const [rel, body] of Object.entries({ ...initial, ...art, 'MANIFEST.json': manifest(initial) })) put(root, rel, body);
  const key = crypto.generateKeyPairSync('ed25519');
  const keys = [key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')];
  const responses = new Map(), calls = [];
  const release = (baseTags, tag, files, extra = {}, requiresStartup = false) => {
    const fromTags = Array.isArray(baseTags) ? baseTags : [baseTags];
    const shipped = { 'server/index.js': files['server/index.js'] };
    const update = { format: 1, app: APP_VERSION, tag, from: [APP_VERSION], fromTags, requiresStartup,
      count: 1, bytes: Buffer.byteLength(shipped['server/index.js']), files: hashes(shipped), art: hashes(art), removed: [] };
    const zip = storedZip(Object.entries({ ...shipped, ...extra, 'MANIFEST.json': manifest(files), 'UPDATE.json': JSON.stringify(update) })
      .map(([rel, body]) => [`Stronghold-Protocol/${rel}`, body]));
    const base = `https://github.com/zhewang448/Stronghold-Protocol/releases/download/${tag}/`;
    const delta = { name: `Stronghold-Protocol-${tag}-update.zip`, size: zip.length, browser_download_url: `${base}Stronghold-Protocol-${tag}-update.zip` };
    const full = { name: `Stronghold-Protocol-${tag}-assets.zip`, size: 500000, browser_download_url: `${base}Stronghold-Protocol-${tag}-assets.zip` };
    const indexName = `Stronghold-Protocol-${tag}-update-index.json`;
    const index = JSON.stringify({ format: 1, tag, fromTags, archive: delta.name, size: zip.length, sha256: sha(zip), requiresStartup });
    const sums = `${sha(zip)}  ${delta.name}\n${sha(index)}  ${indexName}\n${'0'.repeat(64)}  ${full.name}\n`;
    const signature = crypto.sign(null, Buffer.from(`stronghold-protocol-release\n${tag}\n${sums}`), key.privateKey).toString('base64');
    responses.set(delta.browser_download_url, zip);
    responses.set(`${base}${indexName}`, index);
    responses.set(`${base}SHA256SUMS.txt`, sums);
    responses.set(`${base}SHA256SUMS.txt.sig`, signature);
    return { tag_name: tag, assets: [delta, full, { name: indexName, browser_download_url: `${base}${indexName}` },
      { name: 'SHA256SUMS.txt', browser_download_url: `${base}SHA256SUMS.txt` },
      { name: 'SHA256SUMS.txt.sig', browser_download_url: `${base}SHA256SUMS.txt.sig` }] };
  };
  const middleRelease = release(RELEASE_TAG, version(1), middle);
  const largerRelease = release(RELEASE_TAG, version(2), middle, { 'padding.bin': 'x'.repeat(5000) });
  const finalRelease = release([version(1), version(2)], version(3), final);
  const request = async (url, consume) => {
    calls.push(url);
    if (!responses.has(url)) throw new Error(`unexpected request ${url}`);
    return consume(new Response(responses.get(url)), 'direct');
  };
  const staged = await downloadAndStage({ root, release: finalRelease, releases: [middleRelease, largerRelease, finalRelease], request, keys, platform: 'linux' });
  assert.deepEqual(staged.route, [version(1), version(3)]);
  assert.equal(calls.filter(url => url.endsWith('-update.zip')).length, 2);
  assert.ok(!calls.some(url => url.includes(version(2)) && url.endsWith('-update.zip')));
  assert.equal(calls.some(url => url.endsWith('-assets.zip')), false);
  assert.equal(read(root, 'server/index.js'), 'old');
  applyReleaseStage(root, staged.stage);
  assert.equal(read(root, 'server/index.js'), 'final');
  assert.equal(read(root, 'public/assets/keep.png'), 'kept art');
  put(root, 'server/index.js', 'old');
  const migrating = release(RELEASE_TAG, version(1), middle, {}, true);
  const afterMigration = release(version(1), version(4), final);
  calls.length = 0;
  await assert.rejects(downloadAndStage({ root, release: afterMigration, releases: [migrating, afterMigration], request, keys, platform: 'linux' }), /中间版本需要先启动/);
  assert.equal(read(root, 'server/index.js'), 'old');
  assert.ok(!calls.some(url => url.endsWith('-assets.zip')));
});
