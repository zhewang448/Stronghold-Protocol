#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../server/release-zip.js';
import { isSetupArt, parseManifest, pathProblem, removalProblem } from '../server/update.js';
import { zipFolder } from './package.mjs';
import { githubSourceUrl } from './assets/sources.mjs';

const digest = bytes => ({ size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
const groupOf = rel => rel === 'data/local-fx.json' || rel.startsWith('public/assets/local/fx/') ? 'fx'
  : rel === 'data/local-assets.json' || rel.startsWith('public/assets/local/') ? 'local' : 'common';

export function splitRelease(fullZip, tag, out, { ledgerPath } = {}) {
  if (!/^v\d+\.\d+\.\d+(?:-extended\.\d+)?$/.test(tag)) throw new Error('invalid release tag');
  const destination = path.resolve(out);
  fs.mkdirSync(destination, { recursive: true });
  const names = ['common', 'local', 'fx'].map(group => `Stronghold-Protocol-${tag}-${group}-art.zip`);
  const indexName = `Stronghold-Protocol-${tag}-art-index.json`;
  for (const name of [...names, indexName]) if (fs.existsSync(path.join(destination, name))) throw new Error(`output exists: ${name}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-split-release-'));
  const files = {}, seen = new Set(), program = new Map();
  let ledger = {};
  if (ledgerPath) ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).files || {};
  let manifestText, packageText;
  try {
    readZip(fullZip, (name, bytes) => {
      if (!name.startsWith('Stronghold-Protocol/')) throw new Error(`invalid package path: ${name}`);
      const rel = name.slice('Stronghold-Protocol/'.length), key = rel.toLowerCase();
      if (pathProblem(rel) || seen.has(key)) throw new Error(`invalid or duplicate package path: ${rel}`);
      seen.add(key);
      if (rel === 'MANIFEST.json') manifestText = bytes.toString('utf8');
      if (rel === 'package.json') packageText = bytes.toString('utf8');
      if (rel === 'UPDATE.json') throw new Error('a complete package is required');
      if (!isSetupArt(rel)) { program.set(rel, digest(bytes)); return; }
      if (removalProblem(rel)) throw new Error(`invalid asset path: ${rel}`);
      const group = groupOf(rel), file = path.join(work, group, 'Stronghold-Protocol', ...rel.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      const record = { ...digest(bytes), group };
      const entry = group === 'common' && rel.startsWith('public/assets/') ? ledger[rel.slice('public/assets/'.length)] : null;
      if (entry?.bytes === bytes.length && typeof entry.url === 'string') {
        try {
          const url = new URL(githubSourceUrl(entry.url));
          if (url.protocol === 'https:' && url.hostname === 'raw.githubusercontent.com' && !url.username && !url.password && !url.search && !url.hash) record.source = url.href;
        } catch {}
      }
      files[rel] = record;
    });
    const manifest = parseManifest(manifestText || ''), pkg = JSON.parse(packageText || 'null');
    if (pkg?.version !== manifest.app || /^v(\d+\.\d+\.\d+)(?:-extended\.\d+)?$/.exec(tag)?.[1] !== manifest.app
      || !files['data/assets.json']) throw new Error('package identity or assets are invalid');
    for (const [rel, expected] of manifest.files) {
      const got = program.get(rel);
      if (!got || got.size !== expected.size || got.sha256 !== expected.sha256) throw new Error(`package program differs from manifest: ${rel}`);
    }
    const groups = {};
    for (const [index, group] of ['common', 'local', 'fx'].entries()) {
      if (!Object.values(files).some(file => file.group === group)) continue;
      zipFolder(path.join(work, group), path.join(destination, names[index]));
      groups[group] = names[index];
    }
    fs.writeFileSync(path.join(destination, indexName), JSON.stringify({ format: 1, tag, app: manifest.app, groups, files }));
    return { index: indexName, groups, files: Object.keys(files).length };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [fullZip, tag, out, ledgerPath] = process.argv.slice(2);
  if (!fullZip || !tag || !out) {
    console.error('usage: node tools/split-release.mjs <full zip> <release tag> <output directory> [asset ledger]');
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(splitRelease(fullZip, tag, out, { ledgerPath }))); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
