import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyReleaseStage } from '../server/release-install.js';
import { startAdmin } from '../server/admin.js';
import { assertUpdateSpace, restoreReleaseBackup, listBackups, markBackup, deleteBackup, configureBackups, pruneBackups } from '../server/update-backups.js';
import { put, read, manifest } from './helpers/release-fixture.js';

function temp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-backup-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function install(root, version) {
  const stage = path.join(root, 'stage');
  const files = { 'package.json': '{"version":"0.3.1"}', 'server/index.js': version };
  for (const [rel, body] of Object.entries(files)) put(stage, rel, body);
  put(stage, 'MANIFEST.json', manifest(files));
  return path.basename(applyReleaseStage(root, stage, { from: 'old', to: version }).backup);
}
test('disk preflight refuses insufficient or invalid capacity', () => {
  assert.throws(() => assertUpdateSpace('.', 100, { reserve: 0, statfs: () => ({ bavail: 9, bsize: 10 }) }), /空间不足/);
  assert.equal(assertUpdateSpace('.', 100, { reserve: 0, statfs: () => ({ bavail: 10, bsize: 10 }) }), 100);
});
test('rollback verifies all backup bytes before writing and restores version metadata', (t) => {
  const root = temp(t); put(root, 'server/index.js', 'old'); put(root, 'logs/release-version.json', '{"tag":"old"}');
  const id = install(root, 'new'); put(root, 'logs/release-version.json', '{"tag":"new"}');
  const backupFile = path.join(root, 'logs/update-backups', id, 'server/index.js');
  fs.writeFileSync(backupFile, 'tampered'); assert.throws(() => restoreReleaseBackup(root, id), /备份校验失败/);
  assert.equal(read(root, 'server/index.js'), 'new');
  fs.writeFileSync(backupFile, 'old'); restoreReleaseBackup(root, id);
  assert.equal(read(root, 'server/index.js'), 'old'); assert.equal(JSON.parse(read(root, 'logs/release-version.json')).tag, 'old');
  assert.equal(fs.existsSync(path.join(root, 'package.json')), false);
});
test('an out-of-order rollback refuses changed files; cleanup retains the latest good recovery point', (t) => {
  const root = temp(t); put(root, 'server/index.js', 'old');
  const a = install(root, 'one'); markBackup(root, a, { state: 'verified', at: 1 });
  const b = install(root, 'two'); markBackup(root, b, { state: 'verified', at: 2 });
  const c = install(root, 'three'); markBackup(root, c, { state: 'verified', at: 3 });
  assert.throws(() => restoreReleaseBackup(root, a), /当前程序已变化/);
  assert.throws(() => deleteBackup(root, c), /受保护/);
  configureBackups(root, 2); pruneBackups(root);
  assert.deepEqual(listBackups(root).backups.map((r) => r.id), [c, b]);
  put(root, 'logs/release-update.lock', '{}'); assert.throws(() => deleteBackup(root, b), /更新进行中/);
  assert.throws(() => configureBackups(root, 0), /保留数量/);
});

test('backup controls require the local-console token, reject protected deletion, and report storage usage', async (t) => {
  const root = temp(t), admin = await startAdmin({ root, lobby: { rooms: new Map(), onMatchEnd() {} }, port: 0,
    resultsDir: root, settingsFile: path.join(root, 'settings.json'), log: { info() {}, warn() {}, error() {} } });
  t.after(() => admin.close());
  const url = `${admin.url}/api/update-backups`, headers = { 'x-admin-token': admin.token, 'content-type': 'application/json' };
  assert.equal((await fetch(url)).status, 403);
  let response = await fetch(url, { headers });
  assert.equal(response.status, 200); assert.equal((await response.json()).keep, 2);
  response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ action: 'configure', keep: 4 }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).keep, 4);
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ action: 'configure', keep: 0 }) })).status, 400);
  const a = install(root, 'one'), b = install(root, 'two');
  markBackup(root, a, { state: 'verified', at: 1 }); markBackup(root, b, { state: 'verified', at: 2 });
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ action: 'delete', id: b, confirm: true }) })).status, 400);
  response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ action: 'delete', id: a, confirm: true }) });
  assert.equal(response.status, 200); assert.equal(listBackups(root).backups.some((x) => x.id === a), false);
});

test('backup usage measures actual files and reports unreadable legacy metadata as unknown', (t) => {
  const root = temp(t), id = install(root, 'new');
  let view = listBackups(root), before = view.bytes;
  put(root, `logs/update-backups/${id}/extra.bin`, '1234567890');
  view = listBackups(root); assert.equal(view.bytes, before + 10);
  put(root, 'logs/update-backups/release-legacy/restore.json', '{}');
  view = listBackups(root); assert.equal(view.bytes, null);
  assert.equal(view.backups.find((b) => b.id === 'release-legacy').bytes, null);
});
