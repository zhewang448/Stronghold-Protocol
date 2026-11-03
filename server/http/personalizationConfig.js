// server/http/personalizationConfig.js — the server's 座位卡 appearance switches, for every room and every player of
// this server process. It is a deployment file, not a room option and not part of a match, a replay frame or a rule:
//
//   local/personalization.json
//   { "avatarFirst": true, "customIllust": true }
//
//   avatarFirst   座位卡头像优先（悬停看盟约）: the seat cards draw each doctor's own avatar (ui/customAvatar.js) instead of
//                 the 名片立绘, and the covenant (盟约) is read off that avatar on hover / long-press / tap.
//   customIllust  座位卡自定义立绘: a seat card's 立绘 position draws the picture that doctor uploaded (GET /illust/<id>,
//                 ui/illustPicker.js) instead of the operator's illustration, framed by the existing 立绘调整
//                 (ui/cardArt.js, sp.pref.room.cardArt).
//
// Read once when the server starts; the host console can rewrite it at any time (POST /api/host/personalization →
// writePersonalizationConfig + reloadPersonalization, no restart). No player can change either switch. The file is
// optional:
//   * no file                          → both on (the maintainer's default), silently;
//   * a field missing                  → that field's default;
//   * a field that is not a boolean, or a file that is not readable JSON → the default, with console.warn — the server
//                                        still starts and every room keeps rendering.
// Both served to the clients as room.state.personalization (server/lobby.js Room.toState); off = the rendering of the
// version before these switches existed (the covenant icon and the operator's own illustration).
//
// i18n-ignore-file: host-console messages in Chinese, not player UI (tools/i18n.mjs)

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

/** `local/personalization.json` of this deployment (next to `local/personal-data.json`). */
export const PERSONALIZATION_CONFIG_FILE = path.join(ROOT, 'local', 'personalization.json');

/** The maintainer's default: both on. Also the fallback of every field the file does not state properly. */
export const PERSONALIZATION_DEFAULTS = Object.freeze({ avatarFirst: true, customIllust: true });

/** The two switches, in the order the file and the console read them. */
export const PERSONALIZATION_FIELDS = Object.freeze(Object.keys(PERSONALIZATION_DEFAULTS));

/** The file stays small: anything larger is not this file (and is not parsed). */
const MAX_FILE_BYTES = 32 * 1024;

/**
 * One switch set out of whatever the file held: a boolean is taken, anything else falls back to the default with a
 * warning. A missing field is the default (silently: `{ "avatarFirst": false }` alone is a whole, valid file).
 * @param {any} raw parsed JSON (or anything else)
 * @param {(message: string) => void} [warn]
 * @returns {{avatarFirst: boolean, customIllust: boolean}}
 */
export function normalizePersonalizationConfig(raw, warn = console.warn) {
  const config = { ...PERSONALIZATION_DEFAULTS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warn('[personalization] local/personalization.json 不是一个 JSON 对象，已全部使用默认值（两项都开启）');
    return config;
  }
  for (const field of PERSONALIZATION_FIELDS) {
    if (!Object.hasOwn(raw, field)) continue;
    if (typeof raw[field] === 'boolean') config[field] = raw[field];
    else warn(`[personalization] local/personalization.json 的 ${field} 必须是 true 或 false，已使用默认值 ${config[field]}`);
  }
  const unknown = Object.keys(raw).filter((key) => !PERSONALIZATION_FIELDS.includes(key));
  if (unknown.length) warn(`[personalization] local/personalization.json 有未知字段 ${unknown.join(', ')}，已忽略`);
  return config;
}

/**
 * The switches this deployment states, or the defaults. Never throws: an unreadable or broken file is a warning and the
 * defaults (the server keeps starting; the console shows why).
 * @param {string} [file]
 * @param {(message: string) => void} [warn]
 */
export function readPersonalizationConfig(file = PERSONALIZATION_CONFIG_FILE, warn = console.warn) {
  let text;
  try {
    if (fs.statSync(file).size > MAX_FILE_BYTES) {
      warn(`[personalization] ${file} 超过 ${MAX_FILE_BYTES} 字节，已忽略（两项都使用默认值）`);
      return { ...PERSONALIZATION_DEFAULTS };
    }
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // No file at all is the normal deployment: both on, no noise. Anything else (permissions, a directory) is worth one.
    if (err?.code !== 'ENOENT') warn(`[personalization] 读不到 ${file}（${err?.message || err}），两项都使用默认值`);
    return { ...PERSONALIZATION_DEFAULTS };
  }
  let raw;
  try { raw = JSON.parse(text); } catch (err) {
    warn(`[personalization] ${file} 不是有效的 JSON（${err?.message || err}），两项都使用默认值`);
    return { ...PERSONALIZATION_DEFAULTS };
  }
  return normalizePersonalizationConfig(raw, warn);
}

/** Loaded once per server process: a change to the file reaches the rooms at the next restart. */
let current = null;

/** The server's switches (a frozen copy — room.state sends its own). */
export function getPersonalization() {
  if (!current) current = Object.freeze(readPersonalizationConfig());
  return current;
}

/**
 * Re-read the file now (a restart does this on its own; tests and the local console use it). The value a room.state
 * frame carries is this one from the next frame on.
 */
export function reloadPersonalization(file = PERSONALIZATION_CONFIG_FILE, warn = console.warn) {
  current = Object.freeze(readPersonalizationConfig(file, warn));
  return current;
}

/**
 * Write both switches to `local/personalization.json` for the host console's POST /api/host/personalization. The write
 * is atomic (a temp file in the same folder, then a rename), so a crash or a full disk never leaves half a JSON file
 * behind; the caller re-reads with `reloadPersonalization()` — every room's next frame already carries the new value.
 * Throws on a value that is not a boolean or on a filesystem error, so the console can show the reason.
 * @param {{avatarFirst: boolean, customIllust: boolean}} config
 * @param {string} [file]
 * @returns {{avatarFirst: boolean, customIllust: boolean}} what was written
 */
export function writePersonalizationConfig(config, file = PERSONALIZATION_CONFIG_FILE) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('配置必须是一个 JSON 对象');
  const out = {};
  for (const field of PERSONALIZATION_FIELDS) {
    if (typeof config[field] !== 'boolean') throw new Error(`${field} 必须是 true 或 false`);
    out[field] = config[field];
  }
  const body = JSON.stringify(out, null, 2) + '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* the temp file may never have been created */ }
    throw err;
  }
  return out;
}
