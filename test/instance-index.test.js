import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerInstallation, instanceIndexDirectory } from '../server/instance-index.js';
import { recordInstance } from '../server/instance.js';

function fixture(t) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-index-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const root = path.join(work, 'server install');
  for (const dir of ['server', 'scripts']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'stronghold-protocol-alliance' }));
  for (const file of ['server/index.js', 'scripts/launch.mjs', 'scripts/host-launcher.mjs']) fs.writeFileSync(path.join(root, file), 'fixture');
  return { work, root, directory: path.join(work, 'index') };
}

test('registration persists one credential-free record per installation and updates atomically', t => {
  const { root, directory } = fixture(t);
  assert.equal(registerInstallation(root, 3000, { directory }), true);
  assert.equal(registerInstallation(root, 3001, { directory }), true);
  const files = fs.readdirSync(directory);
  assert.equal(files.length, 1);
  const record = JSON.parse(fs.readFileSync(path.join(directory, files[0]), 'utf8'));
  assert.equal(record.root, path.resolve(root)); assert.equal(record.port, 3001); assert.equal(record.format, 1);
  assert.deepEqual(Object.keys(record).sort(), ['format', 'port', 'root', 'updatedAt']);
  assert.equal(registerInstallation(root, 0, { directory }), false);
});

test('foreign installs and unwritable index cannot block server startup', t => {
  const { root, directory, work } = fixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"foreign"}');
  assert.equal(registerInstallation(root, 3000, { directory }), false);
  assert.equal(fs.existsSync(directory), false);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"stronghold-protocol-alliance"}');
  const blocked = path.join(work, 'file');fs.writeFileSync(blocked, 'occupied');
  assert.equal(registerInstallation(root, 3000, { directory: path.join(blocked, 'index') }), false);
});

test('recording a server automatically registers its root and retains discovery after stop', t => {
  const { root, work } = fixture(t);
  const previous = process.env.LOCALAPPDATA;process.env.LOCALAPPDATA = path.join(work, 'localappdata');
  t.after(() => { if (previous === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previous; });
  const remove = recordInstance(root, { port: 3000, adminPort: 3100, token: 'a'.repeat(32) });
  const directory = instanceIndexDirectory();
  assert.equal(fs.readdirSync(directory).filter(file => file.endsWith('.json')).length, 1);
  remove();
  assert.equal(fs.readdirSync(directory).length, 1);
  assert.equal(fs.existsSync(path.join(root, 'logs/server-instance-3000.json')), false);
});
