// One-click old -> new handoff. URLs carry routing metadata only, never save bytes.
import { capturePersonalData, encodePersonalData, decodePersonalData, MAX_CODE_CHARS } from './personalData.js';
export const TRANSFER_HASH = '#sp-recover-transfer=';
export function directTransferRequest(hash) {
  try {
    if (!hash.startsWith(TRANSFER_HASH)) return null;
    const raw = JSON.parse(decodeURIComponent(hash.slice(TRANSFER_HASH.length)));
    const url = new URL(raw.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^[a-f0-9]{32}$/.test(raw.nonce)) return null;
    return { origin: url.origin, nonce: raw.nonce };
  } catch { return null; }
}
export function validDirectMessage(event, peer, origin, nonce, type) {
  return !!peer && event.source === peer && event.origin === origin && event.data?.nonce === nonce && event.data.type === type;
}
export function beginDirectMigration(targetOrigin, onState, { win = globalThis.window, capture = capturePersonalData, encode = encodePersonalData, timeoutMs = 180000 } = {}) {
  const target = new URL(targetOrigin);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.origin === win.location.origin || target.pathname !== '/' || target.search || target.hash) throw new Error('origin');
  const nonce = Array.from(win.crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  let peer, timer, closedTimer, finished = false, ready = false, sent = false, code;
  const cleanup = () => {
    if (finished) return; finished = true; clearTimeout(timer); clearInterval(closedTimer);
    win.removeEventListener('message', receive); code = null;
  };
  const stop = state => { if (finished) return; cleanup(); onState(state); };
  const send = () => {
    if (!finished && ready && code && !sent) {
      sent = true;
      try { peer.postMessage({ type: 'sp.direct-data', nonce, code }, target.origin); }
      catch { stop('error'); }
    }
  };
  const receive = event => {
    if (validDirectMessage(event, peer, target.origin, nonce, 'sp.direct-ready')) { ready = true; send(); }
    if (sent && validDirectMessage(event, peer, target.origin, nonce, 'sp.direct-received')) stop('sent');
  };
  win.addEventListener('message', receive);
  // Opening before the first await keeps the user's click activation for popup blockers.
  try { peer = win.open(target.origin + '/' + TRANSFER_HASH + encodeURIComponent(JSON.stringify({ origin: win.location.origin, nonce })), '_blank'); }
  catch { stop('blocked'); return cleanup; }
  if (!peer) { stop('blocked'); return cleanup; }
  onState('sending');
  timer = setTimeout(() => stop('timeout'), timeoutMs);
  closedTimer = setInterval(() => { if (peer.closed) stop('closed'); }, 750);
  Promise.resolve().then(capture).then(encode).then(value => { if (!finished) { code = value; send(); } }).catch(() => stop('error'));
  return cleanup;
}
export function receiveDirectMigration(request, onData, onFailure, { win = globalThis.window, decode = decodePersonalData, timeoutMs = 180000 } = {}) {
  const peer = win.opener;
  let timer, retry, finished = false, reading = false;
  const cleanup = () => {
    if (finished) return; finished = true; clearTimeout(timer); clearInterval(retry); win.removeEventListener('message', receive);
  };
  const fail = () => { if (finished) return; cleanup(); onFailure(); };
  const receive = async event => {
    if (reading || !validDirectMessage(event, peer, request.origin, request.nonce, 'sp.direct-data')) return;
    if (typeof event.data.code !== 'string' || event.data.code.length > MAX_CODE_CHARS) { fail(); return; }
    reading = true;
    try {
      const data = await decode(event.data.code);
      if (finished) return;
      cleanup();
      // Validate fully before acknowledging. No local save is written until confirmation.
      try { peer.postMessage({ type: 'sp.direct-received', nonce: request.nonce }, request.origin); } catch { /* decoded preview remains usable */ }
      onData({ origin: request.origin, data });
    } catch { if (!finished) fail(); }
  };
  if (!peer || peer.closed) { fail(); return cleanup; }
  win.addEventListener('message', receive);
  const ready = () => {
    if (peer.closed) { fail(); return; }
    try { peer.postMessage({ type: 'sp.direct-ready', nonce: request.nonce }, request.origin); } catch { fail(); }
  };
  timer = setTimeout(fail, timeoutMs); retry = setInterval(ready, 500); ready();
  return cleanup;
}
