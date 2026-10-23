// Optional deployment default. The machine's address stays in ignored local/, never in source.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
export const PERSONAL_DATA_CONFIG_FILE = path.join(ROOT, 'local', 'personal-data.json');
export const DOMAIN_MODES = ['normal', 'notice', 'smart', 'redirect'];

/** Strict deployment input: only full origins, no paths, credentials or fragments. */
export function normalizePersonalDataConfig(raw) {
  const origin = (value) => {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('请输入完整的 HTTP(S) 网址');
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error('网址只能包含协议、域名和端口，不能包含路径、密码或参数');
    return url.origin;
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('域名配置格式无效');
  const canonicalOrigin = raw.canonicalOrigin ? origin(raw.canonicalOrigin) : '';
  if (!Array.isArray(raw.sources) || raw.sources.length > 12) throw new Error('最多配置 12 个旧网址');
  const seen = new Set();
  const sources = raw.sources.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('旧网址配置无效');
    const url = origin(row.origin);
    if (url === canonicalOrigin || seen.has(url)) throw new Error('旧网址不能重复或与正式网址相同');
    seen.add(url);
    const label = row.label ?? '';
    if (typeof label !== 'string' || label.length > 80 || /[\x00-\x1f]/.test(label)) throw new Error('显示名称最多 80 字且不能包含控制字符');
    if (!DOMAIN_MODES.includes(row.mode) || typeof row.enabled !== 'boolean') throw new Error('请选择有效的旧站模式和启用状态');
    return { origin: url, label: label.trim(), mode: row.mode, enabled: row.enabled };
  });
  if (!canonicalOrigin && sources.length) throw new Error('配置旧站前请先填写正式网址');
  return { canonicalOrigin, sources };
}

export function writePersonalDataConfig(raw, file = PERSONAL_DATA_CONFIG_FILE) {
  const config = normalizePersonalDataConfig(raw);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { try { fs.unlinkSync(tmp); } catch { /* renamed or unavailable */ } }
  return config;
}

export function readPersonalDataConfig(file = PERSONAL_DATA_CONFIG_FILE) {
  try {
    if (fs.statSync(file).size > 32768) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Object.hasOwn(raw, 'sources') || Object.hasOwn(raw, 'canonicalOrigin')) return normalizePersonalDataConfig(raw);
    if (typeof raw?.migrationSource !== 'string' || !raw.migrationSource.trim()) return {};
    const url = new URL(raw.migrationSource);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) return {};
    return { migrationSource: url.href };
  } catch { return {}; }
}
