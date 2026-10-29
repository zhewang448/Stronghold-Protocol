// Local console integration for isolated gameplay matches. No plugin code runs in the parent process.
// i18n-ignore-file: host-only console responses.
import { matchView, catalogView, handleAction, resultRecord } from '../../admin.js';
import { liveState, liveIntent, matchId } from '../../admin-live.js';
import { wallView } from '../../admin-wall.js';
import { setPrep, setUniteLayerGains, setRoundCharts, setLiveRoundDamage } from '../hostSettings.js';
import { setReplayConfig, replayRecord } from '../replay.js';
import { stockView, diagnosticEvents } from '../../admin-observability.js';

const rooms = new WeakMap();
function roomFor(match) {
  let room = rooms.get(match);
  if (!room) {
    room = { code: match.roomCode, mode: match.mode, difficulty: match.difficulty, match,
      adminLog: [] };
    rooms.set(match, room);
  }
  room.seats = match.order.map(p => ({ seat: p.seat, playerId: p.playerId, name: p.name, isBot: p.isBot, connected: p.connected && !p.left, left: p.left }));
  return room;
}
export function syncExtensionSettings(config) {
  if (!config) return;
  setPrep(config.prep);
  setUniteLayerGains(config.uniteLayerGains);
  setRoundCharts(config.roundCharts ?? true);
  setLiveRoundDamage(config.liveRoundDamage ?? true);
  setReplayConfig(config.replay);
}
export function extensionAdmin(match, kind, value, config) {
  syncExtensionSettings(config);
  if (!match.order || !match.gd) return { error: '当前对局不可用' };
  const room = roomFor(match), lobby = { rooms: new Map([[room.code, room]]) };
  let result;
  if (kind === 'view') result = matchView(match);
  else if (kind === 'stock') result = { ...stockView(match, value?.group), matchId: matchId(match) };
  else if (kind === 'diagnostics') result = diagnosticEvents(match);
  else if (kind === 'catalog') result = catalogView(lobby, room.code);
  else if (kind === 'wall') result = wallView(lobby, room.code);
  else if (kind === 'live') result = liveState(lobby, value);
  else if (kind === 'intent') result = liveIntent(lobby, value);
  else if (kind === 'action') result = handleAction(lobby, value);
  else return { error: '未知主机操作' };
  return { result, log: room.adminLog };
}
export function extensionEnd(match, summary) {
  if (!match?.order || !match.gd) return null;
  return { record: resultRecord(roomFor(match), match, summary), replay: replayRecord(match, {}), diagnostics: diagnosticEvents(match) };
}
