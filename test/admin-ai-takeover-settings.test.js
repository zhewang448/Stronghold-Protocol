import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { startAdmin, loadSettings } from '../server/admin.js';
import { getAllowAiTakeover, setAllowAiTakeover, resetHostSettings } from '../server/match/hostSettings.js';
import { TestClient } from './helpers/wsClient.js';

test('AI takeover permission defaults on and preserves explicit environment and saved choices', t => {
  const prior = process.env.SP_AI_TAKEOVER;
  t.after(() => { if (prior === undefined) delete process.env.SP_AI_TAKEOVER; else process.env.SP_AI_TAKEOVER = prior; resetHostSettings(); });
  delete process.env.SP_AI_TAKEOVER; resetHostSettings(); assert.equal(getAllowAiTakeover(), true);
  process.env.SP_AI_TAKEOVER = '0'; assert.equal(getAllowAiTakeover(), false);
  process.env.SP_AI_TAKEOVER = '1'; assert.equal(getAllowAiTakeover(), true);
  assert.deepEqual(setAllowAiTakeover(false), { ok: true }); assert.equal(getAllowAiTakeover(), false);
  for (const value of [null, 1, 'true', {}, []]) assert.ok(setAllowAiTakeover(value).error);
});

test('console persists AI policy, broadcasts capabilities, rejects unsafe writes and revokes pending votes', async t => {
  const prior = process.env.SP_AI_TAKEOVER; delete process.env.SP_AI_TAKEOVER; resetHostSettings(); setAllowAiTakeover(false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ai-policy-')), file = path.join(dir, 'settings.json');
  let srv, admin; const peers = [];
  t.after(async () => { for (const p of peers) await p.terminate(); await admin?.close(); await srv?.close(); resetHostSettings(); if (prior === undefined) delete process.env.SP_AI_TAKEOVER; else process.env.SP_AI_TAKEOVER = prior; fs.rmSync(dir, { recursive: true, force: true }); });
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, botRehearsal: 0 });
  admin = await startAdmin({ lobby: srv.lobby, network: srv.network, port: 0, settingsFile: file, resultsDir: dir, log: { info() {}, error() {} } });
  const api = async body => { const res = await fetch(admin.url + '/api/settings', { method: body ? 'POST' : 'GET', headers: { 'x-admin-token': admin.token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return res.json(); };
  const player = async name => { const c = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws'); peers.push(c); const w = await c.hello(name); c.id = w.playerId; return c; };
  const host = await player('Host'); await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const room = [...srv.lobby.rooms.values()][0];
  assert.equal(room.toState().canSetAiTakeover, false); assert.equal((await api()).allowAiTakeover, false);
  assert.equal((await host.request({ t: 'room.setAiTakeover', on: true })).t, 'error');
  assert.equal((await fetch(admin.url + '/api/settings', { method: 'POST', body: JSON.stringify({ allowAiTakeover: true }) })).status, 403);
  host.clearInbox(); assert.equal((await api({ allowAiTakeover: true })).allowAiTakeover, true);
  await host.waitFor('room.state', s => s.canSetAiTakeover === true);
  assert.equal((await host.request({ t: 'room.setAiTakeover', on: true })).t, 'ok');
  const saved = fs.readFileSync(file, 'utf8');
  for (const value of [null, 1, 'false', {}]) { assert.ok((await api({ allowAiTakeover: value })).error); assert.equal(fs.readFileSync(file, 'utf8'), saved); }
  await api({ prep: { mode: 'default' } }); assert.equal((await api()).allowAiTakeover, true);
  resetHostSettings(); loadSettings(file, { error: assert.fail }); assert.equal(getAllowAiTakeover(), true);
  for (let i = 0; i < 3; i++) await host.request({ t: 'room.addBot' });
  assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
  const m = room.match; m.startRound(1); m.phase = 'PREP'; m.setDeadline(0); for (const p of m.order) p._botPrepToken = (p._botPrepToken || 0) + 1;
  const late = await player('Late'); await late.request({ t: 'room.spectate', code: room.code });
  assert.equal((await late.request({ t: 'room.aiRequest', botId: m.order[1].playerId })).t, 'ok'); assert.equal(room.aiTakeoverVotes.length, 1);
  assert.equal((await api({ allowAiTakeover: false })).allowAiTakeover, false);
  assert.equal(room.aiTakeoverEnabled, false); assert.equal(room.aiTakeoverVotes.length, 0);
  assert.equal((await late.request({ t: 'room.aiRequest', botId: m.order[1].playerId })).t, 'error');
  process.env.SP_AI_TAKEOVER = '1'; resetHostSettings(); loadSettings(file, { error: assert.fail }); assert.equal(getAllowAiTakeover(), false, 'saved off wins over environment');
  const backup = file + '.saved'; fs.renameSync(file, backup); fs.mkdirSync(file);
  assert.ok((await api({ allowAiTakeover: true })).error); assert.equal(getAllowAiTakeover(), false);
  fs.rmdirSync(file); fs.renameSync(backup, file);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).allowAiTakeover, false);
});
