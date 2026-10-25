// i18n-ignore-file: local discovery metadata only; contains no management credentials.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export function instanceIndexDirectory(env = process.env) {
  const local = env.LOCALAPPDATA || (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local') : path.join(os.homedir(), '.local', 'share'));
  return path.join(local, 'StrongholdProtocol', 'discovered-instances');
}

/** One atomic file per root avoids cross-process read/modify/write lost updates. */
export function registerInstallation(root, port, { directory = instanceIndexDirectory() } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65435) return false;
  let temporary;
  try {
    root = path.resolve(root);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name !== 'stronghold-protocol-alliance') return false;
    for (const file of ['server/index.js', 'scripts/launch.mjs', 'scripts/host-launcher.mjs'])
      if (!fs.statSync(path.join(root, file)).isFile()) return false;
    const key = process.platform === 'win32' ? root.toUpperCase() : root;
    const id = crypto.createHash('sha256').update(key, 'utf8').digest('hex');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, id + '.json');
    temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ format: 1, root, port, updatedAt: new Date().toISOString() }), { mode: 0o600 });
    fs.renameSync(temporary, file);
    return true;
  } catch { return false; }
  finally { if (temporary) { try { fs.rmSync(temporary, { force: true }); } catch { /* optional index must not block service startup */ } } }
}
