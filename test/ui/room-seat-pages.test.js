import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomSeatPages } from '../../public/js/ui/roomSeatPages.js';
import { poolGroupSizes } from '../../shared/playerCapacity.js';

for (const count of [1, 4, 8, 10, 16, 20]) {
  test(`${count} waiting-room seats retain their identity across pages`, () => {
    const seats = Array.from({ length: count }, (_, seat) => seat % 3 === 0 ? { seat, playerId: `p${seat}`, ready: seat !== 0 } : null);
    const pages = roomSeatPages(seats, `p${Math.floor((count - 1) / 3) * 3}`);
    assert.deepEqual(pages.map(p => p.entries.length), poolGroupSizes(count));
    assert.deepEqual(pages.flatMap(p => p.entries.map(row => row.index)), Array.from({ length: count }, (_, i) => i));
    assert.deepEqual(pages.flatMap(p => p.entries.map(row => row.seat)), seats);
    assert.equal(pages.filter(p => p.mine).length, 1);
    assert.equal(pages.reduce((sum, page) => sum + page.occupied, 0), seats.filter(Boolean).length);
    assert.equal(pages.reduce((sum, page) => sum + page.ready, 0), seats.filter(s => s?.ready).length);
  });
}

test('spectators have no invented own group', () => {
  assert.ok(roomSeatPages(new Array(20).fill(null), 'spectator').every(page => !page.mine));
});

test('the host readiness agrees with the room footer', () => {
  const pages = roomSeatPages([{ playerId: 'host', ready: false }, null, null, null], 'host', 'host');
  assert.equal(pages[0].ready, 1);
});
