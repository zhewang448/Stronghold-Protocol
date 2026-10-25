import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessDomainOf } from '../server/net.js';
import { startServer } from '../server/index.js';
import { roomsView } from '../server/admin.js';
import { TestClient } from './helpers/wsClient.js';
import { setTimeout as delay } from 'node:timers/promises';

test('access domain accepts only a bounded HTTP(S) page origin', () => {
  for (const [origin, expected] of [
    ['https://GAME.example.com', 'game.example.com'],
    ['https://game.example.com:443', 'game.example.com'],
    ['http://game.example.com:8080', 'game.example.com:8080'],
    ['http://127.0.0.1:3000', '127.0.0.1:3000'],
    ['http://[::1]:3000', '[::1]:3000'],
    ['https://例子.中国', 'xn--fsqu00a.xn--fiqs8s'],
    [undefined, null], ['null', null], ['', null],
    [['https://game.example.com'], null],
    ['https://one.example, https://two.example', null],
    ['https://user:password@game.example.com', null],
    ['https://game.example.com/', null],
    ['https://game.example.com/path?token=secret', null],
    ['https://game.example.com#fragment', null],
    ['https://game.example.com' + String.fromCharCode(92) + 'evil', null],
    ['https://game.example.com' + String.fromCharCode(10), null],
    ['https://<script>.example', null],
    ['file://game.example.com', null],
    ['https://' + 'a'.repeat(1024), null],
  ]) assert.equal(accessDomainOf({ headers: { origin } }), expected, String(origin));
  assert.equal(accessDomainOf(), null);
  assert.equal(accessDomainOf({ headers: { host: 'internal:3000', 'x-forwarded-host': 'proxy.example' } }), null);
});

test('real handshake domain updates on resume, stays admin-only, and clears when unknown', async t => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const clients = [];
  t.after(async () => { for (const c of clients) await c.close(); await srv.close(); });
  const connect = async origin => {
    const c = await TestClient.connect('ws://127.0.0.1:' + srv.port + '/ws', { wsOptions: { headers: {
      ...(origin ? { origin } : {}), host: 'internal:3000', 'x-forwarded-host': 'proxy.example',
    } } });
    clients.push(c);
    return c;
  };
  const first = await connect('https://old.example.com:8443');
  const welcome = await first.hello('Doctor');
  assert.equal(Object.hasOwn(welcome, 'accessDomain'), false);
  await first.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
  const state = await first.waitFor('room.state');
  assert.equal(JSON.stringify(state).includes('old.example.com'), false);
  const view = async () => (await roomsView(srv.lobby))[0].seats.find(p => p.id === welcome.playerId);
  assert.equal((await view()).accessDomain, 'old.example.com:8443');
  const session = srv.lobby.registry.byId(welcome.playerId);
  await first.close();
  for (let i = 0; i < 100 && session.connected; i++) await delay(10);
  assert.equal((await view()).accessDomain, 'old.example.com:8443');
  assert.equal((await view()).connected, false);
  const second = await connect('https://new.example.com');
  const resumed = await second.hello('Doctor', welcome.token);
  assert.equal(resumed.playerId, welcome.playerId);
  assert.equal((await view()).accessDomain, 'new.example.com');
  assert.equal(session.accessDomain, 'new.example.com');
  await second.close();
  const unknown = await connect();
  await unknown.hello('Doctor', welcome.token);
  assert.equal((await view()).accessDomain, null);
});
