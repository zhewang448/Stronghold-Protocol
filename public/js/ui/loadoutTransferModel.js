// Portable scope-aware loadouts. v3 makes old importers refuse scoped files rather than clear all operators.
import { exportPayload, parseImport, LOADOUT_EXPORT_PARTS } from './loadoutModel.js';
import { snapshotOf, stable } from './loadoutPresetsModel.js';
import { versionById } from '../../../shared/versions.js';
import { N_ } from '../../../shared/i18n.js';
import { cleanSkins } from '../../../shared/skins.js';
import { cleanIds } from './ownershipModel.js';

function withSource(parsed, raw) {
  if (!parsed.ok) return parsed;
  const fail = () => ({ ok: false, error: N_('调配文件包含无效配置，未导入任何内容。') });
  const map = raw?.v === 2 ? raw.byChar : raw?.entries || (raw?.v == null ? raw : {});
  if (map && (typeof map !== 'object' || Array.isArray(map) || Object.keys(map).length > 160)) return fail();
  const safeId = id => /^[A-Za-z0-9_\-.:]{1,64}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
  for (const [id, row] of Object.entries(map || {})) {
    if (!safeId(id)) return fail();
    if (!row || typeof row !== 'object' || Array.isArray(row)) return fail();
    if (Object.hasOwn(row, 'skill') && (!Number.isInteger(row.skill) || row.skill < 0 || row.skill > 9)) return fail();
    if (Object.hasOwn(row, 'module') && (typeof row.module !== 'string' || !/^[A-Za-z0-9_\-.:]{1,64}$/.test(row.module))) return fail();
  }
  const opsPresent = raw && Object.hasOwn(raw, 'ops');
  if (opsPresent) {
    if (!raw.ops || typeof raw.ops !== 'object' || Array.isArray(raw.ops) || Object.keys(raw.ops).length > 256) return fail();
    for (const [id, row] of Object.entries(raw.ops)) {
      if (!safeId(id)) return fail();
      if (!row || typeof row !== 'object' || Array.isArray(row)) return fail();
      if (Object.hasOwn(row, 'potential') && (!Number.isInteger(row.potential) || row.potential < 1 || row.potential > 6)) return fail();
      if (Object.hasOwn(row, 'cultivate') && (!Number.isInteger(row.cultivate) || row.cultivate < 0 || row.cultivate > 3)) return fail();
    }
  }
  if (raw && Object.hasOwn(raw, 'skins')) {
    if (!raw.skins || typeof raw.skins !== 'object' || Array.isArray(raw.skins) || stable(cleanSkins(raw.skins)) !== stable(raw.skins)) return fail();
  }
  const random = raw?.extension?.skinRandom;
  if (random !== undefined && (!random || typeof random !== 'object' || Array.isArray(random)
    || !['all', 'equipped', 'unequipped'].includes(random.scope) || typeof random.auto !== 'boolean')) return fail();
  const locks = raw?.extension?.skinLocks;
  if (locks !== undefined && (!locks || typeof locks !== 'object' || Array.isArray(locks) || Object.keys(locks).length > 256
    || Object.entries(locks).some(([id, on]) => !/^char_\d+_[a-z0-9]+$/.test(id) || on !== true))) return fail();
  return { ...parsed, sourceOps: opsPresent ? Object.keys(raw.ops) : [], legacyOpsPresent: !parsed.sections && !!opsPresent };
}

export function transferPayload(current, parts, scope = null, { now = Date.now(), upstream = false } = {}) {
  const snapshot = snapshotOf(current, parts, [], scope);
  const p = exportPayload(snapshot.loadout.byChar, { now, ops: snapshot.loadout.ops, skins: snapshot.loadout.skins, sections: parts,
    random: current.random, locks: snapshot.loadout.extension.skinLocks, upstream });
  if (scope && upstream) throw new Error('scope');
  if (parts.ownership && !upstream) return { ...p, v: 4, extension: { ...p.extension, v: 3,
    ...(scope ? { scope } : {}), ownership: snapshot.ownership } };
  return scope ? { ...p, v: 3, extension: { ...p.extension, v: 2, scope } } : p;
}
export function parseTransfer(input) {
  let raw = input;
  if (typeof input === 'string') {
    // Let the original parser handle invalid and oversized text, preserving its existing messages.
    if (input.length > 256 * 1024) return parseImport(input);
    try { raw = JSON.parse(input); } catch { return parseImport(input); }
  }
  if (raw?.v === 4) {
    const fail = () => ({ ok: false, error: N_('调配文件包含无效配置，未导入任何内容。') });
    const ext = raw.extension;
    if (raw.kind !== 'stronghold.loadout' || ext?.v !== 3 || !Array.isArray(ext.ownership)
      || stable(cleanIds(ext.ownership)) !== stable(ext.ownership)) return fail();
    const originalSections = ext.sections;
    if (!originalSections || typeof originalSections !== 'object' || Array.isArray(originalSections)
      || Object.keys(originalSections).some(key => !LOADOUT_EXPORT_PARTS.includes(key))
      || LOADOUT_EXPORT_PARTS.some(key => typeof originalSections[key] !== 'boolean')) return fail();
    const onlyOwnership = !LOADOUT_EXPORT_PARTS.some(key => originalSections[key] === true);
    const sections = onlyOwnership ? { ...originalSections, skills: true } : originalSections;
    const legacyExtension = { ...ext, v: ext.scope ? 2 : 1, sections };
    delete legacyExtension.ownership;
    const parsed = parseTransfer({ ...raw, v: ext.scope ? 3 : 2, extension: legacyExtension });
    if (!parsed.ok || ext.scope && ext.ownership.some(id => !ext.scope.charIds.includes(id))) return fail();
    return { ...parsed, sections: { ...parsed.sections, ...(onlyOwnership ? { skills: false } : {}), ownership: true }, ownership: ext.ownership };
  }
  if (raw?.v !== 3) return withSource(parseImport(raw), raw);
  const fail = () => ({ ok: false, error: N_('干员范围数据无效，未导入任何配置。') });
  const scope = raw.extension?.scope;
  if (raw.kind !== 'stronghold.loadout' || raw.extension?.v !== 2 || !scope || !['roster', 'exclusive'].includes(scope.mode)
    || !Array.isArray(scope.versions) || !scope.versions.length || scope.versions.some(id => !versionById(id))
    || new Set(scope.versions).size !== scope.versions.length || !Array.isArray(scope.charIds) || !scope.charIds.length || scope.charIds.length > 1024
    || new Set(scope.charIds).size !== scope.charIds.length || scope.charIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_\-.:]{1,64}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id))) return fail();
  const legacy = { ...raw, v: 2, extension: { ...raw.extension, v: 1 } };
  delete legacy.extension.scope;
  const parsed = parseImport(legacy);
  if (!parsed.ok || !parsed.sections) return fail();
  const ids = new Set(scope.charIds);
  for (const map of [raw.byChar, raw.ops, raw.skins, raw.extension.skinLocks]) {
    if (map && Object.keys(map).some(id => !ids.has(id))) return fail();
  }
  const normalized = exportPayload(parsed.byChar || {}, { now: Date.parse(raw.exportedAt), ops: parsed.ops || {}, skins: parsed.skins || {},
    sections: parsed.sections, random: parsed.skinRandom, locks: parsed.skinLocks });
  // Reject malformed fields instead of sanitising a selected snapshot into a default reset.
  if (stable(normalized.byChar) !== stable(raw.byChar) || stable(normalized.ops) !== stable(raw.ops)
    || stable(normalized.skins) !== stable(raw.skins)
    || stable(normalized.extension) !== stable(legacy.extension)) return fail();
  return { ...parsed, scope: structuredClone(scope) };
}
export function transferParts(parsed) {
  if (!parsed?.ok) return {};
  if (parsed.sections) return parsed.sections;
  const entries = Object.values(parsed.byChar || parsed.entries || {});
  return Object.fromEntries(LOADOUT_EXPORT_PARTS.map(key => [key, key === 'skills' ? entries.some(e => e.skill !== undefined)
    : key === 'modules' ? entries.some(e => e.module !== undefined) : key === 'potential' || key === 'cultivate' ? parsed.legacyOpsPresent || Object.values(parsed.ops || {}).some(e => e[key] !== undefined)
      : key === 'skins' ? parsed.skins !== undefined : key === 'skinRandom' ? !!parsed.skinRandom : !!parsed.skinLocks]));
}
export function restrictTransferScope(fileScope, selectedScope) {
  if (!fileScope) return selectedScope;
  if (!selectedScope) return fileScope;
  const selected = new Set(selectedScope.charIds);
  return { ...selectedScope, charIds: fileScope.charIds.filter(id => selected.has(id)) };
}
