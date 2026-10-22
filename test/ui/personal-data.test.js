import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePersonalData, encodePersonalData, decodePersonalData, restorePersonalData, validatePersonalData, personalKey,
  personalSummary, migrationOrigin, validMigrationMessage } from '../../public/js/ui/personalData.js';
import { buildRecord, STATS_VERSION } from '../../public/js/ui/stats.js';
import { BACKUP_REMINDER_KEY, backupDue, initializeReminder, isTemporaryHost, reminderState, updateReminder } from '../../public/js/ui/backupReminder.js';

function storage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}
const envelope = (entries = {}, backdrop = null) => ({ app: 'stronghold-protocol', kind: 'personal-data', v: 1,
  exportedAt: '2026-10-19T12:00:00.000Z', entries, backdrop });
const record = (seed) => buildRecord({ seed, victory: true, roundsPassed: 15, players: [
  { playerId: 'p1', name: '博士', alive: true, victory: true, roundsPassed: 15, stats: {}, trophies: 5 },
] }, { myId: 'p1', now: seed * 1000 });

test('portable profile backups get a gentle reminder while temporary links get an immediate prompt', () => {
  const now = Date.UTC(2026, 9, 21), local = storage({ 'sp.name': '博士' });
  initializeReminder(local, now);
  assert.equal(backupDue(local, 'example.test', now + 6 * 86400000), false);
  assert.equal(backupDue(local, 'example.test', now + 7 * 86400000), true);
  assert.equal(isTemporaryHost('fresh.trycloudflare.com'), true);
  assert.equal(backupDue(local, 'fresh.trycloudflare.com', now), true);
  updateReminder({ dismissedAt: now }, local, now);
  assert.equal(backupDue(local, 'fresh.trycloudflare.com', now + 12 * 3600000), false);
  assert.equal(backupDue(local, 'fresh.trycloudflare.com', now + 86400000), true);
  updateReminder({ enabled: false }, local, now + 86400000);
  assert.equal(backupDue(local, 'fresh.trycloudflare.com', now + 8 * 86400000), false);
  updateReminder({ enabled: true, exportedAt: now + 8 * 86400000 }, local, now + 8 * 86400000);
  assert.equal(backupDue(local, 'fresh.trycloudflare.com', now + 8 * 86400000), false);
  assert.equal(reminderState(local, now).enabled, true);
  assert.equal(BACKUP_REMINDER_KEY, 'sp.backup.reminder');
});

test('captures every personal namespace and backdrop, excludes sessions, grants and server keys', async () => {
  const ls = storage({ 'sp.name': '博士😀', 'sp.pref.settings': '{"textSize":1.2}', 'sp.pref.localAccount': '{"tag":"1234"}',
    'sp.pref.loadout': '{}', 'sp.pref.skins': '{}', 'sp.plugin.my-plugin.score': '9', 'sp.plugin.consent.hash': 'yes',
    'sp.token': 'secret', 'sp.tokens': '["secret"]', 'sp.matches': '[]', 'admin.key': 'secret',
    'sp.pref.recentRooms': '["OLD"]', 'sp.pref.stats.damaged': 'bad' });
  const raw = await capturePersonalData(ls, async () => new Blob(['picture'], { type: 'image/jpeg' }), async () => null);
  assert.equal(Object.keys(raw.entries).length, 6);
  assert.equal(raw.entries['sp.name'], '博士😀');
  assert.equal(raw.backdrop.type, 'image/jpeg');
  assert.equal(atob(raw.backdrop.data), 'picture');
  assert.equal(personalKey('__proto__'), false);
  assert.equal(personalKey('sp.plugin.consent.hash'), false);
  assert.equal(personalKey('sp.plugin.123-test.score'), true);
  assert.equal(personalKey('sp.plugin.sample.__proto__'), false);
  assert.equal(personalKey('sp.pref.chatPosition.name.博士'), true);
});
test('compressed and uncompressed recovery codes round-trip Chinese, emoji and media', async () => {
  const raw = envelope({ 'sp.name': '中文😀', 'sp.pref.settings': '{"music":0}' }, { type: 'image/png', data: btoa('image') });
  const code = await encodePersonalData(raw);
  assert.deepEqual(await decodePersonalData(` ${code} `), validatePersonalData(raw));
  const saved = globalThis.CompressionStream;
  try {
    globalThis.CompressionStream = undefined;
    const plain = await encodePersonalData(raw);
    assert.ok(plain.startsWith('SPDATA1.j.'));
    assert.deepEqual(await decodePersonalData(plain), validatePersonalData(raw));
  } finally { globalThis.CompressionStream = saved; }
});
test('rejects truncated, corrupted, foreign, future, executable-media and unknown-key payloads', async () => {
  const code = await encodePersonalData(envelope());
  await assert.rejects(decodePersonalData(code.slice(0, -6)), { code: 'invalid' });
  await assert.rejects(decodePersonalData(code.replace(/\.[a-f0-9]{8}\./, '.00000000.')), { code: 'invalid' });
  for (const raw of [ { ...envelope(), app: 'other' }, envelope({ 'sp.token': 'secret' }),
    envelope({ 'sp.pref.settings': 'bad JSON' }), envelope({}, { type: 'image/svg+xml', data: btoa('<script/>') }) ]) {
    assert.throws(() => validatePersonalData(raw), { code: 'invalid' });
  }
  assert.throws(() => validatePersonalData({ ...envelope(), v: 2 }), { code: 'newer' });
});
test('rejects oversized entries and invalid stats without writing', async () => {
  assert.throws(() => validatePersonalData(envelope({ 'sp.pref.large': JSON.stringify('a'.repeat(8 * 1024 * 1024)) })), { code: 'too-large' });
  const ls = storage({ 'sp.name': 'current' });
  await assert.rejects(restorePersonalData(envelope({ 'sp.pref.stats': '{"v":99,"records":[]}' }), { storage: ls }), { code: 'newer' });
  await assert.rejects(restorePersonalData(envelope({ 'sp.pref.stats': '{"v":3,"records":[null]}' }), { storage: ls }), { code: 'invalid' });
  assert.deepEqual([...ls.map], [['sp.name', 'current']]);
});
test('restores profile and settings, merges match ids and keeps unrelated storage', async () => {
  const a = record(1), b = record(2);
  assert.ok(a && b);
  const ls = storage({ 'sp.name': 'current', 'sp.token': 'stay', 'sp.pref.settings': '{}',
    'sp.pref.stats': JSON.stringify({ v: STATS_VERSION, records: [a] }) });
  const raw = envelope({ 'sp.name': 'restored', 'sp.pref.settings': '{"music":0}',
    'sp.pref.stats': JSON.stringify({ v: STATS_VERSION, records: [a, b] }) });
  await restorePersonalData(raw, { storage: ls });
  await restorePersonalData(raw, { storage: ls });
  assert.equal(ls.getItem('sp.name'), 'restored');
  assert.equal(ls.getItem('sp.token'), 'stay');
  assert.deepEqual(JSON.parse(ls.getItem('sp.pref.stats')).records.map((r) => r.id), [b.id, a.id]);
  assert.equal(personalSummary(raw).records, 2);
});
test('future local stats are never overwritten', async () => {
  const ls = storage({ 'sp.pref.stats': '{"v":999,"records":[]}' });
  await assert.rejects(restorePersonalData(envelope({ 'sp.pref.stats': '{"v":3,"records":[]}' }), { storage: ls }), { code: 'newer' });
  assert.equal(ls.getItem('sp.pref.stats'), '{"v":999,"records":[]}');
});
test('quota failure restores previously written keys and old backdrop', async () => {
  const ls = storage({ 'sp.name': 'old', 'sp.pref.settings': '{}' });
  const original = new Map(ls.map), set = ls.setItem;
  ls.setItem = (key, value) => { if (key === 'sp.pref.settings' && value !== '{}') throw new Error('quota'); set(key, value); };
  let media = new Blob(['old'], { type: 'image/jpeg' });
  await assert.rejects(restorePersonalData(envelope({ 'sp.name': 'new', 'sp.pref.new': 'true', 'sp.pref.settings': '{"a":1}' },
    { type: 'image/jpeg', data: btoa('new') }), { storage: ls, readMedia: async () => media, writeMedia: async (v) => { media = v; } }), { code: 'storage' });
  assert.deepEqual(ls.map, original);
  assert.equal(await media.text(), 'old');
});
test('media write failure rolls back before any preferences change', async () => {
  const ls = storage({ 'sp.name': 'old' });
  let writes = 0;
  await assert.rejects(restorePersonalData(envelope({ 'sp.name': 'new' }, { type: 'image/png', data: btoa('new') }),
    { storage: ls, readMedia: async () => null, writeMedia: async () => { ++writes; throw new Error('quota'); } }), { code: 'storage' });
  assert.equal(ls.getItem('sp.name'), 'old');
  assert.equal(writes, 1, 'an aborted atomic IDB write does not require another write');
});
test('restoring a procedural backdrop removes the previous custom media', async () => {
  let media = new Blob(['old']);
  await restorePersonalData(envelope({ 'sp.pref.hub.backdrop': '{"theme":"night"}' }),
    { storage: storage(), readMedia: async () => media, writeMedia: async (v) => { media = v; } });
  assert.equal(media, null);
});
test('custom music preserves enabled/paused and participates in rollback and deletion', async () => {
  const ls = storage({ 'sp.name': 'old' });
  let track = { name: 'old.mp3', blob: new Blob(['old']), enabled: false, paused: true };
  const io = { storage: ls, readTrack: async () => track, writeTrack: async (v) => { track = v; } };
  const raw = { ...envelope({ 'sp.name': 'new' }), music: { name: 'new.mp3', type: 'audio/mpeg', data: btoa('new'), enabled: true, paused: false } };
  await restorePersonalData(raw, io);
  assert.equal(await track.blob.text(), 'new');
  assert.equal(track.enabled, true); assert.equal(track.paused, false);
  const saved = ls.setItem;
  ls.setItem = () => { throw new Error('quota'); };
  await assert.rejects(restorePersonalData({ ...envelope({ 'sp.name': 'other' }), music: null }, io), { code: 'storage' });
  assert.equal(await track.blob.text(), 'new');
  ls.setItem = saved;
  await restorePersonalData({ ...envelope(), music: null }, io);
  assert.equal(track, null);
});
test('migration requires the exact window, origin and one-time nonce', () => {
  const popup = {}, event = { source: popup, origin: 'https://old.example', data: { type: 'sp.personal-data', nonce: 'nonce' } };
  assert.equal(validMigrationMessage(event, popup, event.origin, 'nonce'), true);
  assert.equal(validMigrationMessage({ ...event, source: {} }, popup, event.origin, 'nonce'), false);
  assert.equal(validMigrationMessage({ ...event, origin: 'https://evil.example' }, popup, event.origin, 'nonce'), false);
  assert.equal(validMigrationMessage(event, popup, event.origin, 'other'), false);
  for (const url of ['javascript:alert(1)', 'https://user:pass@old.example', 'https://new.example']) {
    assert.throws(() => migrationOrigin(url, 'https://new.example'), { code: 'origin' });
  }
  assert.equal(migrationOrigin('https://old.example/path', 'https://new.example'), 'https://old.example');
});
