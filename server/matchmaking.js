// [ASSUMED] Opt-in local matching: compatible version/difficulty preferences, four seats, no automatic start or AI fill.
// Reuses Lobby.create/join; existing parties stay together and explicitly request solo recruits.
import { DEFAULT_SEATS, DIFFICULTIES, ERR } from '../shared/constants.js';
import { CONVENIENCE_DEFAULTS } from '../shared/roomConvenience.js';
import { sendSession } from './net.js';
import { getSocialSettings } from './match/hostSettings.js';

const ok = { ok: true };
const fail = error => ({ error });
export class Matchmaking {
  constructor(lobby) {
    this.lobby = lobby;
    this.solo = new Map();
    this.parties = new Map();
    this.running = false;
    this.countKey = '';
    this.lastStates = new WeakMap();
    this.timer = setInterval(() => this.pump(), 1000);
    this.timer.unref();
  }
  eligible(room) {
    const host = room && this.lobby.registry.byId(room.hostId);
    return !!room && !room.disposed && room.mode === 'coop' && room.capacity === DEFAULT_SEATS
      && !room.match && !room.private && !room.test && !room.modded && !room.content?.modeId && !room.versionVote
      && !!host?.connected && room.freeSeat() >= 0 && room.activeHumans().every(s => s.connected)
      && room.aiPicksLast === true && !room.aiTakeoverEnabled && !room.uniteLayerGains && room.enemyHpMultiplier === 1 && !room.independentPools && !room.rescueEnabled
      && Object.entries(CONVENIENCE_DEFAULTS).every(([key, value]) => room.convenience[key] === value);
  }
  same(a, b) { return a.version === b.version && a.difficulty === b.difficulty; }
  versions(difficulty = null) {
    return (this.lobby.versions?.ids ?? [this.lobby.defaultVersion()]).filter(version =>
      this.lobby.versionEnabled(version) && this.lobby.versionAvailable(version)
      && (difficulty == null ? this.lobby.offered(version, 'coop').length > 0 : this.lobby.offered(version, 'coop').includes(difficulty)));
  }
  accepts(entry, version, difficulty) {
    return (entry.anyDifficulty || entry.difficulty === difficulty) && (entry.anyVersion || entry.version === version);
  }
  state(session) {
    const room = this.lobby.roomOf(session);
    const entry = this.solo.get(session.playerId) || (room && this.parties.get(room.code));
    return entry ? { t: 'match.state', status: 'searching', version: entry.version, anyVersion: entry.anyVersion === true, anyDifficulty: entry.anyDifficulty === true, difficulty: entry.difficulty,
      startedAt: entry.startedAt, target: DEFAULT_SEATS, matched: room ? room.seats.filter(Boolean).length : 1, roomCode: room?.code ?? null }
      : { t: 'match.state', status: 'idle' };
  }
  send(session, force = false) {
    const frame = this.state(session), key = JSON.stringify(frame);
    if (!force && this.lastStates.get(session) === key) return;
    this.lastStates.set(session, key); sendSession(session, frame);
  }
  roomState(room) {
    for (const seat of room.activeHumans()) {
      const session = this.lobby.registry.byId(seat.playerId);
      if (session?.connected) this.send(session);
    }
  }
  queue(session, msg) {
    if (!session.connected) return fail(ERR.BAD_MSG);
    if (msg.mode !== 'coop' || msg.random === true || msg.fillBots === true) return fail(ERR.BAD_TARGET);
    const room = this.lobby.roomOf(session);
    const version = msg.version ?? room?.version ?? this.lobby.defaultVersion();
    if (!this.lobby.versionEnabled(version)) return fail(ERR.VERSION_UNKNOWN);
    const anyVersion = msg.anyVersion === true;
    const anyDifficulty = msg.anyDifficulty === true;
    const available = this.versions(anyDifficulty ? null : msg.difficulty);
    if (anyVersion ? !available.length : !available.includes(version)) return fail(ERR.MATCH_UNSUPPORTED);
    const existing = this.solo.get(session.playerId);
    if (room) {
      if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
      if (anyVersion || anyDifficulty || !this.eligible(room) || room.version !== version || room.difficulty !== msg.difficulty) return fail(ERR.BAD_TARGET);
      const previous = this.parties.get(room.code);
      if (!previous) {
        const entry = { version, difficulty: room.difficulty, startedAt: this.lobby.now(), hostId: room.hostId };
        this.parties.set(room.code, entry); room.matching = entry;
        this.lobby.broadcastState(room);
      }
      this.roomState(room);
    } else {
      if (existing && (!this.same(existing, { version, difficulty: msg.difficulty }) || !!existing.anyVersion !== anyVersion || !!existing.anyDifficulty !== anyDifficulty)) this.cancel(session);
      if (!this.solo.has(session.playerId)) this.solo.set(session.playerId, { version, anyVersion, anyDifficulty, difficulty: msg.difficulty, startedAt: this.lobby.now() });
      this.send(session);
    }
    this.pump();
    return ok;
  }
  cancel(session) {
    const room = this.lobby.roomOf(session);
    if (room && this.parties.has(room.code)) {
      if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
      this.stopRoom(room);
    }
    this.solo.delete(session.playerId); this.send(session); this.counts();
    return ok;
  }
  stopRoom(room) {
    if (!this.parties.delete(room.code)) return;
    delete room.matching;
    if (!room.disposed) { this.lobby.broadcastState(room); this.roomState(room); }
  }
  reconcile(room) {
    const entry = this.parties.get(room.code);
    if (entry && (!this.eligible(room) || !this.same(entry, room) || entry.hostId !== room.hostId)) this.stopRoom(room);
  }
  leave(session) {
    const removed = this.solo.delete(session.playerId);
    const room = this.lobby.roomOf(session);
    if (room?.seatOf(session.playerId) && !room.seatOf(session.playerId).isBot) this.stopRoom(room);
    if (removed && session.connected) this.send(session);
    this.counts();
  }
  found(session, room) {
    sendSession(session, { t: 'match.found', roomCode: room.code, version: room.version, difficulty: room.difficulty, full: room.freeSeat() < 0 });
  }
  pump() {
    if (this.running) return;
    this.running = true;
    try {
      for (const [id] of this.solo) {
        const session = this.lobby.registry.byId(id);
        if (!session?.connected || this.lobby.roomOf(session)) { this.solo.delete(id); if (session?.connected) this.send(session); }
      }
      for (const [code, entry] of this.parties) {
        const room = this.lobby.rooms.get(code);
        if (!room) { this.parties.delete(code); continue; }
        if (!this.eligible(room) || !this.same(entry, room) || room.hostId !== entry.hostId) { this.stopRoom(room); continue; }
        for (const [id, solo] of [...this.solo]) {
          if (room.freeSeat() < 0) break;
          if (!this.accepts(solo, entry.version, entry.difficulty)) continue;
          const session = this.lobby.registry.byId(id);
          const joined = this.lobby.join(session, { code });
          if (joined.error) { this.send(session); continue; }
          this.solo.delete(id);
          this.found(session, room);
        }
        if (room.freeSeat() < 0) { this.stopRoom(room); for (const seat of room.activeHumans()) this.found(this.lobby.registry.byId(seat.playerId), room); }
        else this.roomState(room);
      }
      // [ASSUMED] One FIFO pool. Choose a room version before grouping, so wildcard entries never bridge incompatible exact requests.
      const entries = [...this.solo];
      for (const [anchorId, anchor] of entries) {
        if (!this.solo.has(anchorId)) continue;
        const available = this.versions(anchor.anyDifficulty ? null : anchor.difficulty);
        const compatible = entries.filter(([id]) => this.solo.has(id));
        // Exact constraints first, then the oldest player's preference, then stable server registry order.
        const versions = [...new Set([...compatible.filter(([, entry]) => !entry.anyVersion).map(([, entry]) => entry.version), anchor.version, ...available])];
        const difficulties = [...new Set([...compatible.filter(([, entry]) => !entry.anyDifficulty).map(([, entry]) => entry.difficulty), anchor.difficulty, ...DIFFICULTIES])];
        let group, version, difficulty;
        for (const candidate of versions) {
          if (!available.includes(candidate)) continue;
          for (const d of difficulties) {
            if (!this.lobby.offered(candidate, 'coop').includes(d) || !this.accepts(anchor, candidate, d)) continue;
            const players = compatible.filter(([, entry]) => this.accepts(entry, candidate, d)).slice(0, DEFAULT_SEATS);
            if (players.length === DEFAULT_SEATS) { group = players; version = candidate; difficulty = d; break; }
          }
          if (group) break;
        }
        if (!group) continue;
        const host = this.lobby.registry.byId(group[0][0]);
        const created = this.lobby.create(host, { mode: 'coop', difficulty, version });
        if (created.error) { this.solo.delete(host.playerId); sendSession(host, { t: 'match.state', status: 'idle', error: created.error }); continue; }
        const room = this.lobby.roomOf(host);
        if (!this.eligible(room)) { this.lobby.disposeRoom(room, 'empty'); sendSession(host, { t: 'room.closed', reason: 'empty' }); this.solo.delete(host.playerId); sendSession(host, { t: 'match.state', status: 'idle', error: ERR.BAD_TARGET }); continue; }
        this.solo.delete(host.playerId);
        for (const [playerId] of group.slice(1)) {
          const session = this.lobby.registry.byId(playerId);
          const joined = this.lobby.join(session, { code: room.code });
          if (!joined.error) this.solo.delete(playerId);
          else this.send(session);
        }
        for (const seat of room.activeHumans()) this.found(this.lobby.registry.byId(seat.playerId), room);
      }
    } finally { this.running = false; this.counts(); }
  }
  countFrame() {
    const byVersion = {}, anyVersion = { total: 0, byDifficulty: {} };
    const offered = Object.fromEntries((this.lobby.versions?.ids ?? [this.lobby.defaultVersion()])
      .filter(version => this.lobby.versionEnabled(version) && this.lobby.versionAvailable(version))
      .map(version => [version, this.lobby.offered(version, 'coop')]));
    if (getSocialSettings().counts) {
      for (const [id, entry] of this.solo) {
        const session = this.lobby.registry.byId(id);
        if (!session || !this.lobby.social.visible(session)) continue;
        const bucket = entry.anyVersion ? anyVersion : byVersion[entry.version] ||= { total: 0, byDifficulty: {} };
        bucket.total++;
        if (entry.anyDifficulty) bucket.anyDifficulty = (bucket.anyDifficulty || 0) + 1;
        else bucket.byDifficulty[entry.difficulty] = (bucket.byDifficulty[entry.difficulty] || 0) + 1;
      }
    }
    return { t: 'match.counts', features: { anyVersion: true, anyDifficulty: true }, offered, byVersion: getSocialSettings().counts ? byVersion : null, anyVersion: getSocialSettings().counts ? anyVersion : null };
  }
  counts() {
    const frame = this.countFrame();
    const key = JSON.stringify(frame);
    if (key === this.countKey) return;
    this.countKey = key;
    for (const session of this.lobby.registry.all()) if (session.connected) sendSession(session, frame);
  }
  hello(session) {
    this.send(session, true);
    sendSession(session, this.countFrame());
  }
  dispose() { clearInterval(this.timer); this.solo.clear(); this.parties.clear(); }
}
