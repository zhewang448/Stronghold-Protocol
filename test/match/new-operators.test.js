import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, legalTileFor } from './harness.js';
import { capturePrep, rewindToPrep } from '../../server/match/rewind.js';
import { recoveryPayload, restoreMatch } from '../../server/recovery.js';
import { getVersionData } from '../../server/data.js';
import { diyPool } from '../../shared/diy.js';
import { KITTED_CHARS } from '../../server/sim/content/kits/index.js';

const IDS = ['char_4247_oxi', 'char_4246_dminon', 'char_4244_tocka'], SLOT = 'chess_char_6_diy1_a';
const seats = n => Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `p_${i}`, name: `P${i}`, isBot: false, connected: true,
  diy: { [SLOT]: { charId: IDS[i % 3], skillIndex: i % 3, uniEquipId: null } } }));

test('three new operators remain restricted to the current version at both DIY tiers', () => {
  for (const version of ['act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1', 'act2autochess']) {
    const data = getVersionData(version, { log: { warn() {}, info() {}, error() {} } });
    for (const tier of [5, 6]) for (const id of IDS) assert.equal(diyPool(tier, { data, kitted: KITTED_CHARS }).includes(id), version === 'act2autochess', `${version}/${tier}/${id}`);
  }
});

for (const humans of [1, 4, 20]) test(`${humans} players: new DIY pieces deploy, rotate, retreat, sell and survive rewind/recovery`, t => {
  const h = makeMatch({ mode: humans === 1 ? 'solo' : 'coop', seats: seats(humans), seed: 31, fake: true }).start().toPrep(1);
  const m = h.m; t.after(() => m.dispose());
  for (const ps of m.order) {
    const piece = ps.acquireChess(SLOT, { source: 'buy' }); assert.ok(piece?.uid);
    const tile = legalTileFor(m, ps, piece.id);
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.move', uid: piece.uid, to: { area: 'board', row: tile[0], col: tile[1] }, dir: 'UP' }), { ok: true });
    assert.equal(ps.battleInput().units.find(u => u.uid === piece.uid).diy.charId, ps.diy[SLOT].charId);
  }
  const snap = capturePrep(m); m.prepSnapshots.set(m.round, snap);
  const expected = m.order.map(ps => ({ id: ps.playerId, diy: structuredClone(ps.diy), board: [...ps.board.values()].map(p => ({ uid: p.uid, id: p.id, dir: p.dir })) }));
  for (const ps of m.order) {
    const p = [...ps.board.values()].find(p => p.id === SLOT);
    const empty = ps.hand.findIndex(p => !p);
    assert.ok(empty >= 0);
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.move', uid: p.uid, to: { area: 'hand', idx: empty } }), { ok: true });
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.sell', uid: p.uid }), { ok: true });
  }
  assert.deepEqual(rewindToPrep(m, m.round), { ok: true, round: m.round });
  for (const [i, ps] of m.order.entries()) assert.deepEqual({ id: ps.playerId, diy: ps.diy, board: [...ps.board.values()].map(p => ({ uid: p.uid, id: p.id, dir: p.dir })) }, expected[i]);
  const payload = structuredClone(recoveryPayload(m, snap));
  const other = makeMatch({ mode: humans === 1 ? 'solo' : 'coop', seats: payload.seats, seed: 31, fake: true }); t.after(() => other.m.dispose());
  restoreMatch(other.m, payload);
  assert.deepEqual(other.m.order.map(p => p.diy), m.order.map(p => p.diy));
  assert.deepEqual(other.m.order.map(p => p.board.size), m.order.map(p => p.board.size));
  h.invariants(); other.invariants();
});

for (const id of IDS) test(`${id}: three real shop purchases promote with their skill/module selection and return shared stock on sale`, t => {
  const selected = { charId: id, skillIndex: 2, uniEquipId: id === 'char_4246_dminon' ? 'uniequip_002_dminon' : null };
  const h = makeMatch({ mode: 'coop', seed: 17, fake: true, seats: [
    { seat: 0, playerId: 'p', name: 'P', connected: true, diy: { [SLOT]: selected } },
    { seat: 1, playerId: 'peer', name: 'Peer', connected: true },
  ] }).start().toPrep(1); t.after(() => h.m.dispose());
  const ps = h.ps('p'), m = h.m;
  ps.shop.level = 6; ps.funds = 100;
  const initial = ps.diyStock.left(SLOT);
  for (let n = 0; n < 3; n++) {
    ps.shop.slots[0] = { kind: 'chess', id: SLOT, basePrice: m.gd.chessPrice(SLOT), frozen: false, sold: false };
    assert.deepEqual(m.handle('p', { t: 'g.buy', slot: 0 }), { ok: true });
  }
  const elite = ps.allChess().find(p => p.id === m.data.backups.diy.slots[SLOT].goldenId);
  assert.ok(elite);
  assert.equal(elite.poolCopies, 3); assert.equal(ps.diyStock.left(SLOT), initial - 3);
  const rec = ps.gd.chess(elite.id);
  assert.equal(rec.charId, id); assert.equal(rec.skill.skillId, `skchr_${id.split('_').at(-1)}_3`);
  if (selected.uniEquipId) assert.equal(rec.module.id, selected.uniEquipId);
  const tile = legalTileFor(m, ps, elite.id);
  assert.deepEqual(m.handle('p', { t: 'g.move', uid: elite.uid, to: { area: 'board', row: tile[0], col: tile[1] }, dir: 'LEFT' }), { ok: true });
  assert.deepEqual(m.handle('p', { t: 'g.sell', uid: elite.uid }), { ok: true });
  assert.equal(ps.diyStock.left(SLOT), initial);
  h.invariants();
});
