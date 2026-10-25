import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createReleaseUpdater, createUpdateRequest, downloadAndStage } from '../server/release-update.js';
import { RELEASE_PUBLIC_KEYS, parseSignature, verifySums } from '../server/release-signing.js';
import { keygen, sign, verify } from '../tools/release-sign.mjs';
import { archive, releaseFor, put, read, sha, signRelease, until, tag } from './helpers/release-fixture.js';

const temp = (t) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sign-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); put(root, 'package.json', '{"version":"0.2.5"}'); return root; };
// Everything GitHub serves fails; the mirror answers from `bodies` (by file suffix) or with the zip.
const mirrorOnly = (bodies, zip) => createUpdateRequest({ mirror: 'https://mirror.test/' }, { fetchImpl: async (url) => {
  if (!url.startsWith('https://mirror.test/')) return new Response('<html>blocked</html>', { status: 502 });
  const hit = Object.entries(bodies).find(([suffix]) => url.endsWith(suffix));
  return new Response(hit ? hit[1] : zip);
} });

test('built-in release keys are Ed25519 public keys', () => {
  assert.ok(RELEASE_PUBLIC_KEYS.length >= 1);
  for (const der of RELEASE_PUBLIC_KEYS) {
    assert.equal(crypto.createPublicKey({ key: Buffer.from(der, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType, 'ed25519');
  }
});

test('a signed release installs entirely through the mirror; forged checksums, foreign tags and bad signatures are refused', async (t) => {
  const root = temp(t), zip = archive();
  const release = releaseFor(zip);
  const { sums, sig, keys } = signRelease(release, zip);
  const staged = await downloadAndStage({ root, release, keys, listing: 'mirror', request: mirrorOnly({ '.sig': sig, '.txt': sums }, zip) });
  assert.equal(read(staged.stage, 'server/index.js'), '// new server');

  // The mirror swaps the zip and rewrites SHA256SUMS.txt to match: the signature no longer covers it.
  const evil = archive([['Stronghold-Protocol/server/evil.js', 'x']]);
  const forged = `${sha(evil)}  ${release.assets[0].name}\n`;
  await assert.rejects(downloadAndStage({ root, release, keys, listing: 'mirror', request: mirrorOnly({ '.sig': sig, '.txt': forged }, evil) }), /签名校验失败/);
  // A genuine signature over another tag's checksums cannot be relabelled as this release.
  const other = releaseFor(zip);
  const foreign = signRelease(other, zip, { signTag: 'v0.2.5-extended.1' });
  await assert.rejects(downloadAndStage({ root, release: other, keys: foreign.keys, listing: 'mirror', request: mirrorOnly({ '.sig': foreign.sig, '.txt': foreign.sums }, zip) }), /签名校验失败/);
  // Unknown key, garbage signature.
  await assert.rejects(downloadAndStage({ root, release, listing: 'mirror', request: mirrorOnly({ '.sig': sig, '.txt': sums }, zip) }), /签名校验失败/);
  await assert.rejects(downloadAndStage({ root, release, keys, request: mirrorOnly({ '.sig': '<html>', '.txt': sums }, zip) }), /签名格式错误/);
  assert.throws(() => parseSignature('not base64'), /格式错误/);
  assert.equal(verifySums(release.tag_name, sums, parseSignature(sig), keys), true);
});

test('an unsigned release needs its checksum from GitHub itself, never from the mirror', async (t) => {
  const root = temp(t), zip = archive();
  const sums = (release) => `${sha(zip)}  ${release.assets[0].name}\n`;
  const withSums = () => {
    const release = releaseFor(zip);
    release.assets.push({ name: 'SHA256SUMS.txt', browser_download_url: release.assets[0].browser_download_url.replace(/[^/]+$/, 'SHA256SUMS.txt') });
    return release;
  };
  // Listed through the mirror: neither the API digest nor SHA256SUMS.txt is trusted.
  await assert.rejects(downloadAndStage({ root, release: releaseFor(zip), listing: 'mirror', fetchImpl: async () => new Response(zip) }), /没有发布签名/);
  // Listed directly, but SHA256SUMS.txt only reachable through the mirror.
  const release = withSums();
  await assert.rejects(downloadAndStage({ root, release, request: mirrorOnly({ '.txt': sums(release) }, zip) }), /没有发布签名/);
  // Checksum from GitHub (direct or proxy) while the zip itself falls back to the mirror: accepted.
  const mixed = createUpdateRequest({ mirror: 'https://mirror.test/' }, { fetchImpl: async (url) => {
    if (url.endsWith('.txt')) return new Response(sums(release));
    return url.startsWith('https://mirror.test/') ? new Response(zip) : new Response('reset', { status: 502 });
  } });
  assert.equal(read((await downloadAndStage({ root, release, request: mixed })).stage, 'server/index.js'), '// new server');
});

test('console lists unsigned releases from the mirror as not installable and hands the listing route to staging', async (t) => {
  const root = temp(t), zip = archive();
  const unsigned = releaseFor(zip);
  const signed = releaseFor(zip, tag.replace(/\d+$/, (revision) => String(Number(revision) + 1)));
  signRelease(signed, zip);
  const staged = [];
  const updater = createReleaseUpdater({ root, onReady() {},
    fetchImpl: async (url) => url.startsWith('https://gh-proxy.com/') ? new Response(JSON.stringify([signed, unsigned])) : new Response('<html>blocked</html>'),
    stageRelease: async (args) => { staged.push(args.listing); throw new Error('stop here'); } });
  const d = await updater.check();
  const view = Object.fromEntries(d.versions.map((v) => [v.tag, v]));
  assert.equal(view[signed.tag_name].signed, true);
  assert.equal(view[signed.tag_name].installable, true);
  assert.equal(view[unsigned.tag_name].signed, false);
  assert.match(view[unsigned.tag_name].reason, /没有发布签名/);
  assert.match(updater.install({ tag: unsigned.tag_name }).error, /没有发布签名/);
  updater.install({ tag: signed.tag_name });
  await until(() => staged.length === 1);
  assert.deepEqual(staged, ['mirror']);
});

test('tools/release-sign.mjs: keygen never overwrites, sign writes verifiable SHA256SUMS.txt + .sig, verify catches a changed zip', async (t) => {
  const dir = temp(t), key = path.join(dir, 'keys', 'release.pem');
  const pub = keygen(key);
  assert.throws(() => keygen(key), /already exists/);
  const name = 'Stronghold-Protocol-v0.2.5-extended.9-lite.zip';
  fs.writeFileSync(path.join(dir, name), 'zip bytes');
  const launcher = 'StrongholdProtocolLauncher-v1.1.0-win-x64.zip';
  fs.writeFileSync(path.join(dir, launcher), 'launcher bytes');
  fs.writeFileSync(path.join(dir, 'Stronghold-Protocol-v0.2.5-extended.8-lite.zip'), 'other release');
  await assert.rejects(sign('v0.2.5-extended.9', dir, { file: key }), /not in RELEASE_PUBLIC_KEYS/);
  assert.deepEqual(await sign('v0.2.5-extended.9', dir, { file: key, keys: [pub] }), [name, launcher]);
  assert.equal(fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8'), sha('zip bytes') + '  ' + name + String.fromCharCode(10) + sha('launcher bytes') + '  ' + launcher + String.fromCharCode(10));
  assert.deepEqual(await verify('v0.2.5-extended.9', dir, { keys: [pub] }), [name, launcher]);
  await assert.rejects(verify('v0.2.5-extended.10', dir, { keys: [pub] }), /signature/);
  fs.writeFileSync(path.join(dir, name), 'changed');
  await assert.rejects(verify('v0.2.5-extended.9', dir, { keys: [pub] }), /hash mismatch/);
});
