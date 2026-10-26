/* global document, window, location, ResizeObserver, Option */
// i18n-ignore-file: Chinese local host toolbar; the embedded game keeps its ordinary localized UI.
import { render, h } from '/vendor/preact.module.js';
import { GameScreen } from '/js/screens/game.js';
import { store, emptyMatch } from '/js/store.js';
import { net, NetError } from '/js/net.js';
import { battleRunner } from '/js/battle/runner.js';
import { ToastHost, toast } from '/js/ui/toasts.js';
import { closeAllDialogs } from '/js/ui/components.js';
import { audio } from '/js/audio.js';
import { installContent, installContentSet, contentFor } from '/js/content.js';
import { DEFAULT_VERSION } from '/shared/versions.js';
installContent({ toast });
installContentSet({ net: null, toast });

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const embedded = params.get('wall') === '1';
document.body.classList.toggle('live-wall', embedded);
const room = params.get('room');
let playerId = params.get('playerId'), state = null, watched = null, timer = null, sequence = 0, disposed = false;
let knownBattle = null, shownField = null, mounted = false, syncing = null;
const token = document.querySelector('meta[name="admin-token"]').content;
const header = document.querySelector('.live-bar');
const resize = new ResizeObserver(() => document.documentElement.style.setProperty('--live-bar-height', `${header.getBoundingClientRect().height}px`));
resize.observe(header);
const api = async (body = null, extra = {}) => {
  const query = new URLSearchParams({ room: room || '', playerId: playerId || '',
    ...(watched ? { fieldId: watched } : {}), ...(knownBattle ? { battleId: knownBattle } : {}),
    ...(state ? { matchId: state.matchId } : {}), ...extra });
  const response = await fetch(`/api/live${body ? '' : `?${query}`}`, { method: body ? 'POST' : 'GET',
    headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok || value.error) {
    const error = new NetError(value.code || value.error || 'OFFLINE', value.error || '读取失败', value.detail);
    if (value.error && value.code !== value.error) error.message = value.error;
    throw error;
  }
  return value;
};

function reset() {
  sequence++;
  knownBattle = shownField = null;
  state = null;
  battleRunner.clear();
  closeAllDialogs();
  render(null, $('live-game'));
  mounted = false;
  store.set({ match: emptyMatch(), ticker: [], emotes: [] });
  $('live-control').checked = false;
}

function status(message, error = false) {
  $('live-status').textContent = message;
  $('live-status').className = error ? 'is-error' : '';
}

async function sync() {
  if (disposed) return;
  if (syncing) return syncing;
  const seq = sequence;
  syncing = (async () => {
    try {
      const next = await api();
      if (disposed || seq !== sequence) return;
      if (state && state.matchId !== next.matchId) {
        reset(); watched = null;
        status('房间已开始新的对局，请重新打开实时查看', true);
        $('live-message').hidden = false;
        $('live-message').textContent = '上一局已结束。请返回控制台，重新选择活动对局。';
        disposed = true;
        return;
      }
      state = next;
      const options = next.players.map((p) => ({ value: p.playerId, text: `${p.name}${p.isBot ? '（AI，仅查看）' : p.left ? '（已退出）' : !p.alive ? '（已淘汰）' : ''}` }));
      const signature = JSON.stringify(options);
      if ($('live-player').dataset.signature !== signature) {
        $('live-player').replaceChildren(...options.map((p) => new Option(p.text, p.value)));
        $('live-player').dataset.signature = signature;
      }
      $('live-player').value = playerId;
      $('live-player').disabled = embedded;
      $('live-control').disabled = embedded || !next.controllable;
      if (embedded || !next.controllable) $('live-control').checked = false;
      $('live-message').hidden = true;
      $('live-game').hidden = false;
      store.set({ me: { playerId, name: next.name, token: null }, session: { entered: true },
        connection: { status: 'online', ping: null, everOnline: true },
        room: { code: room, inMatch: true, version: next.version || next.public.version || DEFAULT_VERSION,
          convenience: next.public.convenience, mode: next.mode, difficulty: next.difficulty,
          spectators: [], seats: next.players, ...(next.content ? { content: next.content } : {}) },
        content: next.vanilla ? { vanilla: next.vanilla } : null,
        clock: { offset: next.public.serverNow - Date.now(), rtt: null, synced: true } });
      store.patch('match', { public: next.public, private: next.private });
      if (next.content && (next.content.vanilla === false || store.get().room.version !== DEFAULT_VERSION)) {
        status('正在加载对局版本与内容…');
        const content = await contentFor(next.content.cs);
        if (disposed || seq !== sequence) return;
        if (!content) throw new Error('对局内容尚未就绪，请重试或重新打开实时查看');
      }
      if (!mounted) { render(h(GameScreen), $('live-game')); mounted = true; }
      if (next.pool) battleRunner.onPool(next.pool);
      battleRunner.setPaused(!!next.public.paused);
      if (!next.battleId && knownBattle) {
        battleRunner.clear(); knownBattle = null; store.patch('match', { field: null });
      }
      if (next.battle) {
        await battleRunner.onStart(next.battle);
        if (disposed || seq !== sequence) return;
        knownBattle = next.battle.battleId;
      }
      if (next.end) battleRunner.onEnd(next.end);
      if (next.field) {
        if (shownField !== next.field.fieldId || !next.battleId) {
          store.patch('match', { field: next.field });
          net._emit('m.field', next.field);
        }
        shownField = next.field.fieldId;
      }
      if (next.snapshot) net._emit('b.snap', next.snapshot);
      status(`${next.name} · ${$('live-control').checked ? '代操作已开启，操作与玩家同步' : '仅查看，开启代操作后可操作'}${next.private.ready ? ' · 玩家已准备' : ''}`);
    } catch (error) {
      if (disposed || seq !== sequence) return;
      if (state && ['WRONG_PHASE', 'NOT_IN_ROOM'].includes(error.code)) {
        reset();
        disposed = true;
        $('live-game').hidden = true;
        $('live-message').hidden = false;
        $('live-message').textContent = error.message;
      }
      $('live-control').checked = false;
      $('live-control').disabled = true;
      status(`${error.message}；连接恢复后自动刷新`, true);
      if (!state) { $('live-message').hidden = false; $('live-message').textContent = error.message; }
    } finally { syncing = null; }
  })();
  return syncing;
}

// Override the transport before mounting. The console never opens /ws, claims a session or submits b.* reports.
net.request = async (type, fields = {}) => {
  if (type === 'g.watch') {
    watched = fields.fieldId;
    knownBattle = null;
    await sync();
    return { ok: true };
  }
  if (type === 'g.unitStats') {
    const stats = await api(null, { statsSeq: String(fields.seq ?? 0) });
    net._emit('m.unitStats', stats.unitStats);
    return { ok: true };
  }
  if (embedded || !$('live-control').checked || !state?.controllable) throw new NetError('WRONG_PHASE', '当前仅查看，请先开启代操作');
  const seq = sequence, target = playerId;
  const intent = { ...fields, t: type };
  try {
    return await api({ room, playerId: target, matchId: state.matchId, revision: state.revision,
      round: state.public.round, phase: state.public.phase, intent });
  } finally { if (seq === sequence) await sync(); }
};
net.send = () => false;
render(h(ToastHost), $('live-toasts'));
audio.setVolumes({ muted: true });
$('live-player').onchange = () => {
  playerId = $('live-player').value;
  watched = null;
  reset();
  const url = new URL(location.href); url.searchParams.set('playerId', playerId); window.history.replaceState(null, '', url);
  sync();
};
$('live-control').onchange = () => { status($('live-control').checked ? '代操作已开启，操作与玩家同步' : '仅查看'); };
async function poll() {
  await sync();
  if (!disposed) timer = setTimeout(poll, 500);
}
window.addEventListener('pagehide', () => { disposed = true; clearTimeout(timer); resize.disconnect(); reset(); });
poll().catch((error) => toast(error.message, 'error'));
