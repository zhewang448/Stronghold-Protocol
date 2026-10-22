// This per-origin bookkeeping is intentionally excluded from portable personal-data backups.
export const BACKUP_REMINDER_KEY = 'sp.backup.reminder';
const DAY = 86400000;
export const isTemporaryHost = (host) => /^[a-z0-9-]+\.trycloudflare\.com$/i.test(host || '');
export function reminderState(storage, now = Date.now()) {
  try {
    storage ||= globalThis.localStorage;
    const value = JSON.parse(storage.getItem(BACKUP_REMINDER_KEY) || 'null');
    if (value && typeof value === 'object') return { enabled: value.enabled !== false,
      firstSeen: Number.isFinite(value.firstSeen) && value.firstSeen > 0 ? value.firstSeen : now,
      exportedAt: Number.isFinite(value.exportedAt) && value.exportedAt > 0 ? value.exportedAt : 0,
      dismissedAt: Number.isFinite(value.dismissedAt) && value.dismissedAt > 0 ? value.dismissedAt : 0 };
  } catch {}
  return { enabled: true, firstSeen: now, exportedAt: 0, dismissedAt: 0 };
}
export function updateReminder(patch, storage, now = Date.now()) {
  const value = { ...reminderState(storage, now), ...patch };
  try { storage ||= globalThis.localStorage; storage.setItem(BACKUP_REMINDER_KEY, JSON.stringify(value)); } catch { return false; }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('sp:backup-reminder'));
  return true;
}
export function backupDue(storage, host, now = Date.now()) {
  const s = reminderState(storage, now);
  try { storage ||= globalThis.localStorage; if (!storage.getItem('sp.name') && !storage.getItem('sp.pref.stats')) return false; } catch { return false; }
  if (!s.enabled || (s.dismissedAt > 0 && now - s.dismissedAt < DAY) || (s.exportedAt > 0 && now - s.exportedAt < 7 * DAY)) return false;
  return isTemporaryHost(host) || now - s.firstSeen >= 7 * DAY;
}
export function initializeReminder(storage, now = Date.now()) {
  try { storage ||= globalThis.localStorage; if (storage.getItem(BACKUP_REMINDER_KEY) == null) updateReminder({}, storage, now); } catch {}
}
