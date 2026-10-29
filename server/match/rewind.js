// server/match/rewind.js — rewind a match to the start of any earlier round's 休整期 (PREP), for the local console
// (server/admin.js).
// i18n-ignore-file: its messages are the host console's, in Chinese, not player UI (tools/i18n.mjs)
//
// capturePrep(m) runs at the top of Match.enterPrep (stored in m.prepSnapshots by round): one structuredClone of every player's state, the shared pool, the
// match's round-level state and the six rng streams. rewindToPrep(m, round) stops whatever is in flight (battles, bot jobs,
// phase / turn timers), writes the clone back into the same PlayerState / Match objects and calls enterPrep again, so
// the onPrepStart effects and the bots replay exactly as they did (same rng states). Every human then gets a full
// m.private / m.public; the browser drops its battles when the phase becomes PREP.
//
// Deliberately NOT rewound (monotonic, so nothing in flight can match the restored state by accident):
//   uidSeq       a stale g.* intent naming a piece uid hits the same piece or none, never a different one
//   _battleSeq   a late b.progress / b.result from an aborted battle names no field of the new timeline
//   _turnToken, ps._botPrepToken   an old bot job / draft timer never passes its validity check
// Fixed for the match since PlayerState's constructor, kept by reference: the 自选编队 picks (diy, _diyRecords, diyBanned,
// the per-player gd view) and the stand-ins (standIns, _standInSet). The DIY stock's copies change in a round: its
// entries are cloned like the shared pool's, the DiyStock instance itself stays.
// Connection state (connected, left, autoplay) and the locked loadout and 潜能 / 练度 (`ops`) stay as they are now.

import { truncateReplay } from './replay.js';

const PS_SKIP = new Set(['m', 'gd', 'playerId', 'seat', 'name', 'isBot', 'connected', 'left', 'autoplay', 'lastEmoteAt',
  'loadout', 'ops', 'skins', 'bondPlan', '_deployMap', '_deployField', '_legalityStale', '_lastPriv', '_botPrepToken',
  'diy', '_diyRecords', 'diyBanned', 'diyStock', 'standIns', '_standInSet']);
const MATCH_KEYS = ['round', 'wave', 'bossWaves', 'bossPairs', 'lastResults', 'draft', 'teamLp', 'hiddenLayerSum', 'hiddenReached', 'overtimeApplied', 'history', 'adminPicks',
  '_botEmotesSettledRound', '_botEmotesMerges', 'bossOvertimeStartReal', 'bossRoundOpeningLp', 'prepOverride', 'offerDrawSeq'];
const RNGS = ['rngSetup', 'rngShop', 'rngWaves', 'rngDraft', 'rngBots', 'rngMeta'];

/** Snapshot for rewindToPrep, or null when the state cannot be cloned (logged; the match itself is never affected). */
export function capturePrep(m) {
  try {
    const players = {};
    const diyStock = {};
    for (const ps of m.players.values()) {
      if (ps.diyStock) diyStock[ps.playerId] = ps.diyStock.entries;
      const o = {};
      // own function-valued props are instrumentation (audit.js / tests wrap methods on the instance), not state
      for (const k of Object.keys(ps)) if (!PS_SKIP.has(k) && typeof ps[k] !== 'function') o[k] = ps[k];
      players[ps.playerId] = o;
    }
    const match = {};
    for (const k of MATCH_KEYS) match[k] = m[k];
    // PREP has no active draft. Group drafts retain timer callbacks that cannot be serialized.
    match.draft = null;
    const groups = m.poolGroups.map(g => ({ id: g.id, playerIds: g.playerIds.slice(), entries: g.pool.entries, itemDebt: g.itemPool.debt }));
    // one clone for everything: pieces shared between a player's areas stay shared
    const data = structuredClone({ players, diyStock, match, groups, pool: m.pool.entries, itemDebt: m.itemPool.debt, rng: RNGS.map((k) => m[k].state()) });
    // class instances / PlayerState references: kept by reference (replaced, never mutated, after this point)
    return { round: m.round, at: m.sched.now(), data, refs: { bossPool: m.bossPool, uniteBounds: m._uniteBounds } };
  } catch (e) {
    m.reportError('rewind snapshot', e);
    return null;
  }
}

/** round defaults to the latest snapshot. @returns {{ ok: true, round: number } | { error: string }} */
export function rewindToPrep(m, round) {
  if (m.disposed || m.ended) return { error: '对局已结束' };
  if (!m.prepSnapshots.size) return { error: '还没有休整期快照（第一个休整期之后才能回档）' };
  const r = round == null ? Math.max(...m.prepSnapshots.keys()) : Number(round);
  const snap = m.prepSnapshots.get(r);
  if (!snap) return { error: `没有第 ${round} 回合的快照` };
  const errors = m.errorCount;
  const { players, diyStock, match, groups, pool, itemDebt, rng } = structuredClone(snap.data);
  if (groups ? groups.length !== m.poolGroups.length || groups.length > 1 && groups.some((g, i) => g.id !== m.poolGroups[i].id || g.playerIds.join() !== m.poolGroups[i].playerIds.join())
    : m.poolGroups.length > 1) return { error: '回档的卡池分组与本局不一致' };
  m.guard(() => {
    if (m.runner) { try { m.runner.stop(); } catch { /* ignore */ } m.runner = null; }
    m._stopClientCombat();
    m._cancelRehearsal();
    m.offersDispose();
    for (const h of m._timers) { try { m.sched.clearTimeout(h); } catch { /* ignore */ } }
    m._timers.clear();
    m._phaseTimer = null;
    m._turnTimer = null;
    m._testDraftHolds?.clear();
    m.sp = null;
    m._prepEndQueued = false;
    m.fields = [];
    m.watchers.clear();
    m.unitePlan = null;
    m.rescueWindow = null;
    m._uniteLeftKey = null;
    m._finalEnding = null;
    m.overtimeAt = 0;
    m._bossStartAt = null;
    m._unitStatsCache = null;
    Object.assign(m, match);
    m.bossPool = snap.refs.bossPool;
    m._uniteBounds = snap.refs.uniteBounds;
    if (groups) {
      for (const [i, g] of groups.entries()) {
        m.poolGroups[i].pool.entries = g.entries;
        m.poolGroups[i].itemPool.debt = g.itemDebt || new Map();
      }
    } else {
      m.pool.entries = pool;
      m.itemPool.debt = itemDebt || new Map();
    }
    // the timeline after round r is gone; r itself is re-captured by enterPrep below
    for (const k of [...m.prepSnapshots.keys()]) if (k > r) m.prepSnapshots.delete(k);
    truncateReplay(m, r);
    RNGS.forEach((k, i) => m[k].setState(rng[i]));
    for (const ps of m.players.values()) {
      const o = players[ps.playerId];
      if (!o) continue;
      // lazily created fields (bot caches) that did not exist yet at the snapshot
      for (const k of Object.keys(ps)) if (!PS_SKIP.has(k) && typeof ps[k] !== 'function' && !(k in o)) delete ps[k];
      Object.assign(ps, o);
      if (ps.diyStock && diyStock[ps.playerId]) ps.diyStock.entries = diyStock[ps.playerId];
      ps.invalidateDeployMap();
      ps._lastPriv = null;
      ps.dirty();
    }
    m.enterPrep();
  });
  if (m.errorCount !== errors || m.round !== snap.round) return { error: `回档出错（见服务器日志），当前 ${m.phase} R${m.round}` };
  m.log.info?.(`[match ${m.roomCode}] rewound to PREP R${m.round}`);
  return { ok: true, round: m.round };
}
