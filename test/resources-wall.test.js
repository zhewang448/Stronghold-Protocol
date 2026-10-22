import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResources } from '../server/resources.js';
import { createTrafficCounter } from '../server/http/traffic.js';
import { wallView } from '../server/admin-wall.js';
import { makeMatch, give } from './match/harness.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { startAdmin } from '../server/admin.js';

test('expanded host wall exposes the twentieth player without dropping high seat indexes', t => {
  const h = makeMatch({ humans: 20, fake: true });
  t.after(() => h.m.dispose());
  const room = { code: 'TEST', seats: h.m.order.map(p => ({ seat: p.seat, playerId: p.playerId, name: p.name, connected: true })), match: h.m };
  const view = wallView({ rooms: new Map([['TEST', room]]) }, 'TEST');
  assert.equal(view.seats.length, 20);
  assert.equal(view.seats[19].playerId, 'p_19');
});

test('resource counters measure real traffic, heartbeat RTT, bounded retention and detach cleanly', (t) => {
  let at = 0;
  const ws = {}, session = { connected: true, ws, name: 'P', playerId: 'p', roomCode: 'TEST' };
  const lobby = { rooms: new Map([['TEST', { spectators: [], match: {} }]]), registry: { all: () => [session] } };
  const network = { conns: new Map([[ws, { session }]]) }, traffic = createTrafficCounter();
  assert.equal(network.monitor, undefined); // No sampler exists unless the console creates one.
  traffic.wsSent('before', ws);
  const r = createResources({ lobby, network, traffic, now: () => at });
  t.after(() => r.close());
  traffic.wsSent('123456', ws); traffic.wsReceived(Buffer.from('abc'), ws);
  at = 1000;
  const row = r.sample();
  assert.equal(row.tx, 6); assert.equal(row.rx, 3);
  assert.deepEqual(row.byRoom, [{ code: 'TEST', tx: 6, rx: 3 }]);
  assert.equal(row.sessions, 1);
  r.monitor.ping(ws); at += 345; r.monitor.pong(ws);
  assert.equal(r.snapshot().players[0].rtt, 345);
  for (let i = 0; i < 610; i++) { at += 1000; r.sample(); }
  assert.equal(r.snapshot().history.length, 600);
  r.close(); assert.equal(network.monitor, undefined);
  traffic.wsSent('after', ws); at += 1000;
  assert.equal(r.sample().tx, 0);
});

test('without a console no resource monitor is attached; local console meters HTTP assets and requires a token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-resources-'));
  const publicDir = path.join(dir, 'public');
  fs.mkdirSync(path.join(publicDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'assets', 'test.png'), Buffer.alloc(3000));
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, publicDir });
  let admin;
  try {
    assert.equal(srv.network.monitor, undefined, 'SP_ADMIN=0 boot skips startAdmin entirely');
    for (const route of ['/api/resources', '/api/wall', '/api/recovery', '/api/results-summary']) {
      assert.equal((await fetch(srv.url + route)).status, 404, 'game port has no host data');
    }
    admin = await startAdmin({ lobby: srv.lobby, network: srv.network, traffic: srv.traffic, port: 0,
      settingsFile: path.join(dir, 'settings.json'), resultsDir: path.join(dir, 'results'), replaysDir: path.join(dir, 'replays'), log: { info() {}, error() {} } });
    const headers = { 'X-Admin-Token': admin.token };
    for (const route of ['/api/resources', '/api/wall', '/api/recovery', '/api/results-summary']) {
      assert.equal((await fetch(admin.url + route)).status, 403);
    }
    assert.ok(srv.network.monitor);
    await (await fetch(srv.url + '/assets/test.png')).arrayBuffer();
    // A snapshot samples immediately until the one-second timer first fires.
    const data = await (await fetch(admin.url + '/api/resources', { headers })).json();
    assert.ok(data.current.assets > 0);
    assert.equal((await fetch(admin.url + '/wall')).status, 404);
    await admin.close(); admin = null;
    assert.equal(srv.network.monitor, undefined);
  } finally { await admin?.close(); await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('wall retains seat order, field geometry, elimination and closed-room state without private-state reads', (t) => {
  const h = makeMatch({ humans: 4, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const m = h.m, ps = m.order[0];
  const id = [...m.pool.entries.keys()].find((id) => !m.gd.isGolden(id));
  give(m, ps, id, 'board', [9, 2]);
  ps.privateView = () => { throw new Error('must not build private state'); };
  const room = { seats: m.order.map((p) => ({ ...p })), match: m };
  const lobby = { rooms: new Map([['TEST', room]]) };
  const view = wallView(lobby, 'TEST');
  assert.equal(view.seats.length, 4); assert.equal(view.round, 1);
  assert.deepEqual([view.seats[0].board[0].row, view.seats[0].board[0].col], [0, 0]);
  ps.alive = false; assert.equal(wallView(lobby, 'TEST').seats[0].alive, false);
  room.match = null; assert.equal(wallView(lobby, 'TEST').round, null);
  lobby.rooms.clear(); assert.ok(wallView(lobby, 'TEST').error);
});
