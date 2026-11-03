// server/match/hostSettings.js — the host's standing settings for every room and every match of this server process,
// set by the local console (server/admin.js, which keeps them in logs/admin-settings.json across restarts).
// i18n-ignore-file: host-console messages in Chinese, not player UI (tools/i18n.mjs)
//
// prep: the 休整期 timer of a timed match (match/prep.js enterPrep reads prepSeconds; a match without a prep timer —
// solo, or a 同盟 room with one human: Match.soloUntimed — stays untimed). A room's prepOverride replaces the standing
// setting; null follows future standing changes. The internal developer timerScale still applies via setDeadline,
// but the console only configures prep time. A change reaches a running match at its next 休整期.
//   { mode: 'default' }                     the data's prepTime (config rounds[r].prepTime)
//   { mode: 'scale', scale }                data × scale (0.1–10)
//   { mode: 'fixed', seconds }              every round the same (5–3600 s)
//   { mode: 'perRound', rounds: { r: s } }  the listed rounds, the data for the others
//   { mode: 'untimed' }                     no timer: the prep ends when every player is ready (or the console ends it)

import { DEFAULT_SOCIAL_SETTINGS } from '../../shared/social.js';
import { ROOM_CAPACITIES, DIFFICULTIES, MAX_SPECTATORS, SPECTATOR_LIMIT_MAX, EMOTE_BARRAGE_RATE_MAX } from '../../shared/constants.js';
import { VERSIONS } from '../../shared/versions.js';
import { CONVENIENCE_DEFAULTS } from '../../shared/roomConvenience.js';

export const ROOM_CONFIG_FIELDS = Object.freeze([
  { key: 'difficulty', label: '模拟难度', options: DIFFICULTIES, labels: { FUNNY: '标准模拟', NORMAL: '险境模拟', HARD: '绝境模拟', ABYSS: '终极模拟' }, default: 'FUNNY' },
  { key: 'version', label: '游戏版本', options: ['', ...VERSIONS.map(version => version.id)], default: '' },
  { key: 'private', label: '私密房间', default: false },
  { key: 'capacity', label: '人数上限', options: ROOM_CAPACITIES, default: 4 },
  { key: 'spectatorLimit', label: '观战席上限', min: MAX_SPECTATORS, max: SPECTATOR_LIMIT_MAX, nullable: true, default: null },
  { key: 'aiPicksLast', label: 'AI 队友最后选择', default: true },
  { key: 'seatAvatars', label: '真人座位头像优先（AI 保留策略头像）', default: false },
  { key: 'customIllust', label: '显示玩家自定义立绘', default: true },
  { key: 'aiTakeoverEnabled', label: '允许观战者接替 AI', default: false },
  { key: 'uniteLayerGains', label: '允许联防叠层', default: false, hostControl: false },
  { key: 'enemyHpMultiplier', label: '敌人血量倍率', min: 0.1, max: 100, default: 1 },
  { key: 'independentPools', label: '独立卡池', default: false },
  { key: 'rescueEnabled', label: '队友救援', default: false },
  ...Object.entries(CONVENIENCE_DEFAULTS).map(([key, value], index) => ({
    key: 'convenience.' + key, label: ['允许整备区装备', '独立模拟不限时', '休整期调整技能与模组', '允许卸下装备', '变形同构体增强规则'][index], default: value,
  })),
  { key: 'plugins', label: '房间插件（留空沿用插件管理默认，[] 表示不启用可选插件）', default: null, list: true },
]);
const initialRoomCreation = () => ({
  defaults: Object.fromEntries(ROOM_CONFIG_FIELDS.map(field => [field.key, field.default])),
  hostControls: Object.fromEntries(ROOM_CONFIG_FIELDS.map(field => [field.key,
    field.key === 'aiTakeoverEnabled' ? !/^(0|false|no|off)$/i.test(process.env.SP_AI_TAKEOVER || '') : field.hostControl !== false])),
});
let roomCreation = initialRoomCreation();
export function getRoomCreation() { return structuredClone(roomCreation); }
export function normalizeRoomCreation(value, current = roomCreation) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['defaults', 'hostControls'].includes(key))) return { error: '房间默认配置格式无效' };
  const next = structuredClone(current);
  for (const section of ['defaults', 'hostControls']) {
    if (!Object.hasOwn(value, section)) continue;
    const values = value[section];
    if (!values || typeof values !== 'object' || Array.isArray(values)) return { error: '房间默认配置格式无效' };
    for (const [key, setting] of Object.entries(values)) {
      const field = ROOM_CONFIG_FIELDS.find(entry => entry.key === key);
      if (!field) return { error: '未知房间配置项：' + key };
      const valid = section === 'hostControls' ? typeof setting === 'boolean'
        : field.list ? setting === null || Array.isArray(setting) && setting.length <= 32 && setting.every(id => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
        : field.nullable && setting === null ? true
        : field.options ? field.options.includes(setting)
        : typeof field.default === 'boolean' ? typeof setting === 'boolean'
        : typeof setting === 'number' && Number.isFinite(setting) && setting >= field.min && setting <= field.max && (key !== 'spectatorLimit' || Number.isInteger(setting));
      if (!valid) return { error: field.label + '的配置值无效' };
      next[section][key] = setting;
    }
  }
  return { config: next };
}
export function setRoomCreation(value) {
  const result = normalizeRoomCreation(value);
  if (result.error) return result;
  roomCreation = result.config;
  return { ok: true };
}
export function roomHostCanChange(key) { return roomCreation.hostControls[key] !== false; }
export function roomCreationFrame() {
  return JSON.stringify(roomCreation) === JSON.stringify(initialRoomCreation()) ? null : getRoomCreation();
}
const MODES = new Set(['default', 'scale', 'fixed', 'perRound', 'untimed']);
let social = DEFAULT_SOCIAL_SETTINGS;
export function getSocialSettings() { return social; }
export function normalizeSocialSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '在线玩家功能设置无效' };
  if (Object.keys(value).some(k => !Object.hasOwn(DEFAULT_SOCIAL_SETTINGS, k) || typeof value[k] !== 'boolean')) return { error: '在线玩家功能设置必须为开或关' };
  return { settings: Object.freeze({ ...social, ...value }) };
}
export function setSocialSettings(value) {
  const result = normalizeSocialSettings(value);
  if (result.error) return result;
  social = result.settings; return { ok: true };
}
const DEFAULT_PREP = Object.freeze({ mode: 'default' });
let prep = DEFAULT_PREP;
// New-room rule default and live permission to edit it; a Match without an explicit rule retains the legacy fallback.
let roundCharts = true;
let liveRoundDamage = true;
let showPwaInstall = true;
export function getSeatAvatars() { return roomCreation.defaults.seatAvatars; }
export function setSeatAvatars(value) {
  if (typeof value !== 'boolean') return { error: '座位头像设置必须为开或关' };
  roomCreation.defaults.seatAvatars = value;
  return { ok: true };
}
// Default on; a saved console choice wins over an explicit legacy environment override.
let allowAiTakeover = null;
export function getAllowAiTakeover() { return allowAiTakeover ?? !/^(0|false|no|off)$/i.test(process.env.SP_AI_TAKEOVER || ''); }
export function setAllowAiTakeover(value) {
  if (typeof value !== 'boolean') return { error: '观战接替 AI 权限必须为开或关' };
  allowAiTakeover = value;
  roomCreation.hostControls.aiTakeoverEnabled = value;
  if (!value) roomCreation.defaults.aiTakeoverEnabled = false;
  return { ok: true };
}
export function getShowPwaInstall() { return showPwaInstall; }
export function setShowPwaInstall(value) {
  if (typeof value !== 'boolean') return { error: '桌面安装按钮设置必须为开或关' };
  showPwaInstall = value;
  return { ok: true };
}

// ---- 表情弹幕 + 信号条 (the host's console, 2026-11-03) -----------------------------------------------------------
// The in-match signal bar (ui/pingTools.js) grows two cells when the barrage is allowed: a 表情弹幕 picker and a
// 表情设置 panel. `signalBar` decides whether the original 标点 buttons stay beside them. The rate cap is enforced by
// the match (server/match/barrage.js) per player per rolling second; 0 = unlimited.
let emoteBarrage = true;
let signalBar = true;
let emoteBarrageRate = 20;
export function getEmoteBarrage() { return emoteBarrage; }
export function setEmoteBarrage(value) {
  if (typeof value !== 'boolean') return { error: '表情弹幕设置必须为开或关' };
  emoteBarrage = value;
  return { ok: true };
}
export function getSignalBar() { return signalBar; }
export function setSignalBar(value) {
  if (typeof value !== 'boolean') return { error: '信号条设置必须为开或关' };
  signalBar = value;
  return { ok: true };
}
export function getEmoteBarrageRate() { return emoteBarrageRate; }
/**
 * Validate a 每秒弹幕上限 value: blank / 0 = no cap; otherwise a whole number from 1 to EMOTE_BARRAGE_RATE_MAX.
 * @param {unknown} value
 * @returns {{ rate: number } | { error: string }}
 */
export function normalizeEmoteBarrageRate(value) {
  if (value === '' || value == null) return { rate: 0 };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > EMOTE_BARRAGE_RATE_MAX) {
    return { error: `每秒弹幕上限必须为 0（不限）到 ${EMOTE_BARRAGE_RATE_MAX} 的整数` };
  }
  return { rate: n };
}
export function setEmoteBarrageRate(value) {
  const r = normalizeEmoteBarrageRate(value);
  if (r.error) return r;
  emoteBarrageRate = r.rate;
  return { ok: true };
}
/** The live frame every connected client receives when these three change (`site.settings`). */
export function emoteBarrageFrame() {
  return { emoteBarrage, signalBar, emoteBarrageRate };
}
export function getLiveRoundDamage() { return liveRoundDamage; }
export function setLiveRoundDamage(v) {
  if (typeof v !== 'boolean') return { error: '实时伤害设置必须为开或关' };
  liveRoundDamage = v;
  return { ok: true };
}

export function getRoundCharts() { return roundCharts; }
export function setRoundCharts(v) {
  if (typeof v !== 'boolean') return { error: '局内曲线设置必须为开或关' };
  roundCharts = v;
  return { ok: true };
}

export function getUniteLayerGains() { return roomCreation.defaults.uniteLayerGains; }
export function getAllowRoomUniteLayerGains() { return roomCreation.hostControls.uniteLayerGains; }
export function setAllowRoomUniteLayerGains(v) {
  if (typeof v !== 'boolean') return { error: '房主联防叠层控制权限必须为开或关' };
  roomCreation.hostControls.uniteLayerGains = v;
  return { ok: true };
}

export function setUniteLayerGains(v) {
  if (typeof v !== 'boolean') return { error: '联防叠层设置必须为开或关' };
  roomCreation.defaults.uniteLayerGains = v;
  return { ok: true };
}

const secsOk = (v) => Number.isInteger(v) && v >= 5 && v <= 3600;

/** Validated copy of a prep setting. @returns {{ prep: object } | { error: string }} */
export function normalizePrep(v) {
  const o = v && typeof v === 'object' ? v : {};
  const mode = MODES.has(o.mode) ? o.mode : null;
  if (!mode) return { error: '未知的休整期设置' };
  if (mode === 'scale') {
    const scale = Number(o.scale);
    if (!(scale >= 0.1 && scale <= 10)) return { error: '倍率范围 0.1–10' };
    return { prep: { mode, scale } };
  }
  if (mode === 'fixed') {
    const seconds = Number(o.seconds);
    if (!secsOk(seconds)) return { error: '秒数范围 5–3600 的整数' };
    return { prep: { mode, seconds } };
  }
  if (mode === 'perRound') {
    const rounds = {};
    for (const [k, s] of Object.entries(o.rounds && typeof o.rounds === 'object' ? o.rounds : {})) {
      if (s === '' || s == null) continue;
      const r = Number(k);
      const n = Number(s);
      if (!Number.isInteger(r) || r < 1 || r > 30) return { error: `没有第 ${k} 回合` };
      if (!secsOk(n)) return { error: `第 ${r} 回合：秒数范围 5–3600 的整数` };
      rounds[r] = n;
    }
    return { prep: { mode, rounds } };
  }
  return { prep: { mode } };
}

export function getPrep() { return prep; }

/** @returns {{ ok: true } | { error: string }} */
export function setPrep(v) {
  const r = normalizePrep(v);
  if (r.error) return r;
  prep = Object.freeze(r.prep);
  return { ok: true };
}

/** Back to the data's timers and the official 联防 rule (tests). */
export function resetHostSettings() { prep = DEFAULT_PREP; roomCreation = initialRoomCreation(); roundCharts = true; liveRoundDamage = true; showPwaInstall = true; allowAiTakeover = null; social = DEFAULT_SOCIAL_SETTINGS; emoteBarrage = true; signalBar = true; emoteBarrageRate = 20; }

/** The 休整期 seconds of round r for a match whose data gives `base` (null = untimed stays untimed). */
export function prepSecondsFor(round, base, p = prep) {
  if (!(base > 0)) return null;
  switch (p.mode) {
    case 'scale': return Math.max(1, Math.round(base * p.scale));
    case 'fixed': return p.seconds;
    case 'perRound': return Object.hasOwn(p.rounds, round) ? p.rounds[round] : base;
    case 'untimed': return null;
    default: return base;
  }
}

/** match/prep.js: the prep timer of m's current round. */
export function prepSeconds(m, base) {
  return prepSecondsFor(m.round, base, m.prepOverride ?? prep);
}
