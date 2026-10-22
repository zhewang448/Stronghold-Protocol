#!/usr/bin/env node
// tools/release-sign.mjs — sign the extension release checksums (server/release-signing.js, docs/LOCAL-DEV.md §5).
//
//   node tools/release-sign.mjs keygen
//       write a new Ed25519 private key (refuses to overwrite) and print the public key for RELEASE_PUBLIC_KEYS.
//   node tools/release-sign.mjs sign <tag> <dir>
//       hash every Stronghold-Protocol-<tag>-*.zip in <dir>, write <dir>/SHA256SUMS.txt and SHA256SUMS.txt.sig,
//       then verify the signature against the keys built into the server (a key that is not listed fails here).
//   node tools/release-sign.mjs verify <tag> <dir>
//       check <dir>/SHA256SUMS.txt.sig and every listed zip's hash.
//
// The private key lives outside the repository: SP_RELEASE_KEY, or ~/.stronghold-release/release-ed25519.pem.
// Upload SHA256SUMS.txt and SHA256SUMS.txt.sig with the zips; never commit or ship the key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { SIGNATURE_ASSET, SUMS_ASSET, parseSignature, signSums, sumFor, verifySums } from '../server/release-signing.js';
import { RELEASE_TAG } from '../server/release-version.js';

export const keyPath = (env = process.env) => env.SP_RELEASE_KEY || path.join(os.homedir(), '.stronghold-release', 'release-ed25519.pem');

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

export function keygen(file) {
  if (fs.existsSync(file)) throw new Error(`key already exists: ${file}`);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
  return publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}

const zipsFor = (tag, dir) => fs.readdirSync(dir).filter((n) => n.startsWith(`Stronghold-Protocol-${tag}-`) && n.endsWith('.zip')).sort();

export async function sign(tag, dir, { file, keys } = {}) {
  const zips = zipsFor(tag, dir);
  if (!zips.length) throw new Error(`no Stronghold-Protocol-${tag}-*.zip in ${dir}`);
  const lines = [];
  for (const name of zips) lines.push(`${await hashFile(path.join(dir, name))}  ${name}`);
  const sums = `${lines.join('\n')}\n`;
  // A signed artifact set is sealed. A changed package requires a new release revision.
  const oldSums = path.join(dir, SUMS_ASSET), oldSignature = path.join(dir, SIGNATURE_ASSET);
  if (fs.existsSync(oldSums) || fs.existsSync(oldSignature)) {
    if (!fs.existsSync(oldSums) || !fs.existsSync(oldSignature) || fs.readFileSync(oldSums, 'utf8') !== sums) throw new Error('signed release is immutable; bump the extension revision instead of replacing its artifacts');
    await verify(tag, dir, { keys }); return zips;
  }
  const signature = signSums(tag, sums, crypto.createPrivateKey(fs.readFileSync(file)));
  if (!verifySums(tag, sums, parseSignature(signature), keys)) throw new Error('the signing key is not in RELEASE_PUBLIC_KEYS (server/release-signing.js)');
  fs.writeFileSync(path.join(dir, SUMS_ASSET), sums);
  fs.writeFileSync(path.join(dir, SIGNATURE_ASSET), `${signature}\n`);
  return zips;
}

export async function verify(tag, dir, { keys } = {}) {
  const sums = fs.readFileSync(path.join(dir, SUMS_ASSET));
  if (!verifySums(tag, sums, parseSignature(fs.readFileSync(path.join(dir, SIGNATURE_ASSET), 'utf8')), keys)) throw new Error('signature does not match');
  const zips = zipsFor(tag, dir);
  for (const name of zips) if (sumFor(sums.toString('utf8'), name) !== await hashFile(path.join(dir, name))) throw new Error(`hash mismatch: ${name}`);
  return zips;
}

export function assertReleaseRevision(tag, { expected = RELEASE_TAG, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), run = spawnSync } = {}) {
  if (tag !== expected) throw new Error('签名标签必须与 server/release-version.js 一致，请先递增扩展版本并同步发布说明。');
  const dirty = run('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (dirty.status !== 0 || dirty.stdout.trim()) throw new Error('签名只能用于干净工作区中的正式版本；不要为未提交改动生成发布签名。');
  const ref = run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (ref.status === 0) {
    const head = run('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (head.status !== 0 || head.stdout.trim() !== ref.stdout.trim()) throw new Error('该扩展标签已对应其他程序内容，请递增版本，不能覆盖同版发布。');
  }
}

async function main([command, tag, dir]) {
  if (command === 'keygen') {
    const file = keyPath();
    console.log(`private key: ${file} (back it up; never commit it)`);
    console.log(`public key for RELEASE_PUBLIC_KEYS: ${keygen(file)}`);
  } else if ((command === 'sign' || command === 'verify') && tag && dir) {
    if (command === 'sign') assertReleaseRevision(tag);
    const zips = command === 'sign' ? await sign(tag, dir, { file: keyPath() }) : await verify(tag, dir);
    console.log(`${command === 'sign' ? 'signed' : 'verified'} ${tag}: ${zips.join(', ')}`);
  } else {
    console.error('usage: node tools/release-sign.mjs keygen | sign <tag> <dir> | verify <tag> <dir>');
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
