// i18n-ignore-file: local host diagnostics.
import fs from 'node:fs';
import path from 'node:path';

const LIMIT = 2000;
const MAX_BYTES = 2 * 1024 * 1024;

export function createAdminAudit({ lobby, file, log }) {
  let events = [], problem = null;
  try {
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size, length = Math.min(size, MAX_BYTES);
      const descriptor = fs.openSync(file, 'r');
      let text;
      try {
        const buffer = Buffer.alloc(length);
        fs.readSync(descriptor, buffer, 0, length, size - length);
        text = buffer.toString('utf8');
      } finally { fs.closeSync(descriptor); }
      const lines = text.split('\n');
      if (size > length) lines.shift();
      events = lines.flatMap((line) => {
        try { const value = JSON.parse(line); return value && typeof value === 'object' ? [value] : []; } catch { return []; }
      }).slice(-LIMIT);
    }
  } catch (error) { problem = `读取事件记录失败：${error.message}`; }

  function append(event) {
    const row = { at: Date.now(), ...event };
    events.push(row);
    if (events.length > LIMIT) events = events.slice(-LIMIT);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size >= MAX_BYTES) {
        const temporary = `${file}.tmp`;
        fs.writeFileSync(temporary, events.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
        fs.renameSync(temporary, file);
      } else fs.appendFileSync(file, JSON.stringify(row) + '\n');
      problem = null;
    } catch (error) {
      problem = `事件记录未能保存：${error.message}`;
      log?.error?.('[admin] event journal failed', error);
    }
  }

  const roomStates = new Map();
  function stateOf(room) {
    return {
      match: !!room.match,
      members: new Map([...(room.seats || []).filter(Boolean), ...(room.spectators || [])]
        .filter((seat) => !seat.isBot && !seat.left)
        .map((seat) => [seat.playerId, { name: seat.name || seat.playerId, connected: !!seat.connected }])),
    };
  }
  for (const room of lobby.rooms.values()) roomStates.set(room.code, stateOf(room));
  function observe(room, snapshot = null) {
    if (!room || room.disposed && !snapshot) return;
    const current = snapshot || stateOf(room), previous = roomStates.get(room.code);
    if (!previous) append({ room: room.code, type: 'room', message: '房间创建' });
    for (const [id, member] of current.members) {
      const old = previous?.members.get(id);
      if (!old) append({ room: room.code, type: 'presence', player: member.name, message: '进入房间' });
      else if (old.connected !== member.connected) append({ room: room.code, type: 'presence', player: member.name, message: member.connected ? '重新连接' : '连接断开' });
    }
    if (previous) for (const [id, member] of previous.members) {
      if (!current.members.has(id)) append({ room: room.code, type: 'presence', player: member.name, message: '离开房间' });
    }
    if (previous && !previous.match && current.match) append({ room: room.code, type: 'match', message: '对局开始' });
    roomStates.set(room.code, current);
  }

  const hooks = [];
  function wrap(name, callback) {
    const original = lobby[name];
    if (typeof original !== 'function') return;
    const owned = Object.hasOwn(lobby, name);
    const replacement = function (...args) {
      let snapshot = null;
      try { if (name === 'disposeRoom' && args[0] && !args[0].disposed) snapshot = stateOf(args[0]); }
      catch (error) { log?.error?.('[admin] event observation failed', error); }
      const result = original.apply(this, args);
      try { callback(...args, snapshot); } catch (error) { log?.error?.('[admin] event observation failed', error); }
      return result;
    };
    lobby[name] = replacement;
    hooks.push(() => { if (lobby[name] === replacement) { if (owned) lobby[name] = original; else delete lobby[name]; } });
  }
  wrap('broadcastState', (room) => observe(room));
  wrap('disposeRoom', (room, reason, snapshot) => {
    if (!room || !roomStates.has(room.code)) return;
    if (snapshot) observe(room, snapshot);
    append({ room: room.code, type: 'room', message: `房间关闭：${reason || '未知原因'}` });
    roomStates.delete(room.code);
  });

  return {
    append,
    list(room = '') { return { events: events.filter((entry) => !room || entry.room === room).slice().sort((left, right) => (right.at || 0) - (left.at || 0)), problem, limit: LIMIT }; },
    clear() {
      const count = events.length;
      fs.rmSync(file, { force: true });
      events = []; problem = null;
      return count;
    },
    close() { for (const undo of hooks.reverse()) undo(); },
  };
}
