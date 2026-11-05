import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createAdminAccess, localAdminRequest, adminSameOrigin } from '../server/admin-access.js';
import { startAdmin } from '../server/admin.js';

const silent = { info() {}, warn() {}, error() {} };
const req = (headers = {}, peer = '127.0.0.1') => ({ socket: { remoteAddress: peer, localPort: 3100 }, headers: { host: 'localhost:3100', ...headers } });
const passwordBody = (newPassword = 'local-test-password') => ({ newPassword, confirmPassword: newPassword });
function fixture(t, saved) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-admin-access-'));
  const file = path.join(dir, 'admin-access.json');
  if (saved !== undefined) fs.writeFileSync(file, saved);
  let clock = 1000;
  const access = createAdminAccess({ file, processToken: 'process-secret', now: () => clock, log: silent });
  t.after(() => { access.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { access, file, time: (value) => { clock = value; } };
}
function browser(access, request = req()) {
  const value = access.issue(request);
  return { value, request: { ...request, headers: { ...request.headers, cookie: `sp_admin=${value.id}`, 'x-admin-token': value.token } } };
}

test('local bypass requires socket, loopback Host and trustworthy forwarding identities together', () => {
  assert.equal(localAdminRequest(req()), true);
  assert.equal(localAdminRequest(req({ host: '[::1]:3100' }, '::1')), true);
  assert.equal(localAdminRequest(req({ host: 'localhost:3100' }, '::ffff:127.0.0.1')), true);
  for (const headers of [{ host: 'evil.example:3100' }, { host: '127.0.0.1:1234' }, { host: '192.168.1.1:3100' },
    { 'x-forwarded-for': '203.0.113.1' }, { 'x-forwarded-for': '' }, { forwarded: 'for=unknown' },
    { 'cf-connecting-ip': '192.168.1.1' }, { 'x-forwarded-proto': 'https' }, { 'x-forwarded-host': 'host.example' }]) {
    assert.equal(localAdminRequest(req(headers)), false, JSON.stringify(headers));
  }
  assert.equal(localAdminRequest(req({}, '192.168.1.8')), false);
  assert.equal(adminSameOrigin(req({ origin: 'http://evil.example' })), false);
  assert.equal(adminSameOrigin(req({ origin: 'null' })), false);
  assert.equal(adminSameOrigin(req({ 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(adminSameOrigin(req({ origin: 'http://localhost:3100' })), true);
});

test('defaults, async salted passwords, local reset, persistence and corrupt-config fallback', async (t) => {
  const { access, file } = fixture(t);
  assert.deepEqual(access.view(req()), { loginEnabled: false, allowRemote: false, passwordSet: false, local: true, authenticated: false, warning: '' });
  assert.equal(access.prepare({ loginEnabled: true, allowRemote: true }, null).status, 400);
  assert.equal((await access.password(req(), passwordBody('short'), null)).status, 400);
  assert.equal((await access.password(req(), { ...passwordBody(), confirmPassword: 'different' }, null)).status, 400);
  assert.ok((await access.password(req(), passwordBody(), null)).session);
  const saved = JSON.parse(fs.readFileSync(file));
  assert.equal(saved.password.algorithm, 'scrypt');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('local-test-password'));
  const restored = createAdminAccess({ file, processToken: 'different', log: silent });
  assert.ok((await restored.login(req(), 'local-test-password')).session);
  restored.close();
  for (const contents of ['{broken', '{"loginEnabled":true,"allowRemote":true,"password":null}']) {
    fs.writeFileSync(file, contents);
    const broken = createAdminAccess({ file, processToken: 'other', log: silent });
    assert.equal(broken.remote, false); assert.ok(broken.view(req()).warning);
    assert.equal(broken.allowed(req({}, '203.0.113.1')), false); broken.close();
  }
});

test('risk proof enforces 4999/5000ms, expiry, session binding, cancellation, revision and single use', async (t) => {
  const { access, time } = fixture(t);
  const a = browser(access), b = browser(access);
  await access.password(a.request, passwordBody(), a.value);
  const body = { loginEnabled: true, allowRemote: true };
  const proof = access.confirmation(a.value).confirmation;
  assert.equal(access.prepare({ ...body, confirmation: proof }, b.value).status, 400);
  time(5999); assert.equal(access.prepare({ ...body, confirmation: proof }, a.value).status, 409);
  time(6000); const ready = access.prepare({ ...body, confirmation: proof }, a.value); assert.ok(ready.config);
  assert.equal(access.prepare({ ...body, confirmation: proof }, a.value).status, 400);
  access.commit(ready.config);
  access.commit({ ...ready.config, allowRemote: false });
  const canceled = access.confirmation(a.value).confirmation; access.cancelConfirmation(a.value);
  time(11000); assert.equal(access.prepare({ ...body, confirmation: canceled }, a.value).status, 400);
  const expired = access.confirmation(a.value).confirmation;
  time(131000); assert.equal(access.prepare({ ...body, confirmation: expired }, a.value).status, 400);
  const stale = access.confirmation(a.value).confirmation;
  access.commit({ ...ready.config, allowRemote: false }); time(136000);
  assert.equal(access.prepare({ ...body, confirmation: stale }, a.value).status, 400);
  assert.equal(access.confirmation({ id: 'process' }).status, 403);
});

test('browser cookie and token pair, locality binding, expiry, logout and Secure cookie', (t) => {
  const { access, time } = fixture(t);
  const a = browser(access);
  assert.ok(access.authenticated(a.request));
  assert.equal(access.authenticated(req({ 'x-admin-token': a.value.token })), null);
  assert.equal(access.authenticated({ ...a.request, headers: { ...a.request.headers, 'x-admin-token': 'bad' } }), null);
  assert.ok(access.authenticated(req({ 'x-admin-token': 'process-secret' })));
  assert.equal(access.authenticated(req({ 'x-admin-token': 'process-secret', 'x-forwarded-for': '203.0.113.1' })), null);
  assert.match(access.cookie(req(), a.value), /HttpOnly; SameSite=Strict/);
  assert.match(access.cookie(req({ 'x-forwarded-proto': 'https' }), a.value), /; Secure$/);
  time(1000 + 12 * 60 * 60 * 1000); assert.equal(access.session(a.request), null);
  const b = browser(access); access.logout(b.value); assert.equal(access.authenticated(b.request), null);
});

test('five failures share socket budget despite forged proxy headers, then recover after 15 minutes', async (t) => {
  const { access, time } = fixture(t);
  await access.password(req(), passwordBody(), null);
  const results = await Promise.all(Array.from({ length: 5 }, (_, n) => access.login(req({ 'x-forwarded-for': `203.0.113.${n}` }), 'wrong-password')));
  assert.equal(results.filter((r) => r.status === 429).length, 1);
  assert.equal((await access.login(req(), 'local-test-password')).status, 429);
  time(1000 + 15 * 60 * 1000); assert.ok((await access.login(req(), 'local-test-password')).session);
});

async function httpFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-access-http-'));
  let clock = 1000;
  const options = { port: 0, lobby: { rooms: new Map(), onMatchEnd() {}, safeData: () => ({}) },
    settingsFile: path.join(dir, 'settings.json'), resultsDir: dir, log: silent,
    accessOptions: { now: () => clock }, updateOptions: { fetchImpl: async () => new Response('[]') } };
  const admin = await startAdmin(options);
  t.after(async () => { await admin.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const call = async (route, body, headers = {}, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`${admin.url}${route}`, { method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { /* HTML */ }
    return { status: response.status, text, json, cookie: response.headers.get('set-cookie')?.split(';')[0], location: response.headers.get('location') };
  };
  const pageAuth = (page) => ({ Cookie: page.cookie, 'X-Admin-Token': page.text.match(/const TOKEN = '([^']+)'/)[1] });
  return { admin, call, pageAuth, dir, options, time: (value) => { clock = value; } };
}

test('HTTP login gate protects pages/assets/APIs; local skip/reset and launcher control remain available', async (t) => {
  const { admin, call, pageAuth, dir } = await httpFixture(t);
  const page = await call('/');
  assert.equal(page.status, 200); assert.ok(!page.text.includes(admin.token));
  const local = pageAuth(page);
  assert.equal((await call('/api/access', { loginEnabled: true, allowRemote: false }, local)).status, 200);
  for (const route of ['/', '/resources', '/live', '/replay', '/js/ui/adminAccess.js', '/data/config.json']) {
    const denied = await call(route); assert.equal(denied.status, 302, route); assert.equal(denied.location, '/login');
  }
  assert.equal((await call('/api/rooms')).status, 403);
  const login = await call('/login'); assert.equal(login.status, 200); assert.ok(!login.text.includes(admin.token));
  assert.equal((await call('/api/auth/skip', {})).status, 403);
  assert.equal((await call('/api/auth/skip', {}, { 'X-Admin-Login': '1', Origin: 'http://evil.example' })).status, 403);
  const skip = await call('/api/auth/skip', {}, { 'X-Admin-Login': '1' }); assert.equal(skip.status, 200);
  assert.equal((await call('/', undefined, { Cookie: skip.cookie })).status, 200);
  assert.equal((await call('/api/auth/password', passwordBody(), { 'X-Admin-Login': '1' })).status, 200);
  assert.equal((await call('/api/service', undefined, { 'X-Admin-Token': admin.token })).status, 200);
  assert.equal((await call('/api/result?id=admin-access.json', undefined, { 'X-Admin-Token': admin.token })).status, 404);
  assert.equal((await call('/api/storage', { confirm: true, categories: ['results'] }, { 'X-Admin-Token': admin.token })).status, 200);
  assert.ok(fs.existsSync(path.join(dir, 'admin-access.json')));
  assert.equal((await call('/api/auth/login', { password: 'wrong-password' }, { 'X-Admin-Login': '1' })).status, 401);
  const good = await call('/api/auth/login', { password: 'local-test-password' }, { 'X-Admin-Login': '1' }); assert.equal(good.status, 200);
  const auth = pageAuth({ ...await call('/', undefined, { Cookie: good.cookie }), cookie: good.cookie });
  assert.equal((await call('/api/auth/logout', {}, auth)).status, 200);
  assert.equal((await call('/api/rooms', undefined, auth)).status, 403);
});

test('HTTP remote rebind, forced password, old-password check, revocation, persistence and immediate close', async (t) => {
  const { admin, call, pageAuth, time, options, dir } = await httpFixture(t);
  const local = pageAuth(await call('/'));
  await call('/api/auth/password', passwordBody(), local);
  const proof = (await call('/api/access/confirmation', {}, local)).json;
  const config = { loginEnabled: true, allowRemote: true, confirmation: proof.confirmation };
  time(5999); assert.equal((await call('/api/access', config, local)).status, 409);
  time(6000); assert.equal((await call('/api/access', config, local)).status, 200);
  const lan = Object.values(os.networkInterfaces()).flat().find((entry) => entry && entry.family === 'IPv4' && !entry.internal);
  if (lan) {
    const realRemote = await fetch(`http://${lan.address}:${admin.port}/`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    assert.equal(realRemote.status, 302, 'wildcard listener admits real non-loopback connections to login');
  }
  const proxy = { 'X-Forwarded-For': '203.0.113.9' };
  assert.equal((await call('/', undefined, proxy)).status, 302);
  assert.equal((await call('/api/rooms', undefined, { ...proxy, 'X-Admin-Token': admin.token })).status, 403);
  assert.equal((await call('/api/rooms', undefined, { ...proxy, ...local })).status, 403);
  assert.equal((await call('/api/auth/skip', {}, { ...proxy, 'X-Admin-Login': '1' })).status, 403);
  const signed = await call('/api/auth/login', { password: 'local-test-password' }, { ...proxy, 'X-Admin-Login': '1' });
  assert.equal(signed.status, 200);
  const remotePage = await call('/', undefined, { ...proxy, Cookie: signed.cookie });
  const remote = { ...proxy, ...pageAuth({ ...remotePage, cookie: signed.cookie }) };
  assert.equal((await call('/api/rooms', undefined, remote)).status, 200);
  assert.equal((await call('/api/auth/password', passwordBody('changed-password'), remote)).status, 401);
  assert.equal((await call('/api/auth/password', { ...passwordBody('changed-password'), oldPassword: 'local-test-password' }, remote)).status, 200);
  assert.equal((await call('/api/rooms', undefined, local)).status, 403);
  assert.equal((await call('/api/rooms', undefined, remote)).status, 200);
  assert.equal((await call('/api/access', undefined, remote)).json.passwordSet, true);
  // Opening a new controller over the saved file observes the persisted remote policy, but no old browser session.
  const reloaded = createAdminAccess({ file: path.join(dir, 'admin-access.json'), processToken: 'new', log: silent });
  assert.equal(reloaded.remote, true); assert.equal(reloaded.session(req({ cookie: signed.cookie })), null); reloaded.close();
  assert.equal((await call('/api/access', { loginEnabled: true, allowRemote: false }, { 'X-Admin-Token': admin.token })).status, 200);
  assert.equal((await call('/api/rooms', undefined, remote)).status, 403);
  assert.equal((await call('/api/access', undefined, { 'X-Admin-Token': admin.token })).json.allowRemote, false);
  assert.equal(options.lobby.rooms.size, 0);
});

test('disk commit failure after successful bind restores the original policy and listener', async (t) => {
  const { admin, call, pageAuth, time, dir } = await httpFixture(t);
  const local = pageAuth(await call('/'));
  await call('/api/auth/password', passwordBody(), local);
  const proof = (await call('/api/access/confirmation', {}, local)).json;
  const file = path.join(dir, 'admin-access.json');
  const bytes = fs.readFileSync(file);
  fs.unlinkSync(file); fs.mkdirSync(file); // rename over a directory must fail, even with elevated test permissions
  time(6000);
  assert.equal((await call('/api/access', { loginEnabled: true, allowRemote: true, confirmation: proof.confirmation }, local)).status, 500);
  assert.equal((await call('/api/access', undefined, { 'X-Admin-Token': admin.token })).json.allowRemote, false);
  assert.equal((await call('/', undefined, { 'X-Forwarded-For': '203.0.113.8' })).status, 403);
  fs.rmdirSync(file); fs.writeFileSync(file, bytes);
});

test('real wildcard bind failure restores prior listener and does not persist remote enable', async (t) => {
  const { admin, call, pageAuth, time, dir } = await httpFixture(t);
  const local = pageAuth(await call('/'));
  await call('/api/auth/password', passwordBody(), local);
  const blocker = net.createServer();
  // Windows permits a specific bind beside a wildcard; an identical wildcard still conflicts.
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen({ port: admin.port, host: process.platform === 'win32' ? '0.0.0.0' : '127.0.0.2', exclusive: true }, resolve); });
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const proof = (await call('/api/access/confirmation', {}, local)).json; time(6000);
  const result = await call('/api/access', { loginEnabled: true, allowRemote: true, confirmation: proof.confirmation }, local);
  assert.equal(result.status, 500);
  assert.equal((await call('/api/service', undefined, { 'X-Admin-Token': admin.token })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'admin-access.json'))).allowRemote, false);
});
