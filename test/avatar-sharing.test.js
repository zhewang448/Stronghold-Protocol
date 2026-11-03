import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSharedAvatar, MAX_AVATAR_LENGTH } from '../shared/avatar.js';
import { validateC2S } from '../shared/protocol.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const avatar = 'data:image/jpeg;base64,/9j/AAAA';
const otherAvatar = 'data:image/jpeg;base64,/9j/BBBB';

test('avatar messages accept bounded JPEG data only and allow explicit removal', () => {
  for (const value of [avatar, null]) assert.equal(validateC2S({ t: 'room.avatar', avatar: value }), null);
  for (const value of [undefined, {}, 'https://example.com/avatar.jpg', 'data:image/svg+xml;base64,AAAA',
    'data:image/jpeg;base64,/9j/!', avatar + 'A'.repeat(MAX_AVATAR_LENGTH)]) {
    assert.equal(isSharedAvatar(value), false);
    assert.ok(validateC2S({ t: 'room.avatar', avatar: value }));
  }
});

test('room avatars synchronize on join, edit, resync and removal without public leakage or repeating ordinary state', async t => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false,
    heavyBurst: 100, rateBurst: 200 });
  const peers = [];
  t.after(async () => { for (const peer of peers) await peer.terminate(); await server.close(); });
  const player = async (name, token = undefined) => {
    const peer = await TestClient.connect(server.url.replace('http', 'ws') + '/ws'); peers.push(peer);
    const welcome = await peer.hello(name, token); peer.playerId = welcome.playerId; peer.token = welcome.token; return peer;
  };
  const host = await player('Host'), guest = await player('Guest'), outsider = await player('Outsider');
  assert.equal((await host.request({ t: 'room.avatar', avatar })).t, 'ok');
  assert.equal((await guest.request({ t: 'room.avatar', avatar: otherAvatar })).t, 'ok');
  await host.request({ t: 'room.create', mode: 'coop' });
  const room = [...server.lobby.rooms.values()][0];
  await guest.request({ t: 'room.join', code: room.code });
  const expected = { [host.playerId]: avatar, [guest.playerId]: otherAvatar };
  await host.waitFor('room.avatars', frame => Object.keys(frame.avatars).length === 2);
  assert.deepEqual((await guest.waitFor('room.avatars')).avatars, expected);
  assert.equal(outsider.log.some(frame => frame.t === 'room.avatars'), false);
  const publicRooms = await outsider.request({ t: 'room.list' });
  assert.equal(JSON.stringify(publicRooms).includes('data:image'), false);
  const before = host.log.filter(frame => frame.t === 'room.avatars').length;
  await host.request({ t: 'room.ready', ready: true });
  assert.equal(host.log.filter(frame => frame.t === 'room.avatars').length, before);
  const spectator = await player('Spectator');
  await spectator.request({ t: 'room.spectate', code: room.code });
  assert.deepEqual((await spectator.waitFor('room.avatars')).avatars, expected);
  host.clearInbox();
  await host.request({ t: 'state.resync' });
  assert.deepEqual((await host.waitFor('room.avatars')).avatars, expected);
  await guest.terminate();
  const resumed = await player('Guest', guest.token);
  assert.deepEqual((await resumed.waitFor('room.avatars')).avatars, expected);
  host.clearInbox();
  await resumed.request({ t: 'room.avatar', avatar: null });
  assert.deepEqual((await host.waitFor('room.avatars')).avatars, { [host.playerId]: avatar });
  await host.request({ t: 'room.avatar', avatar: null });
  assert.deepEqual((await spectator.waitFor('room.avatars', frame => !Object.keys(frame.avatars).length)).avatars, {});
  assert.equal((await host.request({ t: 'room.avatar', avatar: 'https://example.com/x' })).code, 'BAD_MSG');
  assert.equal(outsider.log.some(frame => frame.t === 'room.avatars'), false);
});
