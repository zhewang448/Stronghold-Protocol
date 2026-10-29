// Local console replay recorder. Read-only snapshots never consume RNG or enter rewind snapshots.
import { APP_VERSION } from '../../shared/constants.js';
import { SPEC_VERSION, jsonClone, resultDigest } from '../sim/spec.js';

let config = { enabled: false, identity: null, release: null };
export const getReplayConfig = () => ({ ...config });
export function setReplayConfig(value) { config = { ...config, ...value }; }

function safely(m, fn) {
  try { return fn(); } catch (e) { m.log?.error?.('[replay] recording failed', e); return null; }
}

function recording(m) {
  if (!config.enabled) m.replayDisabled = true;
  if (m.replayDisabled) return null;
  return m.replay ||= {
    format: 1, made: { app: APP_VERSION, release: config.release, specVersion: SPEC_VERSION, identity: config.identity },
    ...(m.version ? { version: m.version, cs: m.cs } : {}),
    seed: m.seed, mode: m.modeId, difficulty: m.difficulty, clientCombat: m.clientCombat,
    ...(m.rescueEnabled ? { rescueEnabled: true } : {}),
    players: m.order.map((p) => ({ playerId: p.playerId, name: p.name, isBot: p.isBot })), rounds: [],
  };
}

function roundOf(m, phase = m.phase) {
  const replay = recording(m);
  if (!replay) return null;
  let round = replay.rounds.find((r) => r.round === m.round && r.phase === phase);
  if (!round) replay.rounds.push(round = { round: m.round, phase, fields: [], admin: [] });
  return round;
}

/** Called before any field starts, preserving the actual spec rather than a spectator's modified spec. */
export function captureReplayFields(m, fields) {
  safely(m, () => {
    const round = roundOf(m);
    if (!round) return;
    for (const f of fields) {
      if (!f.cc || !f.spec) continue;
      const boss = f.kind === 'boss' || f.kind === 'hidden';
      const entry = {
        fieldId: f.fieldId, battleId: f.battleId, kind: f.kind, players: [...f.players], spec: jsonClone(f.spec),
        result: null, source: null, digest: null, playable: false, reason: boss ? 'shared-boss' : 'unfinished',
        lineup: f.spec.players.map((p) => ({ playerId: p.playerId, units: (p.units || []).map((u) => {
          const gd = m.players.get(p.playerId)?.gd || m.gd;
          return { ...jsonClone(u), name: u.kind === 'token' ? gd.token(u.tokenId)?.name || u.tokenId : (u.standIn ? gd.standIn(u.chessId) : null)?.name || gd.chess(u.chessId)?.name || u.chessId,
            itemNames: (u.items || []).map((id) => gd.item(id)?.name || id) };
        }) })),
        enemies: f.spec.spawns.map((s) => ({ enemyKey: s.enemyKey, name: m.gd.enemy(s.enemyKey)?.name || s.enemyKey,
          count: s.count || 1, boss: s.tag === 'boss', time: s.time })),
      };
      round.fields.push(entry);
    }
  });
}

/** Each field is finalized once, including synthetic and shared-pool credited results. */
export function finishReplayField(m, f) {
  safely(m, () => {
    if (!m.replay) return;
    const entry = m.replay.rounds.flatMap((r) => r.fields).find((e) => e.battleId === f.battleId);
    if (!entry || !f.result) return;
    const boss = f.kind === 'boss' || f.kind === 'hidden';
    const synthetic = f.replayForced || f.result.synthetic || !f.resultSource;
    entry.result = jsonClone(f.result);
    entry.source = f.replayForced ? 'synthetic' : boss ? 'boss-credited' : synthetic ? 'synthetic' : f.resultSource;
    entry.digest = resultDigest(entry.result);
    entry.playable = !boss && !synthetic;
    entry.reason = boss ? 'shared-boss' : synthetic ? 'synthetic' : null;
  });
}

export function recordReplayAdmin(m, event) {
  safely(m, () => {
    const round = roundOf(m, 'ADMIN');
    if (round) round.admin.push(jsonClone(event));
  });
}

export function recordReplayRescue(m, donorId, targetId) {
  safely(m, () => {
    const round = roundOf(m, 'SETTLE');
    if (round) (round.rescues ||= []).push({ donorId, targetId, cost: 10 });
  });
}

export function truncateReplay(m, round) {
  safely(m, () => { if (m.replay) m.replay.rounds = m.replay.rounds.filter((r) => r.round < round); });
}

/** Ended or interrupted matches keep all inputs; unfinished battles remain explicitly unplayable. */
export function replayRecord(m, extra) {
  return safely(m, () => {
    const replay = recording(m);
    if (!replay) return null;
    return { ...jsonClone(replay), ...extra };
  });
}
