import { poolGroupSizes } from '../../../shared/playerCapacity.js';

// Waiting-room pages retain every physical seat index; starting a match still uses the server's occupied seats.
export function roomSeatPages(seats, myId, hostId = null) {
  if (!Array.isArray(seats) || seats.length < 1) return [];
  let start = 0;
  return poolGroupSizes(seats.length).map((size, index) => {
    const entries = seats.slice(start, start + size).map((seat, offset) => ({ seat, index: start + offset }));
    start += size;
    return { index, label: String.fromCharCode(65 + index), entries,
      occupied: entries.filter(row => row.seat).length,
      ready: entries.filter(row => row.seat && (row.seat.isBot || row.seat.ready || row.seat.playerId === hostId)).length,
      mine: entries.some(row => row.seat?.playerId === myId) };
  });
}
