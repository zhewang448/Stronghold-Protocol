import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_COLORS, playerSeries, selectedSeries, playerSeatColor } from '../../public/js/ui/playerSeries.js';

const players = Array.from({ length: 20 }, (_, seat) => ({ playerId: 'p' + seat, seat, name: 'Player ' + seat }));
const history = [{ round: 1, players: players.map(p => ({ playerId: p.playerId, alive: true })) },
  { round: 2, players: players.slice().reverse().map(p => ({ playerId: p.playerId, alive: p.seat < 8 })) }];

test('avatar seat colors share all twenty statistics identities without four-seat cycling', () => {
  assert.deepEqual(players.map(p => playerSeatColor(p.seat)), PLAYER_COLORS);
  for (const invalid of [undefined, null, -1, 20, NaN, Infinity, '4', 1.5]) assert.equal(playerSeatColor(invalid), PLAYER_COLORS[0]);
  for (let i = 0; i < 16; i++) assert.notEqual(playerSeatColor(i), playerSeatColor(i + 4));
});

test('twenty players have stable distinct colors across history order, elimination and rankings', () => {
  const series = playerSeries(history, id => id, { players });
  assert.equal(series.length, 20);
  assert.equal(new Set(series.map(p => p.color)).size, 20);
  assert.deepEqual(series.map(p => p.color), PLAYER_COLORS);
  assert.deepEqual(playerSeries(history.slice().reverse(), id => id, { players: players.slice().reverse() }), series);
  assert.deepEqual(series.map(p => p.group), Array.from({ length: 20 }, (_, i) => Math.floor(i / 4) + 1));
});

test('explicit groups and sparse seats win over inferred legacy metadata', () => {
  const roster = [players[2], players[5], players[11], players[19]];
  const groups = [{ id: 1, playerIds: ['p2', 'p19'] }, { id: 2, playerIds: ['p5', 'p11'] }];
  const series = playerSeries([], id => id, { players: roster, poolGroups: groups });
  assert.deepEqual(series.map(p => p.color), [2, 5, 11, 19].map(i => PLAYER_COLORS[i]));
  assert.deepEqual(series.map(p => p.group), [1, 2, 2, 1]);
  const state = {};
  assert.deepEqual(selectedSeries(series, state, 'p19').visible.map(s => s.id), ['p2', 'p19']);
});

test('group defaults to the viewer, spectators see the first group, and explicit all stays selected', () => {
  const series = playerSeries(history, id => id, { players });
  const state = {};
  assert.deepEqual(selectedSeries(series, state, 'p17').visible.map(s => s.id), ['p16', 'p17', 'p18', 'p19']);
  assert.equal(state.group, '5');
  assert.equal(selectedSeries(series, {}).visible[0].group, 1);
  state.group = ''; state.highlight = 'p17';
  assert.equal(selectedSeries(series, state).visible.length, 20);
  assert.equal(state.highlight, 'p17');
  state.group = '2';
  assert.equal(selectedSeries(series, state).visible.length, 4);
  assert.equal(state.highlight, null);
});

test('legacy history retains eliminated players missing from later rounds and supports uneven groups', () => {
  const old = [{ players: players.slice(0, 9).map(({ playerId }) => ({ playerId })) }, { players: [{ playerId: 'p0' }] }];
  const series = playerSeries(old, id => id);
  assert.equal(series.length, 9);
  assert.deepEqual(series.map(s => s.group), [1, 1, 1, 1, 2, 2, 2, 2, 2]);
  assert.deepEqual(series.map(s => s.color), PLAYER_COLORS.slice(0, 9));
  assert.deepEqual(selectedSeries([], {}), { groups: [], visible: [] });
});

test('legacy default-zero seats cannot turn every player into the same color', () => {
  const legacy = players.map(p => ({ ...p, seat: 0 }));
  assert.deepEqual(playerSeries(history, id => id, { players: legacy }).map(s => s.color), PLAYER_COLORS);
  const sparse = [{ playerId: 'unknown' }, { playerId: 'known', seat: 0 }, { playerId: 'later', seat: 5 }];
  const series = playerSeries([], id => id, { players: sparse });
  assert.equal(series.find(s => s.id === 'known').seat, 0);
  assert.equal(series.find(s => s.id === 'unknown').seat, 1);
});

test('player swatches retain at least 3:1 graphical contrast on both statistics surfaces', () => {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(s => parseInt(s, 16) / 255)
      .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  for (const bg of ['#101311', '#141816']) for (const color of PLAYER_COLORS) {
    assert.ok((luminance(color) + .05) / (luminance(bg) + .05) >= 3, `${color} on ${bg}`);
  }
});
