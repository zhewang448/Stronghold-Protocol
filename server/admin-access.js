// i18n-ignore-file: Chinese host console authentication, never player-facing.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { normalizeIp } from './net.js';
import { forwardedAddresses, FORWARD_HEADERS, isLoopback } from './studio/gate.js';

const derive = promisify(scrypt);
const SESSION_MS = 12 * 60 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const equal = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};
const validPassword = (value) => typeof value === 'string' && [...value].length >= 8 && [...value].length <= 128;
const validHash = (value) => value?.algorithm === 'scrypt' && /^[a-f0-9]{32}$/.test(value.salt) && /^[a-f0-9]{128}$/.test(value.hash);

/** Host names cannot confer locality; all three checks must agree. Proxy headers only remove trust. */
export function localAdminRequest(req) {
  const peer = normalizeIp(req.socket?.remoteAddress);
  let host;
  try {
    const url = new URL(`http://${req.headers.host}`);
    host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (req.socket?.localPort && Number(url.port || 80) !== req.socket.localPort) return false;
  } catch { return false; }
  if (!(host === 'localhost' || isLoopback(host)) || !isLoopback(peer)) return false;
  if (req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto'] || req.headers.via) return false;
  // Even an opaque/empty proxy identity must never become a password-free local request.
  if (FORWARD_HEADERS.some((name) => Object.hasOwn(req.headers, name))) {
    const forwarded = forwardedAddresses(req.headers);
    if (!forwarded.length || forwarded.some((ip) => !ip || !isLoopback(ip))) return false;
  }
  return true;
}

export function adminSameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  if (req.headers.origin === undefined) return true; // native launcher/API callers still carry a secret header
  try {
    const origin = new URL(req.headers.origin);
    return ['http:', 'https:'].includes(origin.protocol) && origin.host.toLowerCase() === req.headers.host?.toLowerCase();
  } catch { return false; }
}

export function createAdminAccess({ file, processToken, now = Date.now, log = console }) {
  let config = { loginEnabled: false, allowRemote: false, password: null }, revision = 1, warning = '';
  const sessions = new Map(), failures = new Map(), confirmations = new Map();
  let hashing = 0;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof saved.loginEnabled !== 'boolean' || typeof saved.allowRemote !== 'boolean'
      || (saved.password !== null && !validHash(saved.password))) throw new Error('invalid access configuration');
    config = { loginEnabled: saved.loginEnabled, allowRemote: saved.allowRemote, password: saved.password };
    if (config.allowRemote && (!config.loginEnabled || !config.password)) {
      config.allowRemote = false;
      warning = '远程访问配置缺少登录或有效密码，已退回仅本机访问。请重新保存设置。';
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      config.loginEnabled = true;
      warning = '访问配置损坏，已退回仅本机访问。请在本机重置密码并重新保存设置。';
      log.error('[admin-access] invalid configuration; local access only');
    }
  }
  function write(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  }
  function prune() {
    for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id);
    for (const [id, proof] of confirmations) if (proof.expiresAt <= now() || !sessions.has(proof.sessionId)) confirmations.delete(id);
    for (const [id, failure] of failures) if (failure.until <= now()) failures.delete(id);
  }
  function allowed(req) {
    const host = req.headers.host;
    if (typeof host !== 'string' || /[\s/@\\?#]/.test(host)) return false;
    try {
      const parsed = new URL(`http://${host}`);
      if (!parsed.hostname || (!isIP(parsed.hostname.replace(/^\[|\]$/g, '')) && !/^[a-z0-9.-]+$/i.test(parsed.hostname))) return false;
    } catch { return false; }
    return localAdminRequest(req) || config.allowRemote;
  }
  function session(req) {
    prune();
    const id = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('sp_admin='))?.slice(9);
    const value = sessions.get(id);
    if (!allowed(req) || (value?.localOnly && !localAdminRequest(req))) return null;
    return value || null;
  }
  function issue(req) {
    prune();
    if (sessions.size >= 512) sessions.delete(sessions.keys().next().value);
    const value = { id: randomBytes(24).toString('hex'), token: randomBytes(24).toString('hex'),
      localOnly: localAdminRequest(req), expiresAt: now() + SESSION_MS };
    sessions.set(value.id, value);
    return value;
  }
  function cookie(req, value) {
    // Honor forwarded HTTPS only for the cookie flag; it cannot grant local privileges.
    const secure = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https';
    return `sp_admin=${value?.id || ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value ? Math.floor((value.expiresAt - now()) / 1000) : 0}${secure ? '; Secure' : ''}`;
  }
  function authenticated(req) {
    if (!allowed(req)) return null;
    if (localAdminRequest(req) && equal(req.headers['x-admin-token'], processToken)) return { id: 'process', token: processToken, localOnly: true };
    const current = session(req);
    return current && equal(req.headers['x-admin-token'], current.token) ? current : null;
  }
  const view = (req) => ({ loginEnabled: config.loginEnabled, allowRemote: config.allowRemote, passwordSet: !!config.password,
    local: localAdminRequest(req), authenticated: !!session(req), warning });
  async function verify(password) {
    if (!validPassword(password) || hashing >= 4) return false;
    const saved = config.password;
    if (!saved) return false;
    hashing++;
    try {
      const hash = await derive(password, Buffer.from(saved.salt, 'hex'), 64);
      return saved === config.password && timingSafeEqual(hash, Buffer.from(saved.hash, 'hex'));
    } finally { hashing--; }
  }
  // An arbitrary forwarding header must not reset a direct client's attempt budget.
  const source = (req) => normalizeIp(req.socket?.remoteAddress);
  async function login(req, password) {
    prune();
    const key = source(req), failure = failures.get(key);
    if (failure?.count >= 5) return { status: 429, error: '密码尝试过多，请在 15 分钟后重试。' };
    if (!await verify(password)) {
      if (failures.size >= 2048 && !failures.has(key)) failures.delete(failures.keys().next().value);
      const count = (failures.get(key)?.count || 0) + 1;
      failures.set(key, { count, until: now() + BLOCK_MS });
      return { status: count >= 5 ? 429 : 401, error: count >= 5 ? '密码尝试过多，请在 15 分钟后重试。' : '密码错误，请重试。' };
    }
    if (!allowed(req)) return { status: 403, error: '非本机访问已关闭。' };
    failures.delete(key);
    return { session: issue(req) };
  }
  async function password(req, body, current) {
    if (!localAdminRequest(req) && (!current || !await verify(body?.oldPassword))) return { status: 401, error: '旧密码错误，请重新输入。' };
    if (!validPassword(body?.newPassword)) return { status: 400, error: '新密码须为 8–128 个字符。' };
    if (body.newPassword !== body.confirmPassword) return { status: 400, error: '两次输入的新密码不一致。' };
    if (hashing >= 4) return { status: 429, error: '正在处理密码请求，请稍后重试。' };
    hashing++;
    try {
      const salt = randomBytes(16).toString('hex');
      const hash = (await derive(body.newPassword, Buffer.from(salt, 'hex'), 64)).toString('hex');
      const next = { ...config, password: { algorithm: 'scrypt', salt, hash } };
      write(next); config = next; revision++; confirmations.clear(); warning = '';
      for (const [id] of sessions) if (id !== current?.id) sessions.delete(id);
      const kept = current && sessions.get(current.id) || issue(req);
      return { session: kept };
    } finally { hashing--; }
  }
  function confirmation(current) {
    if (!current || current.id === 'process') return { status: 403, error: '请先在浏览器中进入控制台。' };
    prune();
    for (const [id, proof] of confirmations) if (proof.sessionId === current.id) confirmations.delete(id);
    const id = randomBytes(24).toString('hex'), issuedAt = now();
    confirmations.set(id, { sessionId: current.id, revision, issuedAt, expiresAt: issuedAt + 120000 });
    return { confirmation: id, waitMs: 5000, expiresInMs: 120000 };
  }
  function cancelConfirmation(current) {
    for (const [id, proof] of confirmations) if (proof.sessionId === current?.id) confirmations.delete(id);
  }
  function prepare(body, current) {
    if (typeof body?.loginEnabled !== 'boolean' || typeof body?.allowRemote !== 'boolean') return { status: 400, error: '访问设置必须为开或关。' };
    const next = { ...config, loginEnabled: body.loginEnabled, allowRemote: body.allowRemote };
    if (next.allowRemote && (!next.loginEnabled || !next.password)) return { status: 400, error: '允许非本机访问前，请开启登录界面并设置密码。' };
    if (next.allowRemote && !config.allowRemote) {
      const proof = confirmations.get(body.confirmation);
      if (!proof || proof.sessionId !== current?.id || proof.revision !== revision || now() >= proof.expiresAt) return { status: 400, error: '风险确认已失效，请重新打开确认窗口。' };
      if (now() - proof.issuedAt < 5000) return { status: 409, error: '请阅读风险提示满 5 秒后再确认。' };
      confirmations.delete(body.confirmation);
    }
    return { config: next };
  }
  return { file, allowed, view, session, issue, cookie, authenticated, login, password, confirmation, cancelConfirmation, prepare,
    get remote() { return config.allowRemote; }, get loginEnabled() { return config.loginEnabled; },
    commit(next) {
      write(next); config = next; revision++; confirmations.clear(); warning = '';
      if (!next.allowRemote) for (const [id, value] of sessions) if (!value.localOnly) sessions.delete(id);
    },
    logout(current) { if (current) { sessions.delete(current.id); cancelConfirmation(current); } },
    close() { sessions.clear(); confirmations.clear(); failures.clear(); },
  };
}
