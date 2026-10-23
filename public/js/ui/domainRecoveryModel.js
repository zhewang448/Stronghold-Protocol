// Origin-local metadata only. Probes never update the last actual game entry.
import { personalKey } from './personalData.js';
export const LAST_ENTRY_KEY = 'sp.pref.lastEnteredAt';
export const RECOVERY_SEEN_KEY = 'sp.recovery.seen';
export function markGameEntry(storage = globalThis.localStorage, now = Date.now()) {
  try { storage.setItem(LAST_ENTRY_KEY, JSON.stringify(now)); } catch { /* game entry remains usable */ }
}
export async function storedMediaSummary() {
  const { readBackdrop, readMusic } = await import('./personalData.js');
  const [backdrop, music] = await Promise.all([readBackdrop(), readMusic()]);
  return { backdrop: !!backdrop, music: !!music?.blob };
}
export function domainConfig(raw = {}) {
  const clean = (value) => {
    try { const u = new URL(value); return !u.username && !u.password && ['http:', 'https:'].includes(u.protocol) && u.pathname === '/' && !u.search && !u.hash ? u.origin : ''; } catch { return ''; }
  };
  const canonicalOrigin = clean(raw.canonicalOrigin);
  const rows = Array.isArray(raw.sources) ? raw.sources.slice(0, 12) : raw.migrationSource ? [{ origin: raw.migrationSource, mode: 'normal', enabled: true }] : [];
  const seen = new Set();
  return { canonicalOrigin, sources: rows.filter((r) => r && r.enabled !== false).flatMap((r) => {
    const origin = clean(r.origin);
    if (!origin || origin === canonicalOrigin || seen.has(origin)) return [];
    seen.add(origin);
    return [{ origin, label: typeof r.label === 'string' ? r.label.slice(0, 80) : '', mode: ['normal', 'notice', 'smart', 'redirect'].includes(r.mode) ? r.mode : 'normal' }];
  }) };
}
export async function fetchDomainConfig() {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
  try { const r = await fetch('/personal-data-config.json', { cache: 'no-store', signal: controller.signal }); return domainConfig(r.ok ? await r.json() : {}); }
  catch { return domainConfig(); } finally { clearTimeout(timer); }
}
export function storedPersonalSummary(storage = globalThis.localStorage) {
  // Throw on denied storage; callers must distinguish unreadable from empty.
  const json = (key) => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch (e) { if (e instanceof SyntaxError) return null; throw e; } };
  const profile = json('sp.pref.localAccount') || {}, stats = json('sp.pref.stats');
  const records = Array.isArray(stats?.records) ? stats.records : [];
  const recentMatchAt = records.reduce((n, r) => Math.max(n, Number.isFinite(r?.t) && r.t > 0 ? r.t : 0), 0);
  const lastEnteredAt = json(LAST_ENTRY_KEY);
  let count = 0;
  for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key !== LAST_ENTRY_KEY && personalKey(key)) count++; }
  const name = (storage.getItem('sp.name') || '').slice(0, 64);
  const avatar = typeof profile.avatar === 'string' && profile.avatar.length <= 160000 && /^data:image\/(jpeg|png|webp);base64,/.test(profile.avatar) ? profile.avatar : null;
  return { name, tag: /^\d{4}$/.test(profile.tag) ? profile.tag : '', avatar, records: records.length, count,
    lastEnteredAt: Number.isFinite(lastEnteredAt) && lastEnteredAt > 0 ? lastEnteredAt : null, recentMatchAt: recentMatchAt || null,
    backdrop: !!json('sp.pref.hub.backdrop'), hasData: !!(name.trim() || records.length || count) };
}
export function migrationRequest(hash) {
  try {
    const raw = JSON.parse(decodeURIComponent(hash.replace(/^#sp-recover-source=/, '')));
    const url = new URL(raw.origin), origin = url.origin;
    if (!hash.startsWith('#sp-recover-source=') || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || !/^[a-f0-9]{32}$/.test(raw.nonce)) return null;
    return { origin, nonce: raw.nonce, ...(raw.auto === true ? { auto: true } : {}) };
  } catch { return null; }
}
