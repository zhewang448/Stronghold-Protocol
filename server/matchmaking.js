// [ASSUMED] Opt-in local matching: same official version/difficulty, four seats, no automatic start or AI fill.
// Reuses Lobby.create/join; existing parties stay together and explicitly request solo recruits.
import { DEFAULT_SEATS, ERR } from '../shared/constants.js';
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
      && room.aiPicksLast === true && !room.aiTakeoverEnabled && !room.uniteLayerGains
      && Object.entries(CONVENIENCE_DEFAULTS).every(([key, value]) => room.convenience[key] === value);
  }
  same(a, b) { return a.version === b.version && a.difficulty === b.difficulty; }
  state(session) {
    const room = this.lobby.roomOf(session);
    const entry = this.solo.get(session.playerId) || (room && this.parties.get(room.code));
    return entry ? { t: 'match.state', status: 'searching', version: entry.version, difficulty: entry.difficulty,
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
    if (!this.lobby.versionAvailable(version) || !this.lobby.offered(version, 'coop').includes(msg.difficulty)) return fail(ERR.VERSION_UNSUPPORTED);
    const existing = this.solo.get(session.playerId);
    if (room) {
      if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
      if (!this.eligible(room) || room.version !== version || room.difficulty !== msg.difficulty) return fail(ERR.BAD_TARGET);
      const previous = this.parties.get(room.code);
      if (!previous) {
        const entry = { version, difficulty: room.difficulty, startedAt: this.lobby.now(), hostId: room.hostId };
        this.parties.set(room.code, entry); room.matching = entry;
        this.lobby.broadcastState(room);
      }
      this.roomState(room);
    } else {
      if (existing && !this.same(existing, { version, difficulty: msg.difficulty })) this.cancel(session);
      if (!this.solo.has(session.playerId)) this.solo.set(session.playerId, { version, difficulty: msg.difficulty, startedAt: this.lobby.now() });
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
          if (!this.same(solo, entry)) continue;
          const session = this.lobby.registry.byId(id);
          const joined = this.lobby.join(session, { code });
          if (joined.error) { this.send(session); continue; }
          this.solo.delete(id);
          this.found(session, room);
        }
        if (room.freeSeat() < 0) { this.stopRoom(room); for (const seat of room.activeHumans()) this.found(this.lobby.registry.byId(seat.playerId), room); }
        else this.roomState(room);
      }
      const buckets = new Map();
      for (const pair of this.solo) {
        const key = pair[1].version + '/' + pair[1].difficulty;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(pair);
      }
      for (const entries of buckets.values()) for (let offset = 0; offset + DEFAULT_SEATS <= entries.length; offset += DEFAULT_SEATS) {
        const group = entries.slice(offset, offset + DEFAULT_SEATS), first = group[0][1];
        const host = this.lobby.registry.byId(group[0][0]);
        const created = this.lobby.create(host, { mode: 'coop', difficulty: first.difficulty, version: first.version });
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
    const byVersion = {};
    if (getSocialSettings().counts) {
      for (const [id, entry] of this.solo) {
        const session = this.lobby.registry.byId(id);
        if (!session || !this.lobby.social.visible(session)) continue;
        const bucket = byVersion[entry.version] ||= { total: 0, byDifficulty: {} };
        bucket.total++; bucket.byDifficulty[entry.difficulty] = (bucket.byDifficulty[entry.difficulty] || 0) + 1;
      }
    }
    return { t: 'match.counts', byVersion: getSocialSettings().counts ? byVersion : null };
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
