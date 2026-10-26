// i18n-ignore-file: bounded read-only host monitor, never builds private/battle state.
import { GEO, PHASE_NAMES } from '../shared/constants.js';
import { boardOrder } from './match/board.js';
const matches = new WeakMap();
let nextMatch = 0;

export function wallView(lobby, code) {
  const room = lobby.rooms.get(code);
  if (!room) return { error: '房间已关闭', seats: Array(4).fill(null) };
  const m = room.match;
  if (m?.hosted) return m.admin('wall').then(view => !Array.isArray(view.seats) ? view : ({ ...view, seats: view.seats.map(seat => {
    if (!seat) return null;
    const current = room.seats.find(p => p?.playerId === seat.playerId);
    return { ...seat, connected: !!(current && !current.left && (current.isBot || current.connected)), left: !!(seat.left || current?.left) };
  }) }));
  if (m && !matches.has(m)) matches.set(m, ++nextMatch);
  return { room: code, matchId: m && !m.ended && !m.disposed ? matches.get(m) : null,
    phase: m ? PHASE_NAMES[m.phase] || m.phase : '对局未开始或已结束', round: m?.round ?? null,
    seats: Array.from({ length: room.seats.length }, (_, i) => {
      const seat = room.seats[i]; if (!seat) return null;
      const ps = m?.players.get(seat.playerId);
      return { seat: i, playerId: seat.playerId, name: seat.name, connected: !!(seat.connected && !seat.left && !ps?.left), isBot: seat.isBot,
        alive: ps?.alive, left: ps?.left ?? seat.left, autoplay: ps?.autoplay, ready: ps?.ready ?? seat.ready,
        lp: ps?.lp ?? null, funds: ps?.funds ?? null, level: ps?.shop.level ?? null,
        board: ps ? boardOrder(ps.board).filter(({ r, c }) => r >= GEO.FIELD.r0 && r <= GEO.FIELD.r1 && c >= GEO.FIELD.c0 && c <= GEO.FIELD.c1)
          .map(({ r, c, piece }) => ({ row: r - GEO.FIELD.r0, col: c - GEO.FIELD.c0,
            name: (piece.kind === 'chess' ? (ps.fieldsStandIn(piece.id) ? ps.gd.standIn(piece.id) : ps.gd.chess(piece.id)) : ps.gd.token(piece.id))?.name || '未知棋子', elite: piece.kind === 'chess' && ps.gd.isGolden(piece.id) })) : [],
        bonds: ps ? Object.entries(ps.bondsView()).filter(([, b]) => b.active).map(([id, b]) => ({ name: ps.gd.bond(id)?.name || id, layers: b.layers })) : [] };
    }) };
}
