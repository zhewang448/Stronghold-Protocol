// Self-contained: copied into the verified backup so a subsequent code update cannot change this transaction.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [root, backup] = process.argv.slice(2), recordFile = path.join(backup, 'restore.json');
const safeBase = path.resolve(root, 'logs', 'update-backups');
if (path.dirname(path.resolve(backup)) !== safeBase) process.exit(2);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = file => { try { const b = fs.readFileSync(file); return { size: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }; } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const equal = (a, b) => a === null ? b === null : !!b && a.size === b.size && a.sha256 === b.sha256;
const lock = path.join(backup, 'launcher-update.lock');
for (let attempt = 0; attempt < 1800; attempt++) {
  let fd;
  try {
    try { fd = fs.openSync(lock, 'wx'); fs.writeSync(fd, String(process.pid)); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const owner = Number(fs.readFileSync(lock, 'utf8'));
      if (Number.isSafeInteger(owner) && owner > 0) {
        try { process.kill(owner, 0); }
        catch (error) { if (error.code === 'ESRCH') fs.rmSync(lock, { force: true }); }
      }
      await sleep(1000); continue;
    }
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    if (record.state !== 'verified') break;
    const payload = path.join(backup, 'launcher-payload.exe'), expected = digest(payload);
    for (const target of record.launchers || []) {
      if (target.state !== 'pending') continue;
      if (!expected || !equal(expected, target.desired) || !path.isAbsolute(target.path) || path.basename(target.path) !== 'StrongholdProtocolLauncher.exe') throw new Error('Invalid launcher queue');
      let linked = false;
      for (let current = target.path; current; current = path.dirname(current)) {
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) linked = true;
        if (path.dirname(current) === current) break;
      }
      if (linked) throw new Error('Linked launcher target');
      const current = digest(target.path);
      if (equal(current, target.desired)) { target.state = 'installed'; continue; }
      if (!equal(current, target.before)) { target.state = 'changed'; continue; }
      const tmp = target.path + '.update-' + crypto.randomBytes(8).toString('hex') + '.tmp';
      const executableLock = target.path + '.update.lock'; let executableLease;
      try {
        try { executableLease = fs.openSync(executableLock, 'wx'); fs.writeSync(executableLease, String(process.pid)); }
        catch (error) { if (error.code === 'EEXIST') continue; throw error; }
        if (!equal(digest(target.path), target.before)) { target.state = 'changed'; continue; }
        fs.copyFileSync(payload, tmp); fs.renameSync(tmp, target.path);
        if (!equal(digest(target.path), target.desired)) throw new Error('Launcher verification failed');
        target.state = 'installed';
      }
      catch (e) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; }
      finally {
        fs.rmSync(tmp, { force: true });
        if (executableLease !== undefined) { fs.closeSync(executableLease); fs.rmSync(executableLock, { force: true }); }
      }
    }
    fs.writeFileSync(recordFile, JSON.stringify(record));
    const locationFile = path.join(root, 'logs', 'launcher-location.json');
    if (fs.existsSync(locationFile) && !fs.lstatSync(locationFile).isSymbolicLink() && fs.statSync(locationFile).size <= 8192) {
      const location = JSON.parse(fs.readFileSync(locationFile, 'utf8'));
      const item = record.launchers?.find(target => target.path === location.path);
      if (item?.before && item.state === 'installed' && location.sha256 === item.before.sha256 && equal(digest(item.path), item.desired)) {
        const tmp = locationFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ ...location, sha256: item.desired.sha256 })); fs.renameSync(tmp, locationFile);
      }
    }
    const statusFile = path.join(root, 'logs', 'release-update-status.json');
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    const pending = record.launchers?.some(target => target.state === 'pending');
    if (status.backup === backup && status.state === 'installed') {
      status.launcher = { ...status.launcher, state: pending ? 'pending' : record.launchers?.some(t => t.state === 'changed') ? 'changed' : 'installed' };
      if (!pending && !record.launchers?.some(t => t.state === 'changed')) {
        if (status.warning === status.launcher.warning) delete status.warning;
        delete status.launcher.warning;
      }
      fs.writeFileSync(statusFile, JSON.stringify(status));
    }
    if (!pending) break;
  } catch { break; }
  finally { if (fd !== undefined) { fs.closeSync(fd); fs.rmSync(lock, { force: true }); } }
  await sleep(1000);
}
