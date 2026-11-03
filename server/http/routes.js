// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * /studio and /studio/… → the plugin studio (server/studio/index.js: for this machine and the local network only — any
//     other client gets the 404 page; its API also takes POST / PUT / DELETE), when the server has one;
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD`;
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, the vanilla content
//     hash `content.vanilla`, the modded content sets in use `content.sets` and — only when there are some — how many
//     unofficial plugins the server has, `content.plugins` (the title screen's count before any hello) — DESIGN §32 —,
//     sockets, sessions,
//     rooms, matches; `versions: { enabled, default, hosts }` only when the server enables another official version than
//     第二期下半 — DESIGN §35.23), never cached; `?traffic=1` adds the traffic counters (traffic.js: bytes by category since the
//     start, WebSocket wire and payload bytes) for a loopback or private-network client only — the maintainer's
//     decision of 2026-10-12: the figures are the host's, so any other client, also one a tunnel or proxy on this
//     machine forwards, gets the plain report (net.js clientAddress, honouring TRUST_PROXY like the WebSocket limits);
//   * everything else → the static files (static.js).
// Every response's body bytes count in the traffic counters (traffic.js meter). A route that throws is logged and
// answers 500.

import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { readReleaseNotes, readUpstreamReleaseNotes, readReleaseHistory } from '../release-notes.js';
import { ROOT } from './config.js';
import { buildTag } from './buildTag.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from './common.js';
import { clientAddress, isLocalIp } from '../net.js';
import { readPersonalDataConfig } from './personalDataConfig.js';
import { getShowPwaInstall } from '../match/hostSettings.js';
import { AVATAR_BODY_LIMIT } from './avatarStore.js';

const MAX_URL_LENGTH = 4096;

/** A session's playerId as server/net.js mints it (`p_` + 10 hex). Anything else is not an avatar route at all. */
const AVATAR_ID_RE = /^p_[0-9a-f]{10}$/;

/** `{ plugins: n }` when the server has n > 0 unofficial plugins (the lobby's visual sets count them), else nothing. */
function pluginCount(lobby) {
  let n;
  try { n = Number(lobby?.plugins?.unofficial?.()) || 0; } catch { n = 0; }
  let notices = false;
  try { notices = lobby?.plugins?.hasNotices?.() === true; } catch { /* optional catalogue hint */ }
  return { ...(n > 0 ? { plugins: n } : {}), ...(notices ? { notices: true } : {}) };
}

/** The content sets with gameplay plugins rooms hold now (DESIGN §32.6; 0 without any). */
function contentSets(lobby) {
  try { return Number(lobby?.plugins?.contentInUse?.()) || 0; } catch { return 0; }
}

/**
 * The GET /healthz body (`withTraffic`: plus the traffic counters and the asset index's state, `?traffic=1`).
 * @param {{ startedAt: number, network: import('../net.js').Network, registry: import('../net.js').SessionRegistry,
 *           lobby: import('../lobby.js').Lobby, content?: { cs: string } | null,
 *           traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter>,
 *           assetIndex?: ReturnType<typeof import('./assetIndex.js').createAssetIndex> | null,
 *           views?: ReturnType<typeof import('./assetViews.js').createManifestViews> | null, trusted?: any,
 *           versions?: ReturnType<typeof import('../versions.js').createVersionSets> | null,
 *           versionHosts?: { stats: () => object } | null }} health
 *   content: the server's vanilla content (server/plugins/identity.js); versions / versionHosts: the official versions
 *   and their match hosts (DESIGN §35.23)
 * @param {boolean} [withTraffic]
 */
export function healthReport({ startedAt, network, registry, lobby, content = null, traffic, assetIndex, views, trusted, versions = null, versionHosts = null, avatars = null }, withTraffic = false) {
  const report = {
    ok: true, version: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    // the runtime the server is serving right now (public/js/ui/buildGuard.js): a page whose own build is
    // older than this reloads itself, so a deploy reaches clients that never reload
    build: buildTag(),
    siteSettings: { showPwaInstall: getShowPwaInstall() },
    // what its rooms play (DESIGN §32): the vanilla content hash, and how many content sets with gameplay plugins rooms
    // hold now (P1c, §32.6 — a room's cosmetic plugins leave its cs the vanilla one, §32.3); how many unofficial plugins
    // it has, when it has some (a page's title screen says so; P1a)
    ...(content ? { content: { vanilla: content.cs, sets: contentSets(lobby), ...pluginCount(lobby) } } : {}),
    sockets: network.connectionCount, sessions: registry.size, ...lobby.stats(),
  };
  if (trusted && Object.keys(trusted).length) report.plugins = trusted;
  // 自定义头像 (public/js/ui/customAvatar.js, ported from hex031): how many pictures the server holds — a server on which
  // nobody uploaded one reports nothing, and the page then requests no avatar at all (it looks exactly as before)
  if (avatars && avatars.size > 0) report.avatars = avatars.size;
  // the official versions (DESIGN §35.23): only when another one than 第二期下半 is enabled
  if (versions && versions.nonDefault.length) {
    report.versions = { enabled: [...versions.ids], default: versions.defaultId,
      hosts: versionHosts ? versionHosts.stats() : { workers: 0, matches: 0, transport: 'process' } };
  }
  if (withTraffic && traffic) report.traffic = traffic.snapshot();
  // content-hashed asset URLs (assetIndex.js / assetViews.js): off, building, or ready with how many files and URLs
  if (withTraffic) report.assetHashes = assetIndex ? { ...assetIndex.stats(), views: views ? views.stats() : null } : null;
  return report;
}

/** Does the query ask for the traffic counters (`traffic`, `traffic=1`, `traffic=true`)? */
const wantsTraffic = (query) => /(?:^|&)traffic(?:=(?:1|true|yes))?(?:&|$)/i.test(query || '');

// ---------------------------------------------------------------------------------------------------
// 自定义头像 (/avatar, ported from hex031): the pictures themselves, outside the room / match / protocol state
// ---------------------------------------------------------------------------------------------------

/**
 * The reconnect token a write request carries, as `Authorization: Bearer <token>` (the token the WebSocket's `hello`
 * already gave this session — no second credential exists).
 * @param {import('node:http').IncomingMessage} req
 * @returns {string|null}
 */
function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const m = /^Bearer\s+([0-9A-Za-z_-]{1,128})$/.exec(header.trim());
  return m ? m[1] : null;
}

/** The authenticated session of a write request, or null (an unknown/expired token, or none). */
function sessionOf(req, registry) {
  const token = bearerToken(req);
  if (!token || !registry || typeof registry.byToken !== 'function') return null;
  const session = registry.byToken(token);
  return session && typeof session.playerId === 'string' ? session : null;
}

/**
 * Read at most `limit` bytes of a request body. Resolves null as soon as the limit is exceeded (the rest is not
 * buffered; the caller answers 413 and closes the connection).
 * @param {import('node:http').IncomingMessage} req @param {number} limit
 * @returns {Promise<Buffer|null>}
 */
function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      resolve(value);
    };
    const onData = (chunk) => {
      total += chunk.length;
      if (total > limit) { finish(null); return; }
      chunks.push(chunk);
    };
    const onEnd = () => finish(Buffer.concat(chunks));
    const onError = () => finish(null);
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
  });
}

/** POST /avatar: store this session's picture. @returns {Promise<void>} */
async function avatarUpload(req, res, deps) {
  const { avatars, registry } = deps;
  // the body is bounded before anything else, so an unauthenticated caller cannot stream without a limit either
  const body = await readBody(req, AVATAR_BODY_LIMIT);
  if (body === null) {
    res.setHeader('Connection', 'close');
    sendJson(req, res, 413, { error: 'TOO_LARGE' });
    res.once('finish', () => { try { req.destroy(); } catch { /* already gone */ } });
    return;
  }
  const session = sessionOf(req, registry);
  if (!session) {
    sendJson(req, res, 401, { error: 'UNAUTHORIZED' });
    return;
  }
  const result = await avatars.put(session.playerId, body);
  if (!result.ok) {
    if (result.code === 'RATE') res.setHeader('Retry-After', '2');
    const status = result.code === 'TOO_LARGE' ? 413 : result.code === 'BAD_TYPE' ? 415
      : result.code === 'BAD_DIMENSIONS' ? 422 : result.code === 'RATE' ? 429 : result.code === 'STORAGE' ? 500 : 400;
    sendJson(req, res, status, { error: result.code });
    return;
  }
  const { entry } = result;
  // 实时同步 (2026-11-03): the room's other clients must not wait for a reload to see the new 头像
  notifyPersonal(deps, session.playerId, 'avatar');
  sendJson(req, res, 200, { ok: true, etag: entry.etag, size: entry.bytes.length, width: entry.width, height: entry.height });
}

/** DELETE /avatar: forget this session's picture (the default avatar comes back). */
async function avatarRemove(req, res, deps) {
  const { avatars, registry } = deps;
  const body = await readBody(req, AVATAR_BODY_LIMIT);
  if (body === null) {
    res.setHeader('Connection', 'close');
    sendJson(req, res, 413, { error: 'TOO_LARGE' });
    res.once('finish', () => { try { req.destroy(); } catch { /* already gone */ } });
    return;
  }
  const session = sessionOf(req, registry);
  if (!session) {
    sendJson(req, res, 401, { error: 'UNAUTHORIZED' });
    return;
  }
  await avatars.remove(session.playerId);
  notifyPersonal(deps, session.playerId, 'avatar', true);
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
}

/** GET / HEAD /avatar/<playerId>: one picture (404 when there is none — the page falls back to its default). */
function avatarGet(req, res, playerId, avatars) {
  const entry = avatars.get(playerId);
  if (!entry) {
    sendJson(req, res, 404, { error: 'NOT_FOUND' });
    return;
  }
  const headers = {
    'Content-Type': entry.type,
    'Content-Length': entry.bytes.length,
    'Cache-Control': 'private, max-age=15',
    ETag: entry.etag,
  };
  const inm = req.headers['if-none-match'];
  if (typeof inm === 'string' && inm.split(',').some((tag) => tag.trim().replace(/^W\//, '') === entry.etag)) {
    res.writeHead(304, { ETag: entry.etag, 'Cache-Control': headers['Cache-Control'] });
    res.end();
    return;
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : entry.bytes);
}

/**
 * Serve an `/avatar` URL. Returns false when the path is not one (the request then falls through as before).
 * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
 * @param {string} rawPath @param {{ avatars: any, registry: any }} deps
 * @returns {Promise<boolean>}
 */
async function handleAvatarRequest(req, res, rawPath, deps) {
  if (rawPath === '/avatar') {
    if (req.method === 'POST') { await avatarUpload(req, res, deps); return true; }
    if (req.method === 'DELETE') { avatarRemove(req, res, deps); return true; }
    res.setHeader('Allow', 'POST, DELETE');
    sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
    return true;
  }
  if (!rawPath.startsWith('/avatar/')) return false;
  const playerId = rawPath.slice('/avatar/'.length);
  if ((req.method === 'GET' || req.method === 'HEAD') && AVATAR_ID_RE.test(playerId)) {
    avatarGet(req, res, playerId, deps.avatars);
    return true;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    sendJson(req, res, 404, { error: 'NOT_FOUND' }); // a malformed id: indistinguishable from a missing picture
    return true;
  }
  res.setHeader('Allow', 'GET, HEAD');
  sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
  return true;
}

/**
 * The request listener for `http.createServer`.
 * @param {{ serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string, query: string) => Promise<void>,
 *           health: Parameters<typeof healthReport>[0], log: object, trustProxy?: 'auto' | boolean,
 *           csp?: string | null,
 *           studio?: { handles: (rawPath: string) => boolean, handle: (req: any, res: any, rawPath: string, query: string) => Promise<void> } | null }} deps
 *   trustProxy: whose forwarding headers name the client (net.js clientAddress; the server's TRUST_PROXY); studio: the
 *   plugin studio (server/studio/index.js), or none
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, health, log, trustProxy = 'auto', studio = null, csp = null, trustedRuntime = null }) {
  async function handleRequest(req, res) {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    if (trustedRuntime && parts.rawPath.startsWith('/x/') && await trustedRuntime.route(req,res,parts.rawPath)) return;
    // 自定义头像 (server/http/avatarStore.js): POST / DELETE / GET, before the GET/HEAD-only rule below
    if (health.avatars && health.registry && (parts.rawPath === '/avatar' || parts.rawPath.startsWith('/avatar/'))) {
      await handleAvatarRequest(req, res, parts.rawPath, { avatars: health.avatars, registry: health.registry });
      return;
    }
    if (studio && studio.handles(parts.rawPath)) { await studio.handle(req, res, parts.rawPath, parts.query); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    if (parts.rawPath === '/release-history.json') { sendJson(req, res, 200, readReleaseHistory(ROOT)); return; }
    if (parts.rawPath === '/release-notes.json') { sendJson(req, res, 200, readReleaseNotes(ROOT)); return; }
    if (parts.rawPath === '/upstream-release-notes.json') { sendJson(req, res, 200, readUpstreamReleaseNotes(ROOT)); return; }
    if (parts.rawPath === '/personal-data-config.json') { sendJson(req, res, 200, readPersonalDataConfig()); return; }
    if (parts.rawPath === '/healthz') {
      const withTraffic = wantsTraffic(parts.query) && isLocalIp(clientAddress(req, trustProxy).ip);
      sendJson(req, res, 200, healthReport(health, withTraffic));
      return;
    }
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  return (req, res) => {
    setSecurityHeaders(res);
    if (csp) res.setHeader('Content-Security-Policy', csp);
    if (health.traffic) health.traffic.meter(res, splitUrl(req.url || '/')?.rawPath || '/');
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  };
}
