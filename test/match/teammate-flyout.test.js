import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';

test('teammate lookup publishes field operators in board order, with elite identity, and excludes tokens and the bench', t => {
  const h = makeMatch({ humans: 8 });
  t.after(() => h.m.dispose());
  const ps = h.ps('p_4');
  const normal = ps.newPiece('chess', 'chess_char_1_19_a');
  const elite = ps.newPiece('chess', 'chess_char_1_19_b');
  ps.board.set('12,4', elite);
  ps.board.set('10,4', normal);
  ps.board.set('11,4', { uid: 999, kind: 'token', id: 'lookup-token' });
  ps.hand[0] = ps.newPiece('chess', 'chess_char_1_02_a');
  const rows = h.m.publicView().players;
  assert.deepEqual(rows.find(p => p.playerId === ps.playerId).boardOps, [
    { id: DATA.chess[elite.id].charId, golden: 1 }, { id: DATA.chess[normal.id].charId },
  ]);
  assert.deepEqual(rows.find(p => p.playerId === 'p_0').boardOps, []);
  assert.equal(rows.length, 8);
});

test('eliminated seats expose no field operators', t => {
  const h = makeMatch();
  t.after(() => h.m.dispose());
  const ps = h.ps('p_0');
  ps.board.set('10,4', ps.newPiece('chess', 'chess_char_1_19_a'));
  ps.alive = false;
  assert.deepEqual(h.m.publicView().players[0].boardOps, []);
});
