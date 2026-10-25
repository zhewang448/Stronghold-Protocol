// Host-only replay persistence and compatibility. Never imported by the browser or tools at runtime.
// i18n-ignore-file: errors are displayed only by the Chinese host console.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DATA_SHIM_JS } from './http/static.js';

export const REPLAY_ID = /^[\w-]+\.json$/;
const DATA = ['chess', 'enemies', 'tokens', 'stages', 'waves', 'bonds', 'items', 'garrisons', 'bands', 'effects', 'backups'];

/** Content fingerprint, computed at console startup; excludes paths and timestamps. */
export function replayIdentity(root) {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.js') && e.name !== 'nodeData.js') files.push(rel);
    }
  };
  walk('server/sim'); walk('shared');
  files.push('public/js/battle/runner.js', ...DATA.map((f) => `data/${f}.json`));
  const versionsDir = path.join(root, 'data', 'versions');
  if (fs.existsSync(versionsDir)) for (const entry of fs.readdirSync(versionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of fs.readdirSync(path.join(versionsDir, entry.name))) if (name.endsWith('.json')) files.push('data/versions/' + entry.name + '/' + name);
  }
  const hash = createHash('sha256');
  for (const f of files.sort()) hash.update(f).update('\0').update(fs.readFileSync(path.join(root, f))).update('\0');
  return hash.update(DATA_SHIM_JS).digest('hex');
}

export function replayFiles(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.gz') && REPLAY_ID.test(f.slice(0, -3)) && fs.lstatSync(path.join(dir, f)).isFile()); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

export function saveReplay(dir, id, replay, keep = 50) {
  if (!REPLAY_ID.test(id)) throw new Error('Invalid replay id');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.gz`), tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, gzipSync(JSON.stringify(replay)));
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
  const size = fs.statSync(file).size;
  const files = replayFiles(dir).map((name) => ({ name, time: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => Number(b.name === `${id}.gz`) - Number(a.name === `${id}.gz`) || b.time - a.time || b.name.localeCompare(a.name));
  for (const f of files.slice(keep)) fs.unlinkSync(path.join(dir, f.name));
  return size;
}

function rawReplay(dir, id) {
  const file = path.join(dir, `${id}.gz`);
  if (!fs.lstatSync(file).isFile()) throw new Error('Not a regular replay');
  return JSON.parse(gunzipSync(fs.readFileSync(file), { maxOutputLength: 64 * 1024 * 1024 }));
}

/** Counts / clears console summaries in saved replays, preserving their specs and original compatibility. */
export function replayAdminLogs(dir, clear = false) {
  let count = 0;
  for (const file of replayFiles(dir)) {
    const id = file.slice(0, -3);
    let replay;
    try { replay = rawReplay(dir, id); } catch { if (clear) throw new Error(`无法清理损坏的回放：${file}，请清理回放文件后重试`); else continue; }
    let n = 0;
    for (const round of replay.rounds || []) if (Array.isArray(round.admin)) { n += round.admin.length; if (clear) round.admin = []; }
    if (clear && n) {
      const full = path.join(dir, file), stat = fs.statSync(full);
      saveReplay(dir, id, replay, Infinity);
      fs.utimesSync(full, stat.atime, stat.mtime);
    }
    count += n;
  }
  return count;
}

export function readReplay(dir, id, identity) {
  if (!REPLAY_ID.test(id || '')) return null;
  try {
    const replay = rawReplay(dir, id);
    if (replay.format !== 1 || !Array.isArray(replay.rounds)) return { error: '不支持的回放格式' };
    if (!replay.made || !Array.isArray(replay.players) || replay.rounds.some((r) => !r || !Number.isInteger(r.round)
      || !Array.isArray(r.fields) || !Array.isArray(r.admin) || r.fields.some((f) => !f || !Array.isArray(f.players)
        || !f.spec || !Array.isArray(f.spec.players) || !Array.isArray(f.spec.spawns)))) return { error: '回放内容损坏或缺少战斗输入' };
    replay.compatible = !!identity && replay.made?.identity === identity;
    replay.currentIdentity = identity;
    for (const round of replay.rounds) for (const f of round.fields) {
      // Old recordings already contain boss inputs and credited results, but no shared-pool timeline.
      // Permit a bounded local attempt without promoting it to an exact, verifiable replay.
      const boss = f.kind === 'boss' || f.kind === 'hidden';
      f.canAttempt = !!f.playable || (boss && f.source === 'boss-credited' && !f.result?.synthetic
        && Number.isFinite(f.result?.time) && f.result.time >= 0);
      if (!replay.compatible && f.playable) { f.playable = false; f.reason = 'version'; }
    }
    return replay;
  } catch { return null; }
}

/** Fixed category allowlist. Only regular named records can be deleted, never caller-provided paths. */
export function deleteRecordFiles(resultsDir, replaysDir, id, category = 'both') {
  if (!REPLAY_ID.test(id || '')) throw new Error('记录名称无效');
  let count = 0;
  const files = category === 'both' ? [path.join(resultsDir, id), path.join(replaysDir, `${id}.gz`)]
    : category === 'results' ? [path.join(resultsDir, id)] : category === 'replays' ? [path.join(replaysDir, `${id}.gz`)] : [];
  for (const f of files) {
    try { if (fs.lstatSync(f).isFile()) { fs.unlinkSync(f); count++; } } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return count;
}

export function recordFiles(dir, exclude = []) {
  try { return fs.readdirSync(dir).filter((f) => REPLAY_ID.test(f) && !exclude.includes(path.resolve(dir, f)) && fs.lstatSync(path.join(dir, f)).isFile()); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
