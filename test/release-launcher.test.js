import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { LAUNCHER_EXE, pickLauncherAsset, stageLauncherArchive, prepareLauncherUpdate, writeLauncherReceipt } from '../server/release-launcher.js';
import { downloadAndStage, updatePaths } from '../server/release-update.js';
import { applyReleaseStage } from '../server/release-install.js';
import { markBackup, restoreReleaseBackup, listBackups } from '../server/update-backups.js';
import { archive, storedZip, releaseFor, manifest, put, sha, tag } from './helpers/release-fixture.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-launcher-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(root, 'package.json', '{"version":"0.3.3"}');
  return root;
}
function pe(label) {
  const b = Buffer.alloc(256);b.write('MZ');b.writeUInt32LE(64, 60);b.write('PE\0\0', 64);b.write(label, 90);return b;
}
function stage(t, root, bytes = pe('new')) {
  const directory = path.join(root, 'logs/update-staging/test/Stronghold-Protocol');
  const files = { 'package.json': '{"version":"0.3.3"}', 'server/index.js': '// new game' };
  for (const [name, data] of Object.entries(files)) put(directory, name, data);
  put(directory, 'MANIFEST.json', manifest(files));
  const zip = path.join(root, 'launcher.zip');fs.writeFileSync(zip, storedZip([[LAUNCHER_EXE, bytes], ['README.md', 'notes']]));
  stageLauncherArchive(zip, directory, { tag, asset: 'StrongholdProtocolLauncher-v1.2.0-win-x64.zip' });
  return directory;
}
function register(root, file) { put(root, 'logs/launcher-location.json', JSON.stringify({ format: 1, path: file, sha256: sha(fs.readFileSync(file)) })); }

test('launcher archive selects canonical or legacy assets, rejects ambiguous and unsafe contents', t => {
  const root = fixture(t), target = stage(t, root);
  const canonical = { name: 'StrongholdProtocolLauncher-v1.2.0-win-x64.zip' };
  assert.equal(pickLauncherAsset({ assets: [canonical] }), canonical);
  assert.equal(pickLauncherAsset({ assets: [{ name: 'Stronghold-Protocol-v0.3.3-extended.1-launcher-win-x64.zip' }] }).name.endsWith('.zip'), true);
  assert.throws(() => pickLauncherAsset({ assets: [canonical, canonical] }), /多个/);
  const zip = path.join(root, 'bad.zip');
  for (const entries of [[[LAUNCHER_EXE, 'not executable']], [['../' + LAUNCHER_EXE, pe('bad')]], [[LAUNCHER_EXE, pe('one')], [LAUNCHER_EXE, pe('two')]], [[LAUNCHER_EXE, pe('one')], ['evil.cmd', 'code']]]) {
    fs.writeFileSync(zip, storedZip(entries));assert.throws(() => stageLauncherArchive(zip, target, { tag, asset: canonical.name }));
  }
  assert.equal(prepareLauncherUpdate(root, target).targets[0], path.join(root, LAUNCHER_EXE));
});

test('game and root/external launcher replacements share a verified backup and rollback', t => {
  const root = fixture(t), old = pe('old'), next = pe('new'), outside = path.join(root, 'desktop', LAUNCHER_EXE);
  put(root, 'server/index.js', '// old game');put(root, LAUNCHER_EXE, old);put(root, 'desktop/' + LAUNCHER_EXE, old);register(root, outside);
  const staged = stage(t, root, next), result = applyReleaseStage(root, staged, { from: 'old', to: tag });
  assert.equal(result.launcher.state, 'installed');assert.deepEqual(fs.readFileSync(path.join(root, LAUNCHER_EXE)), next);assert.deepEqual(fs.readFileSync(outside), next);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'logs/launcher-location.json'))).sha256,sha(next));
  assert.equal(prepareLauncherUpdate(root,staged).targets.includes(outside),true,'next update keeps finding the external launcher');
  assert.equal(fs.readFileSync(path.join(root, 'server/index.js'), 'utf8'), '// new game');
  restoreReleaseBackup(root, path.basename(result.backup));
  assert.deepEqual(fs.readFileSync(path.join(root, LAUNCHER_EXE)), old);assert.deepEqual(fs.readFileSync(outside), old);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'logs/launcher-location.json'))).sha256,sha(old));
  assert.equal(fs.readFileSync(path.join(root, 'server/index.js'), 'utf8'), '// old game');
});

test('locked executable leaves game installed and pending launcher backup protected, rollback cancels it', t => {
  const root = fixture(t), old = pe('old');put(root, LAUNCHER_EXE, old);put(root, 'server/index.js', '// old');
  const staged = stage(t, root), result = applyReleaseStage(root, staged, { to: tag, launcherReplace() { throw Object.assign(new Error('locked'), { code: 'EBUSY' }); } });
  assert.equal(result.launcher.state, 'pending');assert.match(result.launcher.warning, /关闭/);
  markBackup(root, path.basename(result.backup), { state: 'verified' });
  assert.equal(listBackups(root).backups[0].launcherPending, true);assert.equal(listBackups(root).backups[0].protected, true);
  restoreReleaseBackup(root, path.basename(result.backup));
  assert.deepEqual(fs.readFileSync(path.join(root, LAUNCHER_EXE)), old);
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.backup, 'restore.json'))).state, 'restored');
});

test('deferred worker completes exact queued bytes after lock release and updates console status', async t => {
  const root = fixture(t), next = pe('new'), old = pe('old');put(root, LAUNCHER_EXE, old);
  const result = applyReleaseStage(root, stage(t, root, next), { to: tag, launcherReplace() { throw Object.assign(new Error('locked'), { code: 'EBUSY' }); } });
  markBackup(root, path.basename(result.backup), { state: 'verified' });
  fs.writeFileSync(updatePaths(root).status, JSON.stringify({ state: 'installed', tag, backup: result.backup, launcher: result.launcher, warning: result.launcher.warning }));
  const child = spawn(process.execPath, [path.join(result.backup, 'launcher-update-worker.mjs'), root, result.backup], { windowsHide: true, stdio: 'pipe' });
  const code = await new Promise((resolve, reject) => { child.on('error', reject);child.on('exit', resolve); });
  assert.equal(code, 0);assert.deepEqual(fs.readFileSync(path.join(root, LAUNCHER_EXE)), next);
  const status = JSON.parse(fs.readFileSync(updatePaths(root).status));assert.equal(status.launcher.state, 'installed');assert.equal(status.warning, undefined);
  restoreReleaseBackup(root, path.basename(result.backup));assert.deepEqual(fs.readFileSync(path.join(root, LAUNCHER_EXE)), old);
});

test('changed external registration cannot authorize overwriting an unrelated executable', t => {
  const root = fixture(t), outside = path.join(root, 'desktop', LAUNCHER_EXE);put(root, 'desktop/' + LAUNCHER_EXE, pe('old'));register(root, outside);
  fs.writeFileSync(outside, pe('changed'));
  const result = applyReleaseStage(root, stage(t, root), { to: tag });
  assert.deepEqual(result.launcher.paths, [path.join(root, LAUNCHER_EXE)]);assert.deepEqual(fs.readFileSync(outside), pe('changed'));
});

test('a newer self-updated external launcher is retained while the root launcher is updated', t => {
  const root = fixture(t), outside = path.join(root, 'desktop', LAUNCHER_EXE), newer = pe('self-updated');
  put(root, LAUNCHER_EXE, pe('old'));
  put(root, 'desktop/' + LAUNCHER_EXE, newer);
  register(root, outside);
  writeLauncherReceipt(outside, 'a'.repeat(64), '9.0.0');
  const result = applyReleaseStage(root, stage(t, root), { to: tag });
  assert.deepEqual(result.launcher.paths, [path.join(root, LAUNCHER_EXE)]);
  assert.deepEqual(fs.readFileSync(outside), newer);
  assert.deepEqual(fs.readFileSync(path.join(root, LAUNCHER_EXE)), pe('new'));
});

test('root launcher is removed on rollback when it did not previously exist', t => {
  const root = fixture(t), result = applyReleaseStage(root, stage(t, root), { to: tag });
  assert.ok(fs.existsSync(path.join(root, LAUNCHER_EXE)));restoreReleaseBackup(root, path.basename(result.backup));
  assert.equal(fs.existsSync(path.join(root, LAUNCHER_EXE)), false);
});

test('partial launcher install failure restores both game and already-replaced executables', t => {
  const root=fixture(t),old=pe('old'),outside=path.join(root,'desktop',LAUNCHER_EXE);
  put(root,LAUNCHER_EXE,old);put(root,'desktop/'+LAUNCHER_EXE,old);put(root,'server/index.js','// old');register(root,outside);
  let count=0;
  assert.throws(()=>applyReleaseStage(root,stage(t,root),{to:tag,launcherReplace(from,to){
    count++;if(count===2)throw Object.assign(new Error('disk failed'),{code:'EIO'});fs.renameSync(from,to);
  }}),/已恢复原程序/);
  assert.deepEqual(fs.readFileSync(path.join(root,LAUNCHER_EXE)),old);assert.deepEqual(fs.readFileSync(outside),old);
  assert.equal(fs.readFileSync(path.join(root,'server/index.js'),'utf8'),'// old');
});

test('launcher backup tampering aborts recovery before any game file changes', t => {
  const root=fixture(t),old=pe('old');put(root,LAUNCHER_EXE,old);put(root,'server/index.js','// old');
  const result=applyReleaseStage(root,stage(t,root),{to:tag});
  fs.writeFileSync(path.join(result.backup,'launcher-backup-0.exe'),pe('tampered'));
  assert.throws(()=>restoreReleaseBackup(root,path.basename(result.backup)),/启动器原文件备份校验失败/);
  assert.equal(fs.readFileSync(path.join(root,'server/index.js'),'utf8'),'// new game');
  assert.deepEqual(fs.readFileSync(path.join(root,LAUNCHER_EXE)),pe('new'));
});

test('a real Windows file lock defers launcher replacement until the holder releases it', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const root = fixture(t), old = pe('locked-old'), next = pe('unlocked-new');put(root, LAUNCHER_EXE, old);
  const ready = path.join(root, 'locked.ready'), done = path.join(root, 'release.lock');
  const script = '$f=[System.IO.File]::Open($env:SP_TEST_EXE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read); try {[System.IO.File]::WriteAllText($env:SP_TEST_READY,"ready"); while(-not [System.IO.File]::Exists($env:SP_TEST_DONE)){Start-Sleep -Milliseconds 50}} finally {$f.Dispose()}';
  const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const holder = spawn(ps, ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    { env:{...process.env,SP_TEST_EXE:path.join(root,LAUNCHER_EXE),SP_TEST_READY:ready,SP_TEST_DONE:done},windowsHide:true,stdio:'ignore' });
  t.after(() => { if (holder.exitCode === null) holder.kill(); });
  const wait = async predicate => { for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('File lock wait timed out'); };
  await wait(() => fs.existsSync(ready));
  const result = applyReleaseStage(root, stage(t, root, next), { to:tag });
  assert.equal(result.launcher.state,'pending');assert.deepEqual(fs.readFileSync(path.join(root,LAUNCHER_EXE)),old);
  markBackup(root,path.basename(result.backup),{state:'verified'});
  fs.writeFileSync(updatePaths(root).status,JSON.stringify({state:'installed',tag,backup:result.backup,launcher:result.launcher}));
  fs.writeFileSync(done,'release');await new Promise(resolve=>holder.once('exit',resolve));
  const worker=spawn(process.execPath,[path.join(result.backup,'launcher-update-worker.mjs'),root,result.backup],{windowsHide:true,stdio:'ignore'});
  assert.equal(await new Promise(resolve=>worker.once('exit',resolve)),0);
  assert.deepEqual(fs.readFileSync(path.join(root,LAUNCHER_EXE)),next);
  restoreReleaseBackup(root,path.basename(result.backup));assert.deepEqual(fs.readFileSync(path.join(root,LAUNCHER_EXE)),old);
});

test('Windows console downloads and verifies launcher signature before any installation; failure is atomic', async t => {
  const root = fixture(t), game = archive(), launcher = storedZip([[LAUNCHER_EXE, pe('signed')], ['README.md', 'notes']]);
  const release = releaseFor(game), base = release.assets[0].browser_download_url.replace(/[^/]+$/, '');
  const asset = { name: 'StrongholdProtocolLauncher-v1.2.0-win-x64.zip', size: launcher.length, browser_download_url: base + 'StrongholdProtocolLauncher-v1.2.0-win-x64.zip' };
  release.assets.push(asset);
  const pair = crypto.generateKeyPairSync('ed25519'), keys = [pair.publicKey.export({ format:'der', type:'spki' }).toString('base64')];
  const sums = sha(game) + '  ' + release.assets[0].name + '\n' + sha(launcher) + '  ' + asset.name + '\n';
  const sig = crypto.sign(null, Buffer.from('stronghold-protocol-release\n' + tag + '\n' + sums), pair.privateKey).toString('base64');
  release.assets.push({ name:'SHA256SUMS.txt',browser_download_url:base+'SHA256SUMS.txt' },{ name:'SHA256SUMS.txt.sig',browser_download_url:base+'SHA256SUMS.txt.sig' });
  const calls = [];let corrupt = false;
  const request = async (url, consume) => { calls.push(url);return consume(new Response(url.endsWith('.sig') ? sig : url.endsWith('.txt') ? sums : url === asset.browser_download_url ? corrupt ? Buffer.alloc(launcher.length) : launcher : game),'direct'); };
  const result = await downloadAndStage({ root, release, platform:'win32', request, keys });
  assert.equal(result.launcher.state, 'staged');assert.equal(fs.existsSync(path.join(root, LAUNCHER_EXE)), false);
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(result.stage),'launcher',LAUNCHER_EXE)), pe('signed'));
  corrupt = true;await assert.rejects(downloadAndStage({ root, release, platform:'win32', request, keys }), /启动器附件 SHA-256/);
  assert.equal(fs.existsSync(path.join(root, LAUNCHER_EXE)), false);
  calls.length = 0;await downloadAndStage({ root, release, platform:'linux', request, keys });
  assert.equal(calls.includes(asset.browser_download_url), false);
});

test('signed launcher archive receipts avoid repeated downloads and detect a changed executable', async t => {
  const root = fixture(t), game = archive(), launcher = storedZip([[LAUNCHER_EXE, pe('installed')], ['README.md', 'notes']]);
  const release = releaseFor(game), base = release.assets[0].browser_download_url.replace(/[^/]+$/, '');
  const asset = { name: 'StrongholdProtocolLauncher-v1.2.0-win-x64.zip', size: launcher.length, browser_download_url: base + 'StrongholdProtocolLauncher-v1.2.0-win-x64.zip' };
  release.assets.push(asset);
  const pair = crypto.generateKeyPairSync('ed25519'), keys = [pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')];
  const sums = `${sha(game)}  ${release.assets[0].name}\n${sha(launcher)}  ${asset.name}\n`;
  const signature = crypto.sign(null, Buffer.from(`stronghold-protocol-release\n${tag}\n${sums}`), pair.privateKey).toString('base64');
  release.assets.push({ name: 'SHA256SUMS.txt', browser_download_url: `${base}SHA256SUMS.txt` },
    { name: 'SHA256SUMS.txt.sig', browser_download_url: `${base}SHA256SUMS.txt.sig` });
  const target = path.join(root, LAUNCHER_EXE);
  fs.writeFileSync(target, pe('installed'));
  writeLauncherReceipt(target, sha(launcher));
  const calls = [];
  const request = async (url, consume) => {
    calls.push(url);
    return consume(new Response(url.endsWith('.sig') ? signature : url.endsWith('.txt') ? sums : url === asset.browser_download_url ? launcher : game), 'direct');
  };
  const reused = await downloadAndStage({ root, release, platform: 'win32', request, keys });
  assert.equal(reused.launcher.state, 'unchanged');
  assert.ok(!calls.includes(asset.browser_download_url));
  fs.writeFileSync(target, Buffer.concat([pe('changed'), Buffer.from('different')]));
  calls.length = 0;
  const changed = await downloadAndStage({ root, release, platform: 'win32', request, keys });
  assert.equal(changed.launcher.state, 'staged');
  assert.ok(calls.includes(asset.browser_download_url));
  writeLauncherReceipt(target, 'a'.repeat(64), '9.0.0');
  calls.length = 0;
  const newer = await downloadAndStage({ root, release, platform: 'win32', request, keys });
  assert.equal(newer.launcher.state, 'unchanged');
  assert.ok(!calls.includes(asset.browser_download_url), 'a self-updated newer launcher is not downgraded');
});
