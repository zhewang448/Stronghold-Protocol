import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { startAdmin, loadSettings } from '../server/admin.js';
import { Room } from '../server/lobby.js';
import { getSeatAvatars, resetHostSettings } from '../server/match/hostSettings.js';

test('console avatar default validates and persists for new rooms without altering existing choices', async t => {
  resetHostSettings();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-seat-avatars-'));
  const settingsFile = path.join(dir, 'settings.json');
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false });
  const admin = await startAdmin({ lobby: server.lobby, port: 0, settingsFile, resultsDir: dir, log: { info() {}, error() {} } });
  t.after(async () => { await admin.close(); await server.close(); resetHostSettings(); fs.rmSync(dir, { recursive: true, force: true }); });
  const room = new Room('AVAT', 'coop', 'NORMAL', 0);
  server.lobby.rooms.set(room.code, room);
  const frames = [];
  server.lobby.broadcastState = value => frames.push(value.toState());
  const save = async body => (await fetch(admin.url + '/api/settings', {
    method: 'POST', headers: { 'x-admin-token': admin.token, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })).json();
  assert.equal(room.toState().seatAvatars, undefined);
  assert.equal((await save({ seatAvatars: true })).ok, true);
  assert.equal(frames.length, 0);
  assert.equal(room.seatAvatars, false);
  assert.equal(new Room('NEXT', 'coop', 'NORMAL', 0).seatAvatars, true);
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).seatAvatars, true);
  assert.ok((await save({ roundCharts: false })).ok);
  const saved = fs.readFileSync(settingsFile, 'utf8');
  assert.ok((await save({ seatAvatars: 'false' })).error);
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), saved);
  const backup = settingsFile + '.saved';
  fs.renameSync(settingsFile, backup); fs.mkdirSync(settingsFile);
  assert.ok((await save({ seatAvatars: false })).error);
  assert.equal(getSeatAvatars(), true);
  assert.equal(room.seatAvatars, false);
  fs.rmdirSync(settingsFile); fs.renameSync(backup, settingsFile);
  resetHostSettings(); loadSettings(settingsFile, { error: assert.fail });
  assert.equal(getSeatAvatars(), true);
  room.seatAvatars = true;
  assert.ok((await save({ seatAvatars: false })).ok);
  assert.equal(room.seatAvatars, true, 'changing the default never edits an existing room choice');
  assert.equal(new Room('OFF', 'coop', 'NORMAL', 0).seatAvatars, false);
});
