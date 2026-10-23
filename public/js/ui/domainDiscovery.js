// Reuse one top-level helper window: iframe storage can be partitioned from the real old save.
import { decodePersonalData, MAX_CODE_CHARS } from './personalData.js';
import { validDirectMessage } from './domainTransfer.js';
export function openDiscoveryWindow(win = globalThis.window) {
  try { return win.open('about:blank', '_blank', 'popup,width=720,height=560'); } catch { return null; }
}
export function trustedDiscovery(request, config, currentOrigin) {
  return request?.auto === true && request.origin === config.canonicalOrigin && currentOrigin !== request.origin &&
    config.sources.some(row => row.origin === currentOrigin && row.enabled !== false);
}
export function validDiscoverySummary(value) {
  return value && typeof value.hasData === 'boolean' && typeof value.name === 'string' && value.name.length <= 64 &&
    typeof value.tag === 'string' && value.tag.length <= 4 && Number.isInteger(value.count) && value.count >= 0 && value.count <= 2000 &&
    Number.isInteger(value.records) && value.records >= 0 && value.records <= 100000 &&
    [value.lastEnteredAt, value.recentMatchAt].every(n => n === null || Number.isFinite(n) && n >= 0 && n <= 8640000000000000) &&
    (value.avatar === null || typeof value.avatar === 'string' && value.avatar.length <= 160000 && /^data:image\/(jpeg|png|webp);base64,/.test(value.avatar));
}
export function createDomainDiscovery({ win = globalThis.window, onResult, onStatus, onPreview, onExportError, decode = decodePersonalData, timeoutMs = 10000, exportTimeoutMs = 180000 }) {
  let peer, queue = [], current = null, timer, closedTimer, reading = false, disposed = false;
  const result = (origin, value) => onResult(origin, value);
  const clearTimer = () => { clearTimeout(timer); timer = null; };
  const finish = () => { clearTimer(); current = null; onStatus('complete'); };
  const navigate = (source, mode) => {
    clearTimer();
    if (!peer || peer.closed) { if (mode === 'export') onExportError(); else onStatus('blocked'); return; }
    const nonce = Array.from(win.crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    current = { source, mode, nonce }; reading = false;
    if (mode === 'scan') result(source.origin, { status: 'checking', summary: null });
    timer = setTimeout(() => failCurrent('unavailable'), mode === 'export' ? exportTimeoutMs : timeoutMs);
    try { peer.location.replace(`${source.origin}/personal-data-bridge.html#sp-recover-source=${encodeURIComponent(JSON.stringify({ origin: win.location.origin, nonce, auto: true }))}`); }
    catch { failCurrent('unavailable'); }
  };
  const next = () => { if (queue.length) navigate(queue.shift(), 'scan'); else finish(); };
  const failCurrent = status => {
    if (!current) return;
    const { source, mode } = current; clearTimer(); current = null;
    if (mode === 'export') { onExportError(); return; }
    result(source.origin, { status, summary: null }); next();
  };
  const receive = async event => {
    if (disposed || !current) return;
    const request = current, { source, nonce, mode } = request;
    if (validDirectMessage(event, peer, source.origin, nonce, 'sp.recovery-summary')) {
      if (!validDiscoverySummary(event.data.summary)) { failCurrent('unavailable'); return; }
      if (mode === 'scan') {
        result(source.origin, { status: event.data.summary.hasData ? 'found' : 'empty', summary: event.data.summary }); next();
      } else if (!reading) {
        if (!event.data.summary.hasData) { failCurrent('unavailable'); return; }
        reading = true;
        try { peer.postMessage({ type: 'sp.recovery-export', nonce }, source.origin); } catch { failCurrent('unavailable'); }
      }
    } else if (mode === 'export' && reading && validDirectMessage(event, peer, source.origin, nonce, 'sp.recovery-data')) {
      if (typeof event.data.code !== 'string' || event.data.code.length > MAX_CODE_CHARS) { failCurrent('unavailable'); return; }
      // Freeze the request while decoding, so a second matching payload cannot complete twice.
      clearTimer(); current = null;
      try { const data = await decode(event.data.code); if (!disposed) { onPreview(data, source.origin); onStatus('complete'); } }
      catch { if (!disposed) onExportError(); }
    } else if (validDirectMessage(event, peer, source.origin, nonce, 'sp.recovery-error')) failCurrent(event.data.code === 'storage' ? 'storage' : 'unavailable');
  };
  win.addEventListener('message', receive);
  const attach = popup => {
    if (popup && popup !== peer) { try { peer?.close(); } catch { /* helper already gone */ } peer = popup; }
    clearInterval(closedTimer);
    closedTimer = setInterval(() => {
      if (!peer?.closed || disposed) return;
      const exporting = current?.mode === 'export';
      if (current?.mode === 'scan') result(current.source.origin, { status: 'unavailable', summary: null });
      for (const row of queue) result(row.origin, { status: 'unavailable', summary: null });
      queue = []; clearTimer(); current = null; clearInterval(closedTimer); onStatus('closed');
      if (exporting) onExportError();
    }, 500);
    return peer && !peer.closed;
  };
  return {
    scan(sources, popup) {
      if (disposed) return;
      queue = sources.slice();
      if (!attach(popup)) { queue = []; onStatus('blocked'); return; }
      onStatus('scanning'); next();
    },
    select(source, popup) {
      if (disposed) return;
      queue = [];
      if (!attach(popup)) { onExportError(); return; }
      onStatus('exporting'); navigate(source, 'export');
    },
    get window() { return peer && !peer.closed ? peer : null; },
    dispose() {
      if (disposed) return; disposed = true; clearTimer(); clearInterval(closedTimer);
      win.removeEventListener('message', receive); try { peer?.close(); } catch { /* no longer accessible */ }
      queue = []; current = null;
    },
  };
}
