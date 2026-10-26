// Host-only live game state and ordinary player intents. Never claims a game socket or battle authority.
// i18n-ignore-file: local Chinese host console.
import { randomBytes, createHash } from 'node:crypto';
import { validateC2S } from '../shared/protocol.js';
import { PHASE } from '../shared/constants.js';
import { recordReplayAdmin } from './match/replay.js';
import { snapFrame } from './match/fields.js';
import { DEFAULT_VERSION } from '../shared/versions.js';

const ids = new WeakMap();
export const matchId = (m) => {
  if (!ids.has(m)) ids.set(m, randomBytes(12).toString('hex'));
  return ids.get(m);
};
export const LIVE_INTENTS = new Set([
  'g.infoReady', 'g.band', 'g.bandSkip', 'g.bandFocus', 'g.buy', 'g.refresh', 'g.freeze', 'g.levelUp',
  'g.unequip', 'g.offer', 'g.offerRefresh', 'g.uniteSkipVote',
  'g.sell', 'g.move', 'g.equip', 'g.art', 'g.destroy', 'g.reward', 'g.choice', 'g.ready', 'g.autoplay', 'g.pause',
]);
const active = (lobby, code, pid) => {
  const room = lobby.rooms.get(String(code));
  if (!room) return { error: '房间不存在', code: 'NOT_IN_ROOM' };
  const m = room.match;
  if (!m || m.ended || m.disposed) return { error: '对局已结束或尚未开始，请返回控制台选择活动对局', code: 'WRONG_PHASE' };
  const ps = m.players.get(String(pid));
  if (!ps) return { error: '玩家不存在，请重新选择玩家', code: 'BAD_TARGET' };
  return { room, m, ps };
};
const revision = (m, ps) => createHash('sha256').update(JSON.stringify([
  m.round, m.phase, ps.privateView(), m.draft, m.sp, m.setupRevision,
])).digest('hex');

export function liveState(lobby, query) {
  const hosted = lobby.rooms.get(String(query.room))?.match;
  if (hosted?.hosted) return hosted.admin('live', query).then(result => ({ ...result, content: lobby.rooms.get(String(query.room))?.content || null, vanilla: lobby.vanilla?.cs || null }));
  const ctx = active(lobby, query.room, query.playerId);
  if (ctx.error) return ctx;
  const { m, ps, room } = ctx;
  if (query.statsSeq != null) {
    if (!/^\d{1,10}$/.test(query.statsSeq) || Number(query.statsSeq) > 2 ** 31) return { error: '属性请求格式错误', code: 'BAD_MSG' };
    return { ok: true, unitStats: { t: 'm.unitStats', seq: Number(query.statsSeq), round: m.round,
      units: [PHASE.PREP, PHASE.ROUND_START, PHASE.SP_DRAFT].includes(m.phase) && ps.alive ? m._unitStatsOf(ps) : [] } };
  }
  const id = matchId(m);
  // A viewing preference belongs to the console alone, never to the player's watchers map.
  const field = m.fields.find((f) => query.fieldId && f.fieldId === query.fieldId)
    || m.fields.find((f) => f.players.includes(ps.playerId))
    || (m.phase === PHASE.UNITE ? m.fields[0] : null);
  let battle = null, fieldMeta = null, snapshot = null;
  if (field?.cc) {
    if (query.battleId !== field.battleId || query.matchId !== id) {
      battle = { ...m._startMsg(field, ps.playerId), authoritative: false, watch: !field.players.includes(ps.playerId) };
    }
  } else if (field?.battle) {
    fieldMeta = { t: 'm.field', ...field.battle.fieldMeta(), fieldId: field.fieldId, kind: field.kind, live: !!field.live };
    snapshot = snapFrame(field.fieldId, field.battle.snapshot());
  } else if (query.fieldId?.startsWith('n:')) {
    const scout = m.players.get(query.fieldId.slice(2));
    if (scout?.alive && scout !== ps) fieldMeta = m.prepFieldMeta(scout);
  }
  return {
    ok: true, version: m.version || DEFAULT_VERSION, mode: m.mode, difficulty: m.difficulty,
    content: room.content || null, vanilla: lobby.vanilla?.cs || (!m.requireCs ? m.cs : null), matchId: id, revision: revision(m, ps), room: room.code, playerId: ps.playerId, name: ps.name,
    controllable: !ps.isBot && !ps.left && ps.alive,
    players: m.order.map((p) => ({ playerId: p.playerId, name: p.name, isBot: p.isBot, left: p.left, alive: p.alive })),
    public: m.publicView(), private: ps.privateView(), field: fieldMeta, snapshot, battle,
    battleId: field?.battleId || null,
    end: field?.cc && field.done ? { battleId: field.battleId, fieldId: field.fieldId, reason: field.result?.reason || 'forced' } : null,
    pool: m.bossPool ? { hp: Math.max(0, m.bossPool.hp), max: m.bossPool.maxHp, teamLp: m.teamLp,
      acked: Object.fromEntries(m.fields.filter((f) => f.cc).map((f) => [f.fieldId, f.bossAcked || 0])) } : null,
  };
}

export function liveIntent(lobby, body) {
  const hostedRoom = lobby.rooms.get(String(body?.room)), hosted = hostedRoom?.match;
  if (hosted?.hosted) return hosted.admin('intent', body).then(result => { hostedRoom.adminLog = hosted.adminLog; return result; });
  const ctx = active(lobby, body?.room, body?.playerId);
  if (ctx.error) return ctx;
  const { m, ps, room } = ctx;
  const msg = body?.intent;
  if (!msg || !LIVE_INTENTS.has(msg.t) || validateC2S(msg)) return { error: '不支持或格式错误的代操作指令', code: 'BAD_MSG' };
  if (body.matchId !== matchId(m) || body.round !== m.round || body.phase !== m.phase || body.revision !== revision(m, ps)) {
    return { error: '玩家状态或回合已变化，请等待画面刷新后重试', code: 'BAD_TARGET' };
  }
  if (ps.isBot || ps.left || !ps.alive) return { error: '该玩家当前只能查看', code: 'BAD_TARGET' };
  const result = m.handle(ps.playerId, msg);
  const event = { action: `代操作 ${msg.t}`, player: ps.name, value: msg, round: m.round };
  recordReplayAdmin(m, event);
  const log = room.adminLog ||= [];
  log.push({ ...event, at: Date.now(), ok: !!result.ok, error: result.error || null });
  if (log.length > 100) log.splice(0, log.length - 100);
  return result.error ? { ...result, code: result.error } : result;
}
