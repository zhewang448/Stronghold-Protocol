import { createResultSummary } from './result-summary.js';
import { wallView } from './admin-wall.js';
import { roomRules, resultRules, battleView, stockView, lobbyBlockers, matchWaiting, diagnosticEvents } from './admin-observability.js';
import { createAdminAudit } from './admin-audit.js';
import { createResources } from './resources.js';
import { createIdleUpdater } from './idle-update.js';
import { readReleaseNotes } from './release-notes.js';
import { listBackups, configureBackups, deleteBackup } from './update-backups.js';
// server/admin.js — the host's local console (server/admin.html): rooms, matches and players at a glance, plus host
// actions — 回到第 N 回合休整期 (./match/rewind.js), funds, LP, shop level, free refreshes, operator / item grants, bond
// layers and count bonuses, 托管, effects and 机变 cards, board edits, the enemy schedule (any composition for the current round before combat or any later
// round, ./match/enemyPicks.js), forcing a battle's
// result, the timer scale, ending the prep or the match, closing a room. Statistics: the per-round record
// (./match/history.js), every player's running totals, the console's own action log (room.adminLog), and each finished
// match saved as logs/results/<time>-<room>.json (startAdmin wraps lobby.onMatchEnd) for the 对局记录 page. Settings:
// the 休整期 timer and optional 联防 layer gains for every room and match (./match/hostSettings.js), kept in
// logs/admin-settings.json.
//
// Reachable from this computer only: it listens on 127.0.0.1 (the LAN and a cloudflared tunnel to the game port never
// reach it), every /api request carries the per-process token embedded in the page, and the Host header must be the
// console's own localhost address (another site open in the host's browser cannot drive it, no DNS rebinding).
//
//   SP_ADMIN_PORT  default PORT + 100 (3100); SP_ADMIN=0 turns the console off (server/http/boot.js runMain).
//
// i18n-ignore-file: a host-only tool in Chinese, not player UI (tools/i18n.mjs)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PHASE, PHASE_NAMES, BOND_LAYER_CAP, GEO } from '../shared/constants.js';
import { rewindToPrep } from './match/rewind.js';
import { boardOrder } from './match/board.js';
import { applyCard, tacticCard } from './match/choices.js';
import { buildNormalWave, buildBossWave } from './match/waves.js';
import { planView, setPick, waveSource } from './match/enemyPicks.js';
import { syntheticResult } from './match/fields.js';
import { GameData } from './match/gamedata.js';
import { getPrep, setPrep, normalizePrep, getUniteLayerGains, setUniteLayerGains, getRoundCharts, setRoundCharts, getLiveRoundDamage, setLiveRoundDamage } from './match/hostSettings.js';
import { getAllowRoomUniteLayerGains, setAllowRoomUniteLayerGains } from './match/hostSettings.js';
import { getShowPwaInstall, setShowPwaInstall } from './match/hostSettings.js';
import { getAllowAiTakeover, setAllowAiTakeover } from './match/hostSettings.js';
import { resetAiTakeover } from './aiTakeover.js';
import { readPersonalDataConfig, writePersonalDataConfig } from './http/personalDataConfig.js';
import { AnnouncementDrafts } from './announcement-drafts.js';
import { getSocialSettings, setSocialSettings, normalizeSocialSettings } from './match/hostSettings.js';
import { DEFAULT_SOCIAL_SETTINGS } from '../shared/social.js';
import { diyCatalog, grantDiy } from './match/adminDiy.js';
import { createReleaseUpdater } from './release-update.js';
import { gzipSync } from 'node:zlib';
import { createStaticHandler } from './http/static.js';
import { getReplayConfig, setReplayConfig, replayRecord, recordReplayAdmin } from './match/replay.js';
import { replayIdentity, saveReplay, readReplay, replayFiles, recordFiles, deleteRecordFiles, replayAdminLogs, REPLAY_ID } from './replay-store.js';
import { liveState, liveIntent, matchId } from './admin-live.js';
import { DEV_PAGES } from '../shared/devtools.js';
import { sendSession, send as sendSocket } from './net.js';
import { cleanChatText, getBlockedWords, normalizeBlockedWords, setBlockedWords, getChatSettings, normalizeChatSettings, setChatSettings, DEFAULT_CHAT_SETTINGS } from './chat.js';

import { DEFAULT_VERSION } from '../shared/versions.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OK = { ok: true };
const int = (v) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null);
const obj = (v) => (v && typeof v === 'object' ? v : {});
const BEFORE_COMBAT = new Set([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP]);
const LOG_KEPT = 100;
const RECORD_ID = /^[\w-]+\.json$/;

/** The 机变 cards a grant can name: tactic cards with an effect (terrain only for the match's stage), bounty cards. */
function cardList(m) {
  const gd = m.gd;
  const cards = gd.choices.cards || {};
  return [
    ...(cards.tactic || []).filter((c) => c && gd.effect(c.effectId) && (c.kind !== 'terrain' || c.stageId === m.stageId))
      .map((c) => ({ id: c.effectId, name: c.name, kind: 'tactic', team: !!c.team, src: c })),
    ...(cards.bounty || []).filter((c) => c && gd.enemy(c.enemyKey)).map((c) => ({ id: c.effectId, name: c.name, kind: 'bounty', team: false, src: c })),
  ];
}

/** Bonds, effects, board and coming enemies of one player (the console's 详情 panel). */
function playerDetail(m, ps) {
  // the player's own data view: a 自选编队 slot reads as its picked operator (server/match/player/diy.js)
  const gd = ps.gd || m.gd;
  const nameOf = (p) => {
    const rec = p.kind === 'chess' ? (ps.fieldsStandIn?.(p.id) ? gd.standIn(p.id) : null) || gd.chess(p.id)
      : p.kind === 'item' ? gd.item(p.id) : gd.token(p.id);
    return rec ? rec.name : p.id;
  };
  const pieceView = (p, where) => ({
    uid: p.uid, kind: p.kind, where, name: nameOf(p), count: p.kind === 'token' ? p.count || 1 : null,
    golden: p.kind === 'chess' && gd.isGolden(p.id), canPromote: p.kind === 'chess' && !gd.isGolden(p.id) && !!gd.goldenIdOf(p.id),
    items: (p.items || []).map((it) => ({ uid: it.uid, name: nameOf(it) })),
  });
  const pieces = [];
  for (const { r, c, piece } of boardOrder(ps.board)) pieces.push(pieceView(piece, `作战区 ${r - GEO.FIELD.r0 + 1}-${c - GEO.FIELD.c0 + 1}`));
  ps.hand.forEach((p, i) => { if (p) pieces.push(pieceView(p, `手牌 ${i + 1}`)); });
  ps.temp.forEach((p, i) => { if (p) pieces.push(pieceView(p, `整备区 ${i + 1}`)); });
  let enemies = [];
  try {
    enemies = m.nextEnemiesFor(ps).map((e) => ({ name: gd.enemy(e.enemyKey)?.name || e.enemyKey, count: e.count, elite: !!e.elite, boss: !!e.boss, fly: !!e.fly, bounty: e.source === 'bounty' }));
  } catch { /* the preview is informational */ }
  return {
    bonds: gd.bondIds.filter((id) => !gd.modeInactiveBonds.has(id)).map((id) => {
      const b = ps.bonds[id] || {};
      return { id, name: gd.bond(id).name, noStack: !!gd.bond(id).noStack, count: b.count || 0, thresholds: gd.bond(id).thresholds || [], active: !!b.active, layers: ps.layers[id] || 0, bonus: ps.bondCountBonus[id] || 0 };
    }),
    effects: ps.effects.map((e) => ({ id: e.id, name: e.name || e.key || e.id, desc: e.desc || '', counter: e.counter ?? null })),
    bounties: ps.bounties.map((b) => ({ id: b.id, name: b.card.name, desc: b.card.desc, roundsLeft: b.roundsLeft })),
    pieces,
    enemies,
  };
}

export function matchView(m) {
  return {
    matchId: matchId(m), version: m.version || DEFAULT_VERSION, cs: m.cs || null,
    phase: m.phase, phaseName: PHASE_NAMES[m.phase] || m.phase, round: m.round, ended: m.ended, paused: m.paused, solo: m.isSolo,
    left: m.deadline ? Math.max(0, Math.round((m.deadline - m.sched.now()) / 1000)) : null,
    rewindRounds: [...m.prepSnapshots.keys()].sort((a, b) => a - b), errors: m.errorCount,
    errorCounts: { match: m.errorCount || 0, effects: m.dispatcher?.errors || 0, simulation: m.simErrors || 0 },
    recentErrors: [
      ...(m.errors || []).slice(-5).map(({ label, message }) => ({ label, message })),
      ...[...(m.dispatcher?.errorsByKey || [])].slice(-3).map(([message, detail]) => ({ label: `效果错误（${detail.count} 次）`, message })),
      ...[...(m.simErrorLog?.values() || [])].slice(-3).map(({ label, message }) => ({ label, message })),
    ],
    battles: battleView(m), waiting: matchWaiting(m),
    timerScale: m.timerScale, prep: m.prepOverride ?? getPrep(), prepInherited: m.prepOverride == null,
    enemyPlan: planView(m, BEFORE_COMBAT.has(m.phase)),
    fields: m.fields.filter((f) => f.cc && !f.done).map((f) => ({ id: f.fieldId, kind: f.kind, players: f.players.map((pid) => m.players.get(pid)?.name || pid) })),
    poolGroups: (m.poolGroups || []).map(({ id, playerIds }) => ({ id, playerIds })),
    players: m.order.map((ps) => ({
      id: ps.playerId, seat: ps.seat, name: ps.name, bot: ps.isBot, connected: ps.connected && !ps.left, alive: ps.alive, ready: ps.ready,
      lp: ps.lp, funds: ps.funds, level: ps.shop.level, freeRefreshes: ps.shop.freeRefreshes || 0,
      board: ps.board.size, hand: ps.hand.filter(Boolean).length, autoplay: !!ps.autoplay,
      bondPlan: ps.bondPlan ? m.gd.bond(ps.bondPlan)?.name || ps.bondPlan : null,
      stats: statsOf(ps),
      ...playerDetail(m, ps),
    })),
    history: m.history || [],
  };
}

/** A player's running totals (PlayerState stats; `gold` = funds spent). */
function statsOf(ps) {
  const s = ps.stats;
  let layers = 0;
  try { layers = ps.activatedLayers(); } catch { /* informational */ }
  return {
    dmgDealt: Math.round(s.dmgDealt), kills: s.kills, leaks: s.leaks, perfectRounds: s.perfectRounds, lpLost: s.lpLost,
    fundsGained: s.fundsGained, gold: s.gold, buys: s.buys, sells: s.sells, refreshes: s.refreshes, merges: s.merges,
    itemsEquipped: s.itemsEquipped, healing: Math.round(s.healing || 0), bossDamage: Math.round(s.bossDamage), activatedLayers: layers,
  };
}

/** Connection state belongs to the lobby; a match host may still be processing its socket event. */
function playerAccess(lobby, player) {
  return { ...player, accessDomain: player.bot ? null : lobby.registry?.byId?.(player.id)?.accessDomain ?? null };
}

function roomPresence(room, match, lobby) {
  if (!match?.players) return match;
  const seats = new Map(room.seats.filter(Boolean).map(seat => [seat.playerId, seat]));
  return { ...match, players: match.players.map(player => {
    const seat = seats.get(player.id);
    return playerAccess(lobby, seat ? { ...player, connected: !!(seat.isBot || (seat.connected && !seat.left)) } : player);
  }) };
}

/** GET /api/rooms */
export function roomsView(lobby) {
  if ([...lobby.rooms.values()].some(r => r.match?.hosted)) {
    return Promise.all([...lobby.rooms.values()].map(async room => {
      const view = roomsView({ registry: lobby.registry, rooms: new Map([[room.code, { ...room, match: room.match?.hosted ? null : room.match }]]) })[0];
      if (room.match?.hosted) { view.match = roomPresence(room, await room.match.admin('view'), lobby); view.blockers = []; }
      return view;
    }));
  }
  return [...lobby.rooms.values()].map((r) => ({
    code: r.code, mode: r.mode, difficulty: r.difficulty, version: r.version || DEFAULT_VERSION, content: r.content || null,
    hostId: r.hostId || null, private: !!r.private, capacity: r.capacity ?? r.seats.length, rules: roomRules(r), blockers: lobbyBlockers(r),
    seats: r.seats.filter(Boolean).map((s) => playerAccess(lobby, { id: s.playerId, seat: s.seat, left: !!s.left, muted: !!r.chat?.muted.has(s.playerId), name: s.name, bot: s.isBot, connected: s.connected && !s.left,
      ready: typeof s.ready === 'boolean' ? s.ready : null, content: r.needsContent && !s.isBot ? s.content || 'loading' : null })),
    spectators: (r.spectators || []).map((s) => playerAccess(lobby, { id: s.playerId, name: s.name, connected: s.connected })),
    chat: r.chat?.history(r.code) || { messages: [] },
    match: r.match && r.match.order ? roomPresence(r, matchView(r.match), lobby) : null,
    // the room's last ended match, while no new one runs: its statistics stay on the room card
    lastMatch: r.match ? null : r.adminLastMatch || null,
    log: r.adminLog || [],
  }));
}

async function actionState(room, playerId) {
  const match = room?.match;
  if (!match) return null;
  const view = match.hosted ? await match.admin('view') : matchView(match);
  if (!view || view.error) return null;
  const player = (view.players || []).find((entry) => entry.id === playerId);
  return { matchId: view.matchId, round: view.round, phase: view.phase,
    player: player ? { name: player.name, lp: player.lp, funds: player.funds, level: player.level,
      freeRefreshes: player.freeRefreshes, autoplay: player.autoplay, bonds: player.bonds,
      pieces: player.pieces, effects: player.effects, bounties: player.bounties } : null };
}

function actionChanges(before, after) {
  if (!before) return { before: null, after: null };
  if (!after || before.matchId !== after.matchId) return { before, after: { state: '对局已结束或切换' } };
  const left = {}, right = {};
  for (const key of ['round', 'phase']) if (before[key] !== after[key]) { left[key] = before[key]; right[key] = after[key]; }
  for (const key of ['lp', 'funds', 'level', 'freeRefreshes', 'autoplay', 'bonds', 'pieces', 'effects', 'bounties']) {
    if (JSON.stringify(before.player?.[key]) !== JSON.stringify(after.player?.[key])) {
      left[key] = before.player?.[key] ?? null; right[key] = after.player?.[key] ?? null;
    }
  }
  return { before: left, after: right };
}

/** GET /api/catalog?room= — what a grant can name, for the running match's mode. */
export function catalogView(lobby, code) {
  const m = lobby.rooms.get(String(code))?.match;
  if (m?.hosted) return m.admin('catalog');
  if (!m || !m.gd) return { chess: [], items: [] };
  const gd = m.gd;
  return {
    matchId: matchId(m), version: m.version || DEFAULT_VERSION, cs: m.cs || null,
    chess: gd.visibleChess.map((id) => {
      const c = gd.chess(id);
      return { id, name: c.name, tier: c.tier, goldenId: c.goldenId && gd.chess(c.goldenId) ? c.goldenId : null };
    }),
    items: Object.values(gd.shopItemsByTier).flat().map((id) => ({ id, name: gd.item(id).name, tier: gd.item(id).tier, equip: gd.item(id).itemType === 'EQUIP' })),
    cards: cardList(m).map(({ src, ...c }) => c),
    diy: diyCatalog(m),
  };
}

function itemStockConfirmation(m, ps, id, force) {
  return !m.itemPoolFor(ps).canGain(id) && !force ? {
    error: `「${m.gd.item(id).name}」装备库存不足，是否强制加入？强制加入后仍占用库存，商店可用量最低为 0。`,
    code: 'ITEM_STOCK_CONFIRM',
  } : null;
}

// Player actions: (m, ps, value) → OK | { error }. They change the state directly (no shop price, no onLevelUp effects).
const PLAYER_ACTIONS = {
  funds: (m, ps, v) => {
    const n = int(v);
    if (n == null) return { error: '请输入整数' };
    ps.addFunds(n, { reason: 'admin' });
    return OK;
  },
  lp: (m, ps, v) => {
    const n = int(v);
    if (n == null || n < 0) return { error: '请输入 ≥ 0 的整数' };
    ps.lp = n;
    ps.dirty();
    return OK;
  },
  level: (m, ps, v) => {
    const n = int(v);
    if (n == null || n < 1 || n > m.gd.maxShopLevel) return { error: `商店等级范围 1–${m.gd.maxShopLevel}` };
    ps.shop.level = n;
    ps.shop.upgradePrice = m.gd.upgradeBase(n) ?? 0;
    ps.recompute();
    ps.dirty();
    return OK;
  },
  refresh: (m, ps) => {
    ps.shop.freeRefreshes = (ps.shop.freeRefreshes || 0) + 1;
    ps.dirty();
    return OK;
  },
  chess: (m, ps, v) => {
    const rec = ps.gd.chess(String(v));
    if (!rec) return { error: `没有这个干员：${v}` };
    if (rec.isDiy && !rec.diyFor) return { error: '这个自选位没有干员，请用「发放自选」' };
    return ps.acquireChess(String(v)) ? OK : { error: '手牌和整备区都满了' };
  },
  // value { charId, tier: 5 | 6, elite?, skillIndex?, uniEquipId? } — any kitted 自选 operator, picks or not (match/adminDiy.js)
  diy: (m, ps, v) => grantDiy(m, ps, obj(v)),
  // the same value: only the skill / module of the slot that holds the operator (its pieces change with it)
  diySkill: (m, ps, v) => grantDiy(m, ps, { ...obj(v), grant: false }),
  item: (m, ps, v) => {
    const id = String(typeof v === 'object' && v ? v.id : v);
    const rec = m.gd.item(id);
    if (!rec) return { error: `没有这个道具：${id}` };
    const force = obj(v).force === true;
    const confirmation = itemStockConfirmation(m, ps, id, force);
    if (confirmation) return confirmation;
    return ps.acquireItem(id, { source: 'admin', forceStock: force }) ? OK : { error: '手牌和整备区都满了' };
  },

  // ---- bonds: value { bond, n }
  bondAdd: (m, ps, v) => {
    const { bond } = obj(v);
    const n = int(obj(v).n);
    if (!bondOk(m, bond)) return { error: `本模式没有这个盟约：${bond}` };
    if (n == null || n < 1) return { error: '请输入 ≥ 1 的整数' };
    // the game's own gain: recompute + onLayers, like any layer gain
    return ps.addLayers(bond, n, { reason: 'admin' }) > 0 ? OK : { error: `已到上限 ${BOND_LAYER_CAP}` };
  },
  bondSet: (m, ps, v) => {
    const { bond } = obj(v);
    const n = int(obj(v).n);
    if (!bondOk(m, bond)) return { error: `本模式没有这个盟约：${bond}` };
    if (n == null || n < 0 || n > BOND_LAYER_CAP) return { error: `层数范围 0–${BOND_LAYER_CAP}` };
    ps.layers[bond] = n;
    ps.recompute();
    return OK;
  },
  bondBonus: (m, ps, v) => {
    const { bond } = obj(v);
    const n = int(obj(v).n);
    if (!bondOk(m, bond)) return { error: `本模式没有这个盟约：${bond}` };
    if (n == null || Math.abs(n) > 99) return { error: '人数加成范围 −99–99' };
    // as effectsMeta setBondCountBonus
    if (n === 0) delete ps.bondCountBonus[bond];
    else ps.bondCountBonus[bond] = n;
    ps.recompute();
    return OK;
  },

  autoplay: (m, ps, v) => {
    if (ps.isBot) return { error: 'AI 座位不需要托管' };
    return m.setAutoplay(ps, v === true || v === '1' || v === 1);
  },

  // ---- effects and 机变 cards
  effectRemove: (m, ps, v) => {
    const i = ps.effects.findIndex((e) => e.id === String(v));
    if (i < 0) return { error: '效果不存在' };
    ps.effects.splice(i, 1); // as effectsMeta removeEffect
    ps.dirty();
    return OK;
  },
  bountyRemove: (m, ps, v) => {
    const n = ps.bounties.length;
    ps.bounties = ps.bounties.filter((b) => b.id !== String(v));
    if (ps.bounties.length === n) return { error: '悬赏不存在' };
    ps.dirty();
    return OK;
  },
  card: (m, ps, v) => {
    const c = cardList(m).find((x) => x.id === String(v));
    if (!c) return { error: `没有这张机变卡：${v}` };
    if (c.kind === 'bounty') return m.addBounty(ps, c.src) ? OK : { error: '悬赏的敌人不存在' };
    // a team card reaches every alive teammate too (applyCard)
    applyCard(m, ps, { ...tacticCard(c.src), family: 'tactic' });
    return OK;
  },

  // ---- board (any phase; no funds, no onSold)
  pieceRemove: (m, ps, v) => {
    const loc = ps.find(int(v));
    if (!loc) return { error: '棋子不存在' };
    const piece = loc.piece;
    if (piece.kind !== 'chess') {
      ps._detach(loc);
      ps.recompute();
      return OK;
    }
    // sell() without the gain: its equipment back to the hand / temp, its summons and pool copies gone
    const room = ps.hand.filter((x) => x == null).length + ps.temp.filter((x) => x == null).length + (loc.area === 'hand' || loc.area === 'temp' ? 1 : 0);
    if ((piece.items || []).length > room) return { error: '手牌和整备区放不下它的装备' };
    ps._detach(loc);
    ps.removeTokensOf(piece.uid);
    for (const it of piece.items || []) ps.stow(it, { allowTemp: true });
    piece.items = [];
    ps.returnCopies(piece);
    ps.checkItemMerges();
    ps.recompute();
    return OK;
  },
  piecePromote: (m, ps, v) => {
    const loc = ps.find(int(v));
    if (!loc || loc.piece.kind !== 'chess') return { error: '不是干员' };
    if (m.gd.isGolden(loc.piece.id)) return { error: '已经是精锐' };
    return ps.promote(loc.piece) ? OK : { error: '这个干员没有精锐形态' };
  },
  // value { target: uid, item: itemId }: a new copy of the item, equipped whatever the phase (equip()'s non-consumable branch)
  pieceEquip: (m, ps, v) => {
    const tloc = ps.find(int(obj(v).target));
    if (!tloc || tloc.piece.kind !== 'chess' || tloc.area === 'equipped') return { error: '目标不是干员' };
    const id = String(obj(v).item);
    const rec = m.gd.item(id);
    if (!rec || rec.itemType !== 'EQUIP') return { error: `不是装备：${id}` };
    if (typeof rec.kind === 'string' && rec.kind.startsWith('consume_on_equip')) return { error: '消耗型装备请用「发放道具」，再在游戏里使用' };
    const force = obj(v).force === true;
    const confirmation = itemStockConfirmation(m, ps, id, force);
    if (confirmation) return confirmation;
    const item = ps.newPiece('item', id);
    const pool = m.itemPoolFor(ps);
    if (force && !pool.canGain(id)) item.adminStockCopies = pool.need(id);
    // an owned twin completes a merge: the elite item goes to the hand, as equip() does
    if (ps.completesItemMerge(id) && ps._mergeItem(id, item)) { ps.recompute(); return OK; }
    ps._attach(tloc.piece, item);
    m.dispatchItem(ps, item, tloc.piece, 'onEquip', { item, target: tloc.piece, golden: !!rec.isGolden, consumed: false });
    ps.checkItemMerges();
    ps.recompute();
    return OK;
  },
};

function bondOk(m, id) {
  return typeof id === 'string' && !!m.gd.bond(id) && !m.gd.modeInactiveBonds.has(id);
}

/**
 * Force a client-combat field's result (value { field, n? }). Normal field: win = perfect, lose = `n` counted leaks of
 * the field's own enemy (settle charges min(lpCapPerRound, n); in co-op they re-enter 联防 like real leaks). 联防: win =
 * every leaked enemy killed (a non-synthetic empty result), lose = nobody helped (synthetic: settle charges the leakers'
 * own leaks). Boss: win empties the shared pool, lose sets the team LP to 0; either ends every boss field.
 */
function forceField(m, v, win) {
  const f = m.fields.find((x) => x.fieldId === String(obj(v).field));
  if (!f) return { error: '战场不存在（可能已经结束）' };
  if (!f.cc) return { error: '只支持客户端战斗模式' };
  if (f.done) return { error: '这场已经结束' };
  if (f.kind === 'boss' || f.kind === 'hidden') {
    if (!m.bossPool) return { error: '没有领袖战' };
    for (const field of m.fields) field.replayForced = true;
    if (win) m.bossPool.hp = 0;
    else { m.teamLp = 0; m._syncTeamLp(); }
    m.markPublic();
    m._checkFinalEnd();
    return OK;
  }
  const res = syntheticResult(f.players);
  if (f.kind === 'unite') {
    if (win) res.synthetic = false;
  } else if (!win) {
    const n = int(obj(v).n);
    if (n == null || n < 1) return { error: '请输入 ≥ 1 的漏怪数' };
    const spawn = ((f.spec && f.spec.spawns) || []).find((s) => s && m.gd.enemy(s.enemyKey));
    for (const pid of f.players) Object.assign(res.perPlayer[pid], { perfect: false, leaked: Array.from({ length: n }, () => ({ enemyKey: spawn ? spawn.enemyKey : null, counted: true })) });
  }
  m._clearFieldTimers(f);
  f.replayForced = true;
  f.result = res;
  // as _endFinal: the browsers showing it drop the battle (a late b.result names a done field and is ignored)
  for (const pid of m._humansShowing(f)) m.sendTo(pid, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason: 'forced' });
  m._fieldDone(f);
  return OK;
}

const MATCH_ACTIONS = {
  rewind: (m, v) => {
    const r = rewindToPrep(m, v === '' ? null : v);
    if (r.ok) for (const ps of m.order) m.toast(ps, 'warn', `主机已回档到第 ${r.round} 回合休整期开始`);
    return r;
  },
  endPrep: (m) => {
    if (m.phase !== PHASE.PREP) return { error: '当前不在休整期' };
    m.prepDeadline();
    return OK;
  },
  pause: (m, v) => m.setPause(null, v === true || v === '1' || v === 1),
  // value { round, id }: round's composition (an enemyPicks combo id; '' = back to the match's own pick). A later round
  // takes it when it starts; the current round's wave is rebuilt now, while its combat has not started (the wave
  // builders draw nothing from rngWaves for a scheduled pick). A rewind restores the overrides of its prep.
  enemyPick: (m, v) => {
    const res = setPick(m, obj(v).round, obj(v).id, BEFORE_COMBAT.has(m.phase));
    if (!res.ok) return res;
    if (res.current) {
      const r = m.round;
      if (r === m.gd.bossRound || r === m.gd.hiddenRound) {
        // as _planBossWaves, on the fields' own pairing
        const bossId = r === m.gd.hiddenRound && r !== m.gd.bossRound ? m.hiddenBossId : m.bossId;
        m.bossWaves = (m.bossWaves || []).map((w) => ({ ...w, wave: buildBossWave(m.gd, m.rngWaves, waveSource(m), r, { bossId, solo: m.isSolo || w.players.length === 1 }) }));
      } else m.wave = buildNormalWave(m.gd, m.rngWaves, waveSource(m), r);
      for (const ps of m.order) ps.dirty(); // m.private.nextEnemies
      m.markPublic();
    }
    return OK;
  },
  battleWin: (m, v) => forceField(m, v, true),
  battleLose: (m, v) => forceField(m, v, false),
  // Legacy action name: now changes prep only, like the standing console settings.
  timerScale: (m, v) => {
    const n = Number(v);
    if (!(n >= 0.1 && n <= 10)) return { error: '倍率范围 0.1–10' };
    m.prepOverride = { mode: 'scale', scale: n };
    return OK;
  },
  prepTimer: (m, v) => {
    if (v === null) { m.prepOverride = null; return OK; }
    const r = normalizePrep(v);
    if (r.error) return r;
    m.prepOverride = r.prep;
    return OK;
  },
  endMatch: (m) => {
    m.finish({ victory: false, reason: 'admin' });
    return OK;
  },
};

/** POST /api/action { room, action, playerId?, value? } → { ok } | { error, detail? }; kept in the room's action log. */
export function handleAction(lobby, body) {
  const { room: code, action, playerId, value } = body || {};
  if (action === 'announce') return lobby.announcements.set(value);
  const room = lobby.rooms.get(String(code));
  if (!room) return { error: '房间不存在' };
  if (room.match?.hosted && (Object.hasOwn(MATCH_ACTIONS, action) || Object.hasOwn(PLAYER_ACTIONS, action))) {
    const match = room.match;
    return match.admin('action', body).then(result => { room.adminLog = match.adminLog; return result; });
  }
  if (body.catalogIdentity && (!room.match || body.catalogIdentity !== JSON.stringify([matchId(room.match), room.match.version || DEFAULT_VERSION, room.match.cs || null]))) {
    return { error: '发放目录对应的对局已变化，请刷新后重试', code: 'BAD_TARGET' };
  }
  if (body.catalogIdentity && ['chess', 'diy', 'item', 'card', 'pieceEquip'].includes(action)) {
    const catalog = catalogView(lobby, code);
    const id = String(action === 'pieceEquip' ? obj(value).item : typeof value === 'object' ? obj(value).id : value);
    const allowed = action === 'chess' ? catalog.chess.some(c => c.id === id || c.goldenId === id)
      : action === 'diy' ? catalog.diy.some(c => c.charId === obj(value).charId && c.tier === obj(value).tier)
      : action === 'card' ? catalog.cards.some(c => c.id === id)
      : catalog.items.some(c => c.id === id && (action !== 'pieceEquip' || c.equip));
    if (!allowed) return { error: '该条目不属于当前发放目录，请重新选择', code: 'BAD_TARGET' };
  }
  // the player's name as it was when the action ran (before the action: a closed room has no log to keep)
  const player = room.match?.players?.get(String(playerId)) || room.seatOf?.(playerId) || room.spectatorOf?.(playerId);
  if (room.match?.order) recordReplayAdmin(room.match, { action: String(action), player: player?.name || null, value, round: room.match.round });
  const res = runAction(lobby, room, action, playerId, value);
  if (action !== 'closeRoom') {
    let v = value == null || value === '' ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    if (v.length > 120) v = v.slice(0, 117) + '…';
    const log = room.adminLog || (room.adminLog = []);
    log.push({ at: Date.now(), round: room.match ? room.match.round : null, action: String(action), player: player ? player.name : null, value: v, ok: !!res.ok, error: res.ok ? null : res.error });
    if (log.length > LOG_KEPT) log.splice(0, log.length - LOG_KEPT);
  }
  return res;
}

function runAction(lobby, room, action, playerId, value) {
  if (action === 'chatSend') {
    const text = cleanChatText(value);
    if (!text) return { error: '消息不能为空，且最多 200 字 / 1024 字节' };
    const message = room.chat.message(room, { playerId: 'host', name: '主机', seat: null }, text, lobby.now());
    message.role = 'system';
    lobby.broadcastRoom(room, message);
    return OK;
  }
  if (action === 'chatClear') {
    room.chat.clearMessages();
    lobby.broadcastRoom(room, room.chat.history(room.code));
    return OK;
  }
  if (action === 'chatMute') {
    const seat = room.seatOf(playerId);
    if (!seat || seat.isBot || seat.left) return { error: '玩家不存在' };
    if (typeof value !== 'boolean') return { error: '禁言状态须为布尔值' };
    if (value) room.chat.muted.add(playerId); else room.chat.muted.delete(playerId);
    return OK;
  }
  if (action === 'chatKick') {
    const seat = room.seatOf(playerId) || room.spectatorOf(playerId);
    if (!seat || seat.isBot || seat.left) return { error: '玩家或观战者不存在' };
    const target = lobby.registry.byId(playerId), replay = lobby.replayFor(room, playerId);
    lobby.removeMember(room, playerId);
    if (target) {
      if (target.connected) sendSession(target, { t: 'room.closed', reason: 'kicked' });
      else { target.notice = 'kicked'; target.pendingResult = replay; }
    }
    return OK;
  }
  if (action === 'closeRoom') {
    lobby.disposeRoom(room, '控制台关闭');
    return OK;
  }
  const m = room.match;
  if (!m || !m.order) return { error: '房间还没开局' };
  if (m.ended || m.disposed) return { error: '对局已结束' };
  let run;
  if (Object.hasOwn(MATCH_ACTIONS, action)) run = () => MATCH_ACTIONS[action](m, value);
  else if (Object.hasOwn(PLAYER_ACTIONS, action)) {
    const ps = m.players.get(String(playerId));
    if (!ps) return { error: '玩家不存在' };
    run = () => PLAYER_ACTIONS[action](m, ps, value);
  } else return { error: `未知操作：${action}` };
  let res = null;
  // guard: errors are isolated and logged like any intent, and the views go out right after
  m.guard(() => { res = run(); });
  return res || { error: '执行出错（见服务器日志）' };
}

// ---- 对局记录: logs/results/<time>-<room>.json, one per finished match

/** The saved record: the m.result summary with the names the console shows (no game data on the page), plus history. */
export function resultRecord(room, m, summary, now = new Date()) {
  if (m.hosted) {
    if (!m.extensionEnd?.record) throw new Error('插件对局未返回统计记录');
    return { ...m.extensionEnd.record, rules: { ...roomRules(room, m), adminModified: room.adminModifiedMatch === m } };
  }
  const gd = m.gd;
  const players = (summary.players || []).map((p) => {
    const ps = m.players.get(p.playerId);
    const pgd = (ps && ps.gd) || gd;
    return {
      ...p,
      // the console's full totals (buys, sells, funds gained, healing are not in the result frame)
      stats: ps ? { ...p.stats, ...statsOf(ps) } : p.stats,
      band: p.bandId && gd.band(p.bandId) ? gd.band(p.bandId).name || p.bandId : null,
      lineup: (p.lineup || []).map((u) => ({ ...u, name: (u.standInFor ? pgd.standIn(u.id) : null)?.name || pgd.chess(u.id)?.name || u.id, items: (u.items || []).map((id) => pgd.item(id)?.name || id) })),
      bonds: (p.bonds || []).map((b) => ({ ...b, name: gd.bond(b.bondId)?.name || b.bondId })),
    };
  });
  return {
    savedAt: now.getTime(), room: room.code, mode: room.mode, difficulty: room.difficulty,
    version: m.version || DEFAULT_VERSION,
    rules: { ...roomRules(room, m), adminModified: room.adminModifiedMatch === m },
    result: { ...summary, players },
    history: m.history || [],
  };
}

const pad = (n) => String(n).padStart(2, '0');
/** Write a resultRecord, @returns its id (the file name). */
function saveRecord(dir, room, rec, log) {
  const now = new Date(rec.savedAt);
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const code = String(room.code).replace(/[^\w]/g, '');
  fs.mkdirSync(dir, { recursive: true });
  let id = `${stamp}-${code}.json`;
  for (let i = 2; fs.existsSync(path.join(dir, id)); i++) id = `${stamp}-${code}-${i}.json`;
  fs.writeFileSync(path.join(dir, id), JSON.stringify(rec));
  log.info(`[admin] ${room.code} result saved: ${id}`);
  return id;
}

/** The ended match the room card keeps showing until the room's next match (room.adminLastMatch). */
function lastMatchView(rec, id) {
  const r = rec.result;
  return {
    id, version: rec.version || DEFAULT_VERSION, savedAt: rec.savedAt, victory: !!r.victory, hiddenCleared: !!r.hiddenCleared, reason: r.reason, roundsPassed: r.roundsPassed,
    players: (r.players || []).map((p) => ({ id: p.playerId, seat: p.seat, name: p.name, stats: p.stats })),
    history: rec.history,
  };
}

/** GET /api/results — newest first, the list's columns only. */
export function listRecords(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => RECORD_ID.test(f)); } catch { return []; }
  const out = [];
  for (const id of files) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, id), 'utf8'));
      if (!rec.result || !rec.savedAt) continue;
      const r = rec.result;
      out.push({
        id, version: rec.version || DEFAULT_VERSION, savedAt: rec.savedAt, room: rec.room, mode: rec.mode, difficulty: rec.difficulty, victory: !!r.victory,
        hiddenCleared: !!r.hiddenCleared, reason: r.reason, roundsPassed: r.roundsPassed, rounds: (rec.history || []).length, durationMs: r.durationMs,
        rules: rec.rules || null, ruleStatus: resultRules(rec),
        players: (r.players || []).map((p) => ({ name: p.name, bot: !!p.isBot, alive: !!p.alive })),
      });
    } catch { /* a broken file is skipped */ }
  }
  return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0) || b.id.localeCompare(a.id));
}

/** GET /api/result?id= → the record, or null (the id names a file of `dir` only). */
export function readRecord(dir, id) {
  if (typeof id !== 'string' || !RECORD_ID.test(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dir, id), 'utf8')); } catch { return null; }
}

// ---- settings: logs/admin-settings.json { prep, uniteLayerGains, allowRoomUniteLayerGains, roundCharts, blockedWords }

/** The data's prep seconds per round of every timed (同盟) mode, for the settings page's defaults and preview. */
export function prepDefaults(data) {
  const modes = data && data.config && data.config.modes && typeof data.config.modes === 'object' ? data.config.modes : {};
  const out = [];
  for (const [id, mode] of Object.entries(modes)) {
    if (!mode || mode.inScope === false) continue;
    const gd = new GameData(data, id);
    if (gd.isSolo) continue;
    const last = Math.max(gd.bossRound || 0, gd.hiddenRound || 0);
    const rounds = Array.from({ length: last }, (_, i) => gd.prepTime(i + 1));
    if (rounds.some((s) => s > 0)) out.push({ modeId: id, name: mode.name || id, difficulty: mode.difficulty || '', rounds });
  }
  return out;
}

export function loadSettings(file, log) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return; } // none yet: the data's timers
  try {
    const saved = JSON.parse(raw);
    const social = setSocialSettings({ ...DEFAULT_SOCIAL_SETTINGS, ...saved.social });
    if (social.error) log.error(`[admin] ${file}: social ignored (${social.error})`);
    if (typeof saved.replay?.enabled === 'boolean') setReplayConfig({ enabled: process.env.SP_REPLAY === '0' ? false : saved.replay.enabled });
    const r = setPrep(saved.prep);
    if (r.error) log.error(`[admin] ${file}: prep ignored (${r.error})`);
    const u = setUniteLayerGains(saved.uniteLayerGains ?? false);
    if (u.error) log.error(`[admin] ${file}: uniteLayerGains ignored (${u.error})`);
    const permission = setAllowRoomUniteLayerGains(saved.allowRoomUniteLayerGains ?? false);
    if (permission.error) log.error(`[admin] ${file}: allowRoomUniteLayerGains ignored (${permission.error})`);
    const c = setRoundCharts(saved.roundCharts ?? true);
    if (c.error) log.error(`[admin] ${file}: roundCharts ignored (${c.error})`);
    const live = setLiveRoundDamage(saved.liveRoundDamage ?? true);
    if (live.error) log.error(`[admin] ${file}: liveRoundDamage ignored (${live.error})`);
    const install = setShowPwaInstall(saved.showPwaInstall ?? true);
    if (install.error) log.error(`[admin] ${file}: showPwaInstall ignored (${install.error})`);
    if (typeof saved.allowAiTakeover === 'boolean') setAllowAiTakeover(saved.allowAiTakeover);
    const chat = setChatSettings(saved.chat ?? DEFAULT_CHAT_SETTINGS);
    if (chat.error) log.error(`[admin] ${file}: chat ignored (${chat.error})`);
    const b = setBlockedWords(saved.blockedWords ?? []);
    if (b.error) log.error(`[admin] ${file}: blockedWords ignored (${b.error})`);
  } catch (e) { log.error(`[admin] ${file} is not valid JSON, ignored`, e); }
}

/** POST /api/settings preserves omitted fields, including the persisted allowAiTakeover permission. */
function saveSettings(file, body) {
  const social = normalizeSocialSettings(Object.hasOwn(body, 'social') ? body.social : getSocialSettings());
  if (social.error) return social;
  const r = normalizePrep(Object.hasOwn(body, 'prep') ? body.prep : getPrep());
  if (r.error) return r;
  const uniteLayerGains = Object.hasOwn(body, 'uniteLayerGains') ? body.uniteLayerGains : getUniteLayerGains();
  if (typeof uniteLayerGains !== 'boolean') return { error: '联防叠层设置必须为开或关' };
  const allowRoomUniteLayerGains = Object.hasOwn(body, 'allowRoomUniteLayerGains') ? body.allowRoomUniteLayerGains : getAllowRoomUniteLayerGains();
  if (typeof allowRoomUniteLayerGains !== 'boolean') return { error: '房主联防叠层控制权限必须为开或关' };
  const roundCharts = Object.hasOwn(body, 'roundCharts') ? body.roundCharts : getRoundCharts();
  if (typeof roundCharts !== 'boolean') return { error: '局内曲线设置必须为开或关' };
  const liveRoundDamage = Object.hasOwn(body, 'liveRoundDamage') ? body.liveRoundDamage : getLiveRoundDamage();
  if (typeof liveRoundDamage !== 'boolean') return { error: '实时伤害设置必须为开或关' };
  const showPwaInstall = Object.hasOwn(body, 'showPwaInstall') ? body.showPwaInstall : getShowPwaInstall();
  if (typeof showPwaInstall !== 'boolean') return { error: '桌面安装按钮设置必须为开或关' };
  const allowAiTakeover = Object.hasOwn(body, 'allowAiTakeover') ? body.allowAiTakeover : getAllowAiTakeover();
  if (typeof allowAiTakeover !== 'boolean') return { error: '观战接替 AI 权限必须为开或关' };
  const chat = normalizeChatSettings(Object.hasOwn(body, 'chat') ? body.chat : getChatSettings());
  if (chat.error) return chat;
  const blocked = normalizeBlockedWords(Object.hasOwn(body, 'blockedWords') ? body.blockedWords : getBlockedWords());
  if (blocked.error) return blocked;
  if (Object.hasOwn(body, 'replay') && (!body.replay || typeof body.replay !== 'object' || Array.isArray(body.replay))) return { error: '回放设置无效' };
  const replay = { enabled: getReplayConfig().enabled, keep: 50, ...(body.replay || {}) };
  if (typeof replay.enabled !== 'boolean' || replay.keep !== 50) return { error: '回放设置无效（最多保留 50 局）' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ prep: r.prep, uniteLayerGains, allowRoomUniteLayerGains, roundCharts, liveRoundDamage, showPwaInstall, allowAiTakeover, chat: chat.settings, blockedWords: blocked.words, replay, social: social.settings }, null, 2));
  fs.renameSync(tmp, file);
  setPrep(r.prep);
  setUniteLayerGains(uniteLayerGains);
  setAllowRoomUniteLayerGains(allowRoomUniteLayerGains);
  setSocialSettings(social.settings);
  setRoundCharts(roundCharts);
  setLiveRoundDamage(liveRoundDamage);
  setShowPwaInstall(showPwaInstall);
  setAllowAiTakeover(allowAiTakeover);
  setChatSettings(chat.settings);
  setBlockedWords(blocked.words);
  setReplayConfig({ enabled: process.env.SP_REPLAY === '0' ? false : replay.enabled });
  const out = { ok: true, prep: getPrep(), uniteLayerGains: getUniteLayerGains(), roundCharts: getRoundCharts() };
  if (Object.hasOwn(body, 'allowRoomUniteLayerGains')) out.allowRoomUniteLayerGains = getAllowRoomUniteLayerGains();
  if (Object.hasOwn(body, 'social')) out.social = getSocialSettings();
  if (Object.hasOwn(body, 'liveRoundDamage')) out.liveRoundDamage = getLiveRoundDamage();
  if (Object.hasOwn(body, 'showPwaInstall')) out.showPwaInstall = getShowPwaInstall();
  if (Object.hasOwn(body, 'allowAiTakeover')) out.allowAiTakeover = getAllowAiTakeover();
  if (Object.hasOwn(body, 'chat')) out.chat = getChatSettings();
  if (Object.hasOwn(body, 'blockedWords')) out.blockedWords = getBlockedWords();
  if (Object.hasOwn(body, 'replay')) out.replay = { enabled: getReplayConfig().enabled, keep: 50, forcedOff: process.env.SP_REPLAY === '0' };
  return out;
}

function readJson(req, limit = 8192) {
  return new Promise((resolve) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { s += d; if (s.length > limit) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(null); } });
    req.on('close', () => resolve(null));
  });
}

/** @returns {Promise<{ url: string, port: number, token: string, close: () => Promise<void> }>} */
export async function startAdmin({ lobby, port = 3100, host = '127.0.0.1', log = console, resultsDir = path.join(DIR, '..', 'logs', 'results'),
  settingsFile = path.join(DIR, '..', 'logs', 'admin-settings.json'), root = path.join(DIR, '..'), onUpdateReady,
  replaysDir = path.join(path.dirname(resultsDir), 'replays'),
  updateOptions = {}, service = null, network = null, traffic = null, studioUrl = null }) {
  const oldReplayConfig = getReplayConfig();
  let identity = null;
  try { identity = replayIdentity(root); } catch (e) { log.error('[replay] fingerprint unavailable', e.message); }
  let release = null;
  try { release = fs.readFileSync(path.join(root, 'RELEASE_TAG'), 'utf8').trim(); } catch { /* source checkout */ }
  setReplayConfig({ enabled: process.env.SP_REPLAY !== '0', identity, release });
  loadSettings(settingsFile, log);
  const announcementDrafts = new AnnouncementDrafts(path.join(path.dirname(settingsFile), 'announcement-drafts.json'));
  const announcementPersistenceFile = path.join(path.dirname(settingsFile), 'announcement-state.json');
  try { lobby.announcements?.loadPersistence(announcementPersistenceFile); }
  catch (e) { log.error('[admin] announcement restore failed', e); }
  const serveStatic = createStaticHandler({ publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'),
    sharedDir: path.join(root, 'shared'), simDir: path.join(root, 'server', 'sim'), packsDir: path.join(root, 'packs'), ...(lobby.staticOptions || {}), log });
  const updater = createReleaseUpdater({ ...updateOptions, root, log, onReady: onUpdateReady,
    hasActive: () => [...lobby.rooms.values()].some((r) => r.match && !r.match.ended && !r.match.disposed) });
  const idleUpdater = createIdleUpdater({ updater, file: path.join(path.dirname(settingsFile), 'auto-update.json'),
    hasActive: () => [...lobby.rooms.values()].some((r) => r.match && !r.match.ended && !r.match.disposed),
    announce: (text) => handleAction(lobby, { room: '*', action: 'announce', value: { text, level: 'warning', startAt: lobby.now(), endAt: lobby.now() + 120000 } }) });
  const hadStart = Object.hasOwn(lobby, 'startMatch'), originalStart = lobby.startMatch;
  lobby.startMatch = function (room, ...args) {
    const before = room.match;
    const result = originalStart.call(this, room, ...args);
    if (room.match && room.match !== before) idleUpdater.matchStarted();
    return result;
  };
  const idleTimer = setInterval(() => { idleUpdater.tick().catch((e) => log.error('[auto-update]', e)); }, 1000);
  idleTimer.unref();
  const updateStatus = () => ({ ...updater.status(), automatic: idleUpdater.status() });
  const notes = readReleaseNotes(root);
  const resources = createResources({ lobby, network, traffic });
  const token = randomBytes(16).toString('hex');
  let serviceAction = null, serviceTimer = null, serviceCancel = null;
  const serviceView = () => ({ instanceId: process.pid, activeMatches: [...lobby.rooms.values()].filter((r) => r.match && !r.match.ended && !r.match.disposed).length,
    canRestart: !!service, canShutdown: !!service && !service.shutdownReason,
    shutdownReason: service?.shutdownReason || '', action: serviceAction, recoveryEnabled: lobby.recovery?.status().enabled || false });
  const page = fs.readFileSync(path.join(DIR, 'admin.html'), 'utf8').replace('__TOKEN__', token);
  const tokenBuf = Buffer.from(token);
  const authed = (req) => {
    const t = Buffer.from(String(req.headers['x-admin-token'] || ''));
    return t.length === tokenBuf.length && timingSafeEqual(t, tokenBuf);
  };
  const session = (req) => (req.headers.cookie || '').split(';').some((s) => s.trim() === `sp_admin=${token}`);
  const summarizeResults = createResultSummary(resultsDir);
  const audit = createAdminAudit({ lobby, file: path.join(resultsDir, 'admin-events.ndjson'), log });
  const diagnosticSeen = new WeakMap(), diagnosticPending = new WeakSet();
  let auditClosed = false;
  const ingestDiagnostics = (room, match, data) => {
    if (auditClosed || !match || !Array.isArray(data?.events)) return;
    let seen = diagnosticSeen.get(match) || 0;
    for (const event of data.events) if (event.seq > seen) {
      const name = (id) => id === 'server' ? '服务器' : room.seats?.find((seat) => seat?.playerId === id)?.name || id;
      audit.append({ ...event, room: room.code, from: event.from ? name(event.from) : undefined, to: event.to ? name(event.to) : undefined });
      seen = event.seq;
    }
    diagnosticSeen.set(match, seen);
  };
  const diagnosticTimer = setInterval(() => {
    for (const room of lobby.rooms.values()) {
      const match = room.match;
      if (!match || diagnosticPending.has(match)) continue;
      diagnosticPending.add(match);
      Promise.resolve().then(() => match.hosted ? match.admin('diagnostics') : diagnosticEvents(match))
        .then((data) => ingestDiagnostics(room, match, data)).catch(() => {}).finally(() => diagnosticPending.delete(match));
    }
  }, 2000);
  diagnosticTimer.unref();
  async function auditedAction(body, action, execute) {
    const room = lobby.rooms.get(String(body?.room)), match = room?.match;
    const gameplay = !!match && !['announce', 'chatSend', 'chatClear', 'chatMute', 'chatKick'].includes(action);
    const before = gameplay ? await actionState(room, body.playerId).catch(() => null) : null;
    let marker = null;
    if (gameplay) {
      if (room.adminModifiedMatch !== match) { room.adminModifiedMatch = match; room.adminModifiedState = { pending: 0, success: false }; }
      marker = room.adminModifiedState;
      marker.pending++;
    }
    let result;
    try { result = await execute(); }
    catch (error) {
      if (marker) { marker.pending--; if (!marker.pending && !marker.success && room.adminModifiedState === marker) room.adminModifiedMatch = null; }
      audit.append({ type: 'action', room: body?.room || '', action, ok: false, error: String(error?.message || error).slice(0, 500) });
      throw error;
    }
    if (marker) {
      marker.pending--;
      if (result?.ok) marker.success = true;
      if (!marker.pending && !marker.success && room.adminModifiedState === marker) room.adminModifiedMatch = null;
    }
    const after = gameplay && lobby.rooms.get(String(body.room))?.match === match
      ? await actionState(room, body.playerId).catch(() => null) : null;
    let value = '';
    if (!action.startsWith('chat') && action !== 'announce' && body?.value != null) value = JSON.stringify(body.value).slice(0, 500);
    audit.append({ type: 'action', room: body?.room || '', action, player: before?.player?.name || room?.seats?.find((seat) => seat?.playerId === body?.playerId)?.name || null,
      round: before?.round ?? null, ok: !!result?.ok, error: result?.error || null, value, ...actionChanges(before, after) });
    return result;
  }
  const resultFiles = () => recordFiles(resultsDir, [path.resolve(settingsFile), path.resolve(announcementDrafts.file), path.resolve(announcementPersistenceFile)]);
  const storageView = () => ({ results: resultFiles().length, replays: replayFiles(replaysDir).length,
    adminLogs: audit.list().events.length + replayAdminLogs(replaysDir) + [...lobby.rooms.values()].reduce((n, r) => n + (r.adminLog?.length || 0) + (r.match?.replay?.rounds || []).reduce((s, x) => s + x.admin.length, 0), 0) });

  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    try {
      const address = server.address();
      if (!address) {
        res.setHeader('Connection', 'close');
        return send(503, { error: '控制台正在关闭，请稍后重试' });
      }
      const p = address.port;
      if (req.headers.host !== `127.0.0.1:${p}` && req.headers.host !== `localhost:${p}`) return send(403, { error: 'forbidden host' });
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') {
        res.setHeader('Set-Cookie', `sp_admin=${token}; HttpOnly; SameSite=Strict; Path=/`);
        return send(200, page, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && ['/wall', '/resources'].includes(url.pathname) && session(req)) {
        return send(200, fs.readFileSync(path.join(DIR, 'monitor.html'), 'utf8').replace('__TOKEN__', token), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/studio' && session(req)) {
        if (!studioUrl) return send(503, '插件工作台未启用。请检查 SP_STUDIO 设置，并使用游戏服务启动控制台。', 'text/plain; charset=utf-8');
        res.writeHead(302, { Location: studioUrl, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/replay' && session(req)) {
        return send(200, fs.readFileSync(path.join(DIR, 'replay.html'), 'utf8').replace('__TOKEN__', token), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/replay-viewer.js' && session(req)) {
        return send(200, fs.readFileSync(path.join(DIR, 'replay-viewer.js'), 'utf8'), 'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/live' && session(req)) {
        // Only the read-only wall view can be framed, and only by this same local console origin.
        if (url.searchParams.get('wall') === '1') {
          res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
          const html = fs.readFileSync(path.join(DIR, 'live.html'), 'utf8').replace('__TOKEN__', token);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' });
          return res.end(html);
        }
        return send(200, fs.readFileSync(path.join(DIR, 'live.html'), 'utf8').replace('__TOKEN__', token), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/live-viewer.js' && session(req)) {
        return send(200, fs.readFileSync(path.join(DIR, 'live-viewer.js'), 'utf8'), 'text/javascript; charset=utf-8');
      }
      if (['GET', 'HEAD'].includes(req.method) && session(req) && /^\/(?:dev\/|js\/|css\/|vendor\/|assets\/|fonts\/|data\/|shared\/|sim\/|packs\/|media\/|cs\/|vs\/|p\/|plugins\/|data\.js$)/.test(url.pathname)) {
        res.setHeader('X-Frame-Options', 'DENY');
        return await serveStatic(req, res, url.pathname, url.search.slice(1));
      }
      if (!url.pathname.startsWith('/api/')) return send(404, { error: 'not found' });
      if (!authed(req)) return send(403, { error: 'bad token' });
      if (url.pathname === '/api/domain-recovery') {
        const file = path.join(root, 'local', 'personal-data.json');
        if (req.method === 'GET') return send(200, { ok: true, config: readPersonalDataConfig(file) });
        if (req.method === 'POST') {
          const body = await readJson(req);
          try { return send(200, { ok: true, config: writePersonalDataConfig(body, file) }); }
          catch (e) { return send(400, { error: e.message }); }
        }
        return send(405, { error: 'method not allowed' });
      }
      if (req.method === 'GET' && url.pathname === '/api/devtools') return send(200, {
        pages: DEV_PAGES.map(([file]) => ({ file, available: fs.existsSync(path.join(root, 'public', 'dev', file)) })),
      });
      if (req.method === 'GET' && url.pathname === '/api/wall') return send(200, await wallView(lobby, url.searchParams.get('room')));
      if (req.method === 'GET' && url.pathname === '/api/recovery') return send(200, lobby.recovery?.status() || { enabled: false, unavailable: true, issues: [] });
      if (req.method === 'POST' && url.pathname === '/api/recovery') {
        const body = await readJson(req);
        if (!lobby.recovery) return send(400, { error: '当前启动方式未启用恢复管理' });
        if (!body || body.confirm !== true) return send(400, { error: '操作需要确认' });
        const result = body.action === 'delete' ? lobby.recovery.delete(body.id) : lobby.recovery.configure(body.enabled);
        log.info(`[admin] recovery ${body.action || 'configure'} → ${result.ok ? 'ok' : result.error}`);
        return send(200, result);
      }
      if (req.method === 'GET' && url.pathname === '/api/resources') return send(200, resources.snapshot());
      if (req.method === 'GET' && url.pathname === '/api/events') return send(200, audit.list(url.searchParams.get('room') || ''));
      if (req.method === 'GET' && url.pathname === '/api/stock') {
        const match = lobby.rooms.get(String(url.searchParams.get('room')))?.match;
        const group = url.searchParams.get('group');
        return send(200, match?.hosted ? await match.admin('stock', { group }) : { ...stockView(match, group), matchId: match ? matchId(match) : null });
      }
      if (req.method === 'GET' && url.pathname === '/api/overview') return send(200, { current: resources.snapshot().current, announcement: lobby.announcements?.frame().announcement || null });
      if (req.method === 'GET' && url.pathname === '/api/release-notes') return send(200, notes);
      if (req.method === 'GET' && url.pathname === '/api/live') {
        return send(200, await liveState(lobby, Object.fromEntries(url.searchParams)));
      }
      if (req.method === 'POST' && url.pathname === '/api/live') {
        const body = await readJson(req);
        return send(200, await auditedAction(body, `代操作 ${body?.intent?.t || ''}`, () => liveIntent(lobby, body)));
      }
      if (req.method === 'GET' && url.pathname === '/api/replay') {
        const replay = readReplay(replaysDir, url.searchParams.get('id'), identity);
        if (!replay) return send(404, { error: '回放不存在（可能未录制或已清理）' });
        if (replay.error) return send(422, replay);
        const body = gzipSync(JSON.stringify(replay));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip',
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': body.length });
        return res.end(body);
      }
      if (req.method === 'GET' && url.pathname === '/api/storage') return send(200, storageView());
      if (req.method === 'GET' && url.pathname === '/api/update-backups') return send(200, listBackups(root));
      if (req.method === 'POST' && url.pathname === '/api/update-backups') {
        const body = await readJson(req);
        if (['checking', 'downloading', 'verifying', 'scheduled', 'validating', 'starting', 'rolling-back'].includes(updater.status().state)) return send(409, { error: '更新进行中，不能修改或清理备份' });
        try {
          if (body?.action === 'configure') configureBackups(root, body.keep);
          else if (body?.action === 'delete' && body.confirm === true) deleteBackup(root, body.id);
          else return send(400, { error: '请确认有效的备份操作' });
          return send(200, { ok: true, ...listBackups(root) });
        } catch (e) { return send(400, { error: e.message }); }
      }
      if (req.method === 'POST' && url.pathname === '/api/storage') {
        const body = await readJson(req);
        if (!body || body.confirm !== true) return send(400, { error: '请先确认删除范围' });
        if (body.id != null) {
          if (typeof body.id !== 'string' || !REPLAY_ID.test(body.id) || [path.resolve(settingsFile), path.resolve(announcementDrafts.file), path.resolve(announcementPersistenceFile)].includes(path.resolve(resultsDir, body.id))) return send(400, { error: '记录名称无效' });
          const deleted = deleteRecordFiles(resultsDir, replaysDir, body.id);
          for (const room of lobby.rooms.values()) if (room.adminLastMatch?.id === body.id) room.adminLastMatch = null;
          return send(200, { ok: true, deleted, ...storageView() });
        }
        if (!Array.isArray(body.categories) || !body.categories.length || body.categories.some((c) => !['results', 'replays', 'adminLogs'].includes(c))) return send(400, { error: '请选择有效的清理类别' });
        let deleted = 0;
        for (const category of new Set(body.categories)) {
          if (category === 'results') {
            for (const id of resultFiles()) deleted += deleteRecordFiles(resultsDir, replaysDir, id, 'results');
            for (const room of lobby.rooms.values()) room.adminLastMatch = null;
          } else if (category === 'replays') {
            for (const file of replayFiles(replaysDir)) deleted += deleteRecordFiles(resultsDir, replaysDir, file.slice(0, -3), 'replays');
          } else {
            deleted += audit.clear();
            deleted += replayAdminLogs(replaysDir, true);
            for (const room of lobby.rooms.values()) {
              deleted += room.adminLog?.length || 0;
              room.adminLog = [];
              for (const round of room.match?.replay?.rounds || []) { deleted += round.admin.length; round.admin = []; }
            }
          }
        }
        return send(200, { ok: true, deleted, ...storageView() });
      }
      if (req.method === 'GET' && url.pathname === '/api/service') return send(200, serviceView());
      if (req.method === 'POST' && url.pathname === '/api/service') {
        const body = await readJson(req);
        if (!body || !['restart', 'shutdown'].includes(body.action)) return send(400, { error: '未知服务操作' });
        if (body.confirm !== true) return send(400, { error: '请确认结束全部对局并操作服务' });
        if (body.confirmActive === false && serviceView().activeMatches) return send(409, { error: '当前有活动对局，请确认后再停止。' });
        if (!service || (body.action === 'shutdown' && service.shutdownReason)) return send(409, { error: service?.shutdownReason || '当前启动方式不支持服务控制' });
        if (serviceAction || ['checking', 'downloading', 'verifying', 'scheduled', 'validating', 'starting', 'rolling-back'].includes(updater.status().state)) return send(409, { error: '服务操作或更新进行中，请稍后重试' });
        serviceAction = body.action;
        try {
          const prepared = await service.prepare(body.action);
          serviceCancel = prepared.cancel;
          if (res.destroyed) {
            serviceCancel?.(); serviceCancel = null; serviceAction = null;
            return;
          }
          res.once('close', () => {
            if (res.writableFinished) return;
            serviceCancel?.(); serviceCancel = null; serviceAction = null;
          });
          res.once('finish', () => {
            serviceTimer = setTimeout(() => {
              serviceCancel = null;
              Promise.resolve().then(prepared.run).catch((e) => {
                serviceAction = null;
                log.error('[admin] service control failed', e);
              });
            }, 500);
          });
          return send(202, { ok: true, action: serviceAction });
        } catch (e) {
          serviceAction = null;
          log.error('[admin] preparing service control failed', e);
          return send(500, { error: `服务操作准备失败：${e.message}` });
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/update') return send(200, updateStatus());
      if (req.method === 'POST' && url.pathname === '/api/update') {
        const body = await readJson(req);
        if (serviceAction) return send(409, { error: '正在操作服务，请稍后重试' });
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: '请求格式错误' });
        if (body.action === 'automatic') { const r = idleUpdater.configure(body.enabled); return send(200, { ...updateStatus(), ...(r.error ? { error: r.error } : { ok: true }) }); }
        if (body.action === 'check') return send(200, { ...(await updater.check()), automatic: idleUpdater.status() });
        if (body.action === 'open') return send(200, { ...(await updater.open()), automatic: idleUpdater.status() });
        if (body.action === 'more') return send(200, { ...(await updater.check(true)), automatic: idleUpdater.status() });
        if (body.action === 'network') return send(200, { ...(updater.configure(body.network)), automatic: idleUpdater.status() });
        if (body.action === 'install') return send(200, { ...(updater.install({ tag: body.tag, force: body.force === true, allowDowngrade: body.allowDowngrade === true, repairAssets: body.repairAssets === true })), automatic: idleUpdater.status() });
        return send(400, { error: '未知更新操作' });
      }
      if (req.method === 'GET' && url.pathname === '/api/rooms') return send(200, { rooms: await roomsView(lobby), announcement: lobby.announcements?.frame().announcement || null });
      if (url.pathname === '/api/announcement-persistence' && ['GET', 'POST'].includes(req.method)) {
        if (!lobby.announcements) return send(503, { error: '公告服务不可用' });
        try { lobby.announcements.loadPersistence(announcementPersistenceFile); }
        catch { return send(500, { error: '公告恢复文件读取失败，请检查文件内容和权限后重试' }); }
        if (req.method === 'GET') return send(200, { enabled: lobby.announcements.persistEnabled });
        const body = await readJson(req);
        if (!body || typeof body.enabled !== 'boolean') return send(400, { error: '公告重启保留设置必须为开或关' });
        return send(200, lobby.announcements.setPersistence(body.enabled));
      }
      if (url.pathname === '/api/announcement-drafts' && ['GET', 'POST'].includes(req.method)) {
        try {
          if (req.method === 'GET') return send(200, { drafts: announcementDrafts.list() });
          const body = await readJson(req, 256 * 1024);
          if (!body) return send(400, { error: '请求格式错误' });
          if (body.action === 'save') return send(200, announcementDrafts.save(body.draft));
          if (body.action === 'delete') return send(200, announcementDrafts.remove(body.id));
          return send(400, { error: '未知草稿操作' });
        } catch (e) {
          log.error('[admin] announcement drafts failed', e);
          return send(500, { error: '读取或保存公告草稿失败，请检查磁盘空间和草稿文件权限后重试' });
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/catalog') return send(200, await catalogView(lobby, url.searchParams.get('room')));
      if (req.method === 'GET' && url.pathname === '/api/results-summary') return send(200, summarizeResults(Object.fromEntries(url.searchParams)));
      if (req.method === 'GET' && url.pathname === '/api/results') return send(200, { records: listRecords(resultsDir) });
      if (req.method === 'GET' && url.pathname === '/api/settings') return send(200, { social: getSocialSettings(), prep: getPrep(), uniteLayerGains: getUniteLayerGains(), allowRoomUniteLayerGains: getAllowRoomUniteLayerGains(), roundCharts: getRoundCharts(), liveRoundDamage: getLiveRoundDamage(), showPwaInstall: getShowPwaInstall(), allowAiTakeover: getAllowAiTakeover(), chat: getChatSettings(), blockedWords: getBlockedWords(), replay: { enabled: getReplayConfig().enabled, keep: 50, forcedOff: process.env.SP_REPLAY === '0' }, file: settingsFile, defaults: prepDefaults(lobby.safeData()) });
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        const body = await readJson(req);
        if (!body) return send(400, { error: '请求格式错误' });
        let r;
        try { r = saveSettings(settingsFile, body); } catch (e) { log.error('[admin] saving the settings failed', e); r = { error: `写入 ${settingsFile} 失败` }; }
        if (r.ok && !getReplayConfig().enabled) for (const room of lobby.rooms.values()) {
          if (room.match) { room.match.replayDisabled = true; delete room.match.replay; }
        }
        if (r.ok) for (const room of lobby.rooms.values()) room.match?.syncExtensions?.();
        if (r.ok && Object.hasOwn(body, 'social')) lobby.social?.sync(true);
        if (r.ok && Object.hasOwn(body, 'allowAiTakeover')) for (const room of lobby.rooms.values()) {
          if (!getAllowAiTakeover()) { room.aiTakeoverEnabled = false; resetAiTakeover(room); }
          lobby.broadcastState?.(room);
        }
        if (r.ok && Object.hasOwn(body, 'showPwaInstall')) {
          const frame = { t: 'site.settings', showPwaInstall: getShowPwaInstall() };
          if (network?.conns) {
            // The title screen has a socket before choosing a name, so it has no registered session yet.
            for (const connection of network.conns.values()) sendSocket(connection.ws, frame);
          } else for (const session of lobby.registry?.all?.() || []) {
            if (session.connected) sendSession(session, frame);
          }
        }
        if (r.ok && Object.hasOwn(body, 'allowRoomUniteLayerGains')) {
          for (const room of lobby.rooms.values()) lobby.broadcastState?.(room);
        }
        if (r.ok && Object.hasOwn(body, 'chat')) for (const room of lobby.rooms.values()) {
          if (room.chat) lobby.broadcastRoom?.(room, room.chat.history(room.code));
        }
        if (r.ok && (Object.hasOwn(body, 'roundCharts') || Object.hasOwn(body, 'liveRoundDamage'))) for (const room of lobby.rooms.values()) {
          room.match?.markPublic?.();
          room.match?.flush?.(true);
        }
        log.info(`[admin] settings ${JSON.stringify(body)} → ${r.ok ? 'ok' : r.error}`);
        return send(200, r);
      }
      if (req.method === 'GET' && url.pathname === '/api/result') {
        const rec = readRecord(resultsDir, url.searchParams.get('id'));
        return rec ? send(200, { ...rec, ruleStatus: resultRules(rec) }) : send(404, { error: '记录不存在' });
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        // Markdown announcements accept up to 20k Unicode characters, plus JSON escapes.
        const body = await readJson(req, 256 * 1024);
        if (!body) return send(400, { error: '请求格式错误' });
        const r = await auditedAction(body, String(body.action || ''), () => handleAction(lobby, body));
        log.info(`[admin] ${body.room} ${body.action}${body.playerId ? ' ' + body.playerId : ''}${body.value != null ? ' ' + JSON.stringify(body.value) : ''} → ${r.ok ? 'ok' : r.error}`);
        return send(200, r);
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      log.error('[admin] request failed', e);
      return send(500, { error: '控制台内部错误' });
    }
  });
  try { await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  }); } catch (e) {
    clearInterval(idleTimer); clearInterval(diagnosticTimer); auditClosed = true; audit.close(); resources.close();
    if (hadStart) lobby.startMatch = originalStart; else delete lobby.startMatch;
    setReplayConfig(oldReplayConfig);
    throw e;
  }
  // every finished match is saved before the lobby lets it go (the match's onEnd calls lobby.onMatchEnd by name; a
  // wrapper here keeps server/lobby.js as upstream has it). The same checks as onMatchEnd: a stale onEnd saves nothing.
  const hadOwn = Object.hasOwn(lobby, 'onMatchEnd');
  const onMatchEnd = lobby.onMatchEnd;
  lobby.onMatchEnd = function (room, ctx, summary) {
    if (ctx && !ctx.ended && ctx.live && room.matchCtx === ctx && !room.disposed && ctx.match && summary && !room.test && !ctx.match.test && !summary.test) {
      ingestDiagnostics(room, ctx.match, ctx.match.hosted ? ctx.match.extensionEnd?.diagnostics : diagnosticEvents(ctx.match));
      audit.append({ type: 'match', room: room.code, round: summary.roundsPassed, message: `对局结束：${summary.reason || (summary.victory ? '胜利' : '失败')}` });
      let rec = null;
      let id = null;
      try {
        rec = resultRecord(room, ctx.match, summary);
        id = saveRecord(resultsDir, room, rec, log);
      } catch (e) { audit.append({ type: 'error', room: room.code, message: `保存对局记录失败：${e.message}` }); log.error('[admin] saving the result failed', e); }
      if (id) try {
        const replayExtra = { savedAt: rec.savedAt, room: room.code, resultId: id };
        const replay = ctx.match.hosted ? ctx.match.extensionEnd?.replay && { ...ctx.match.extensionEnd.replay, ...replayExtra } : replayRecord(ctx.match, replayExtra);
        if (replay) saveReplay(replaysDir, id, replay, 50);
      } catch (e) { audit.append({ type: 'error', room: room.code, message: `保存回放失败：${e.message}` }); log.error('[replay] saving failed', e); }
      room.adminLastMatch = rec ? lastMatchView(rec, id) : null;
    }
    return onMatchEnd.call(this, room, ctx, summary);
  };
  const actual = server.address().port;
  return {
    url: `http://${host}:${actual}`, port: actual, token, resultsDir, replaysDir,
    close: () => new Promise((r) => {
      clearInterval(idleTimer);
      clearInterval(diagnosticTimer); auditClosed = true; audit.close();
      resources.close();
      if (hadStart) lobby.startMatch = originalStart; else delete lobby.startMatch;
      clearTimeout(serviceTimer);
      serviceCancel?.();
      if (hadOwn) lobby.onMatchEnd = onMatchEnd; else delete lobby.onMatchEnd;
      setReplayConfig(oldReplayConfig);
      server.close(() => r());
      server.closeIdleConnections?.();
    }),
  };
}
