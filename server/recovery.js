// i18n-ignore-file: host persistence. Uses the same pre-effect PREP snapshot and replay truncation as rewind.
import fs from 'node:fs';
import path from 'node:path';
import { serialize, deserialize } from 'node:v8';
import { createHash } from 'node:crypto';
import { Room } from './lobby.js';
import { Session } from './net.js';
import { replayIdentity } from './replay-store.js';
import { rewindToPrep } from './match/rewind.js';
import { RELEASE_TAG } from './release-version.js';
import { ROOM_CODE_LEN } from '../shared/constants.js';

const FIXED = ['stageId', 'factions', 'bossId', 'hiddenBossId', 'disabledBonds', 'staticInactiveBonds', 'bannedChess', 'setupRevision', 'uidSeq', '_battleSeq', 'timerScale', 'uniteLayerGainsEnabled'];
const CODE = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LEN}}$`);
// New files avoid Windows device basenames such as COM1 / LPT9. Existing unprefixed snapshots remain readable.
const ID = new RegExp(`^(?:room-)?([A-Z0-9]{${ROOM_CODE_LEN}})\\.bin$`);

/** Version includes meta rules as well as the shared simulator/data identity. */
export function recoveryIdentity(root) {
  const hash = createHash('sha256').update(replayIdentity(root));
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js')) hash.update(file).update(fs.readFileSync(path.join(root, file)));
    }
  };
  walk('server/match');
  for (const file of ['server/recovery.js', 'server/lobby.js', 'server/net.js']) hash.update(file).update(fs.readFileSync(path.join(root, file)));
  return RELEASE_TAG + ':' + hash.digest('hex');
}

export function restoreMatch(m, record) {
  Object.assign(m, record.fixed);
  if (typeof record.room?.uniteLayerGains === 'boolean') m.uniteLayerGains = record.room.uniteLayerGains;
  // setupMatchWaves hides this on the factions array; neither v8 nor structuredClone retains non-enumerable fields.
  Object.defineProperty(m.factions, 'schedule', { value: record.schedule, enumerable: false });
  // Count only the timeline through the saved PREP boundary, excluding downtime and the abandoned round.
  m.startedAt = m.sched.now() - record.elapsedMs;
  m.stage = m.gd.stage(m.stageId);
  const off = new Set([...m.disabledBonds, ...m.staticInactiveBonds]);
  for (const ps of m.order) ps.initDiyStock(off);
  m.replay = record.replay;
  m.replayDisabled = record.replayDisabled;
  for (const ps of m.order) {
    const flags = record.flags[ps.playerId];
    ps.connected = ps.isBot; ps.autoplay = flags.autoplay; ps.left = flags.left;
  }
  const snap = { round: record.snapshot.match.round, data: record.snapshot, refs: { bossPool: null, uniteBounds: null } };
  m.prepSnapshots.set(snap.round, snap);
  const result = rewindToPrep(m, snap.round);
  if (result.error) throw new Error(result.error);
}

export function createRecovery({ lobby, root, dir = path.join(root, 'logs', 'recovery'), identity = recoveryIdentity(root), log = console }) {
  const settings = path.join(path.dirname(dir), 'recovery-settings.json');
  let enabled = true, stopping = false, restoring = false;
  const issues = new Map();
  try { enabled = JSON.parse(fs.readFileSync(settings, 'utf8')).enabled !== false; } catch { /* default on */ }
  const files = () => {
    try {
      const names = fs.readdirSync(dir).filter((f) => ID.test(f));
      const present = new Set(names);
      return names.filter((f) => f.startsWith('room-') || !present.has('room-' + f));
    } catch { return []; }
  };
  const remove = (code) => {
    if (!CODE.test(code)) return;
    for (const name of [`room-${code}.bin`, code + '.bin']) {
      fs.rmSync(path.join(dir, name), { force: true }); issues.delete(name);
    }
  };
  const manager = {
    restoreMatch, remove,
    status: () => ({ enabled, issues: [...issues].map(([id, error]) => ({ id, error })) }),
    configure(value) {
      if (typeof value !== 'boolean') return { error: '恢复设置必须为开或关' };
      fs.mkdirSync(path.dirname(settings), { recursive: true });
      fs.writeFileSync(settings + '.tmp', JSON.stringify({ enabled: value })); fs.renameSync(settings + '.tmp', settings);
      enabled = value;
      // Disabling removes stale snapshots so a later opt-in cannot revive an abandoned match.
      if (!enabled) for (const f of files()) remove(ID.exec(f)[1]);
      else for (const r of lobby.rooms.values()) if (r.match?.prepSnapshots?.size) manager.save(r, r.match, [...r.match.prepSnapshots.values()].at(-1));
      return { ok: true, ...manager.status() };
    },
    delete(id) { const code = typeof id === 'string' && ID.exec(id)?.[1]; if (!code) return { error: '恢复文件名无效' }; remove(code); return { ok: true, ...manager.status() }; },
    roomClosed(code) { if (!stopping) remove(code); },
    prepareShutdown() { stopping = true; },
    save(room, m, snap) {
      if (!enabled || stopping || restoring || room.test || m.test) return;
      if (!CODE.test(room.code)) throw new Error('恢复房间号无效');
      const sessions = [...room.seats, ...room.spectators].filter((s) => s && !s.isBot)
        .map((s) => lobby.registry.byId(s.playerId)).filter(Boolean)
        .map((s) => Object.fromEntries(['playerId', 'token', 'name', 'loadout', 'ops', 'skins', 'card', 'cardSkin', 'notOwned', 'diy', 'resumeWindowMs', 'presenceStatus'].map((k) => [k, s[k]])));
      const record = { format: 1, identity, seed: m.seed, matchNo: room.matchCount,
        room: { code: room.code, mode: room.mode, difficulty: room.difficulty, capacity: room.capacity, hostId: room.hostId, seats: room.seats, spectators: room.spectators, aiPicksLast: room.aiPicksLast, uniteLayerGains: room.uniteLayerGains, createdAt: room.createdAt },
        seats: m.order.map((p) => ({ seat: p.seat, playerId: p.playerId, name: p.name, isBot: p.isBot, connected: p.isBot,
          loadout: p.loadout, ops: p.ops, skins: p.skins, card: p.card, cardSkin: p.cardSkin, notOwned: p.standIns, diy: p.diy })),
        flags: Object.fromEntries(m.order.map((p) => [p.playerId, { autoplay: p.autoplay, left: p.left }])),
        fixed: Object.fromEntries(FIXED.map((k) => [k, m[k]])), schedule: m.factions.schedule,
        elapsedMs: Math.max(0, snap.at - m.startedAt), snapshot: snap.data, sessions,
        replay: m.replay, replayDisabled: m.replayDisabled };
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `room-${room.code}.bin`);
      fs.writeFileSync(file + '.tmp', serialize(record), { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
      issues.delete(path.basename(file));
      fs.rmSync(path.join(dir, room.code + '.bin'), { force: true }); issues.delete(room.code + '.bin');
    },
    restore() {
      if (!enabled) { for (const f of files()) remove(ID.exec(f)[1]); return; }
      restoring = true;
      try { for (const file of files()) {
        let room = null; const added = [];
        try {
          const full = path.join(dir, file);
          if (fs.statSync(full).size > 128 * 1024 * 1024) throw new Error('恢复文件过大');
          const r = deserialize(fs.readFileSync(full));
          if (r.identity !== identity) throw new Error('因版本变化无法恢复的对局');
          if (r.format !== 1 || r.room?.code !== ID.exec(file)[1] || !Array.isArray(r.seats) || !r.seats.length || !r.snapshot?.players || !Array.isArray(r.sessions)) throw new Error('恢复文件格式损坏');
          if (lobby.rooms.has(r.room.code)) throw new Error('房间号已占用');
          for (const saved of r.sessions) {
            if (typeof saved.token !== 'string' || typeof saved.playerId !== 'string' || lobby.registry.byId(saved.playerId) || lobby.registry.byToken(saved.token)) throw new Error('重连身份冲突或损坏');
            const s = Object.assign(new Session({ ...saved, now: lobby.now() }), saved, { connected: false, disconnectedAt: lobby.now(), roomCode: r.room.code });
            if (r.room.mode === 'solo') s.resumeWindowMs = lobby.soloResumeWindowMs();
            lobby.registry.byPlayerId.set(s.playerId, s); lobby.registry.byTokenMap.set(s.token, s); added.push(s);
          }
          room = Object.assign(new Room(r.room.code, r.room.mode, r.room.difficulty, lobby.now()), r.room);
          // Old recovery records predate the new-room on-by-default setting; preserve their historical off default.
          if (!Object.hasOwn(r.room, 'aiPicksLast')) room.aiPicksLast = false;
          room.matchCount = r.matchNo - 1;
          for (const s of [...room.seats, ...room.spectators]) if (s) s.connected = !!s.isBot;
          lobby.rooms.set(room.code, room);
          const result = lobby.startMatch(room, null, r);
          if (result.error) throw new Error(result.detail || result.error);
          for (const s of room.spectators) lobby.startGrace(room, s);
          log.info?.(`[recovery] ${room.code} PREP R${room.match.round}`);
        } catch (e) {
          if (room) { lobby.disposeMatchCtx(room.matchCtx); lobby.rooms.delete(room.code); }
          for (const s of added) lobby.registry.remove(s);
          issues.set(file, e.message); log.error?.(`[recovery] ${file}: ${e.message}`);
        }
      } } finally { restoring = false; }
    },
  };
  lobby.recovery = manager;
  return manager;
}
