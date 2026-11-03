import { ILLUST_MAX_BYTES } from '../../shared/illustration.js';
import { sendJson, sendError } from './common.js';

function readPicture(request) {
  return new Promise(resolve => {
    const chunks = [];
    let length = 0, settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    request.on('data', chunk => { length += chunk.length; if (length > ILLUST_MAX_BYTES) { chunks.length = 0; finish(null); } else if (!settled) chunks.push(chunk); });
    request.on('end', () => finish(Buffer.concat(chunks)));
    request.on('error', () => finish(null)); request.on('aborted', () => finish(null));
  });
}

export async function handleIllustRequest(request, response, pathname, { illusts, registry, lobby }) {
  if (pathname !== '/illust' && !pathname.startsWith('/illust/')) return false;
  const token = /^Bearer ([0-9a-f]{32})$/i.exec(String(request.headers.authorization || ''))?.[1];
  const session = token ? registry.byToken(token) : null;
  if (!session) { request.resume(); sendJson(request, response, 401, { error: 'UNAUTHORIZED' }); return true; }
  if (pathname === '/illust' && request.method === 'GET') {
    sendJson(request, response, 200, { etag: illusts.get(session.playerId)?.etag || null }); return true;
  }
  if (pathname.startsWith('/illust/')) {
    const playerId = pathname.slice('/illust/'.length), room = lobby.roomOf(session);
    const member = room && (room.seatOf(playerId) || room.spectatorOf(playerId));
    if (!/^p_[0-9a-f]{10}$/.test(playerId) || playerId !== session.playerId && !member) { sendJson(request, response, 404, { error: 'NOT_FOUND' }); return true; }
    if (!['GET', 'HEAD'].includes(request.method)) { sendError(request, response, 405, 'Method not allowed'); return true; }
    const picture = illusts.get(playerId);
    if (!picture) { sendJson(request, response, 404, { error: 'NOT_FOUND' }); return true; }
    const headers = { 'Content-Type': picture.type, 'Cache-Control': 'private, no-cache', ETag: picture.etag, Vary: 'Authorization' };
    if (request.headers['if-none-match'] === picture.etag) { response.writeHead(304, headers); response.end(); return true; }
    response.writeHead(200, { ...headers, 'Content-Length': picture.bytes.length });
    response.end(request.method === 'HEAD' ? undefined : picture.bytes); return true;
  }
  if (!['POST', 'DELETE'].includes(request.method)) { sendError(request, response, 405, 'Method not allowed'); return true; }
  let result;
  if (request.method === 'POST') {
    const picture = await readPicture(request);
    if (!picture) { response.setHeader('Connection', 'close'); sendJson(request, response, 413, { error: 'TOO_LARGE' }); return true; }
    result = await illusts.put(session.playerId, picture);
  } else { request.resume(); result = await illusts.remove(session.playerId); }
  if (result.error) {
    const code = { TOO_LARGE: 413, BAD_TYPE: 415, BAD_DIMENSIONS: 422, RATE: 429, STORAGE: 500, STORAGE_FULL: 507 }[result.error] || 400;
    sendJson(request, response, code, { error: result.error }); return true;
  }
  session.illust = result.entry?.etag || null;
  const room = lobby.roomOf(session), seat = room?.seatOf(session.playerId);
  if (seat) { seat.illust = session.illust; lobby.broadcastState(room); }
  if (request.method === 'DELETE') { response.writeHead(204, { 'Cache-Control': 'no-store' }); response.end(); }
  else sendJson(request, response, 200, { ok: true, etag: result.entry.etag, width: result.entry.width, height: result.entry.height, size: result.entry.bytes.length });
  return true;
}
