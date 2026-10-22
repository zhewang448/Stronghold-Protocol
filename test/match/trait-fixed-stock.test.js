// #488 / #491: fixed trait production must survive an exhausted equipment pool, while still occupying shop stock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, legalTileFor, checkInvariants } from './harness.js';
import { collectViolations } from '../../server/match/invariants.js';

const ISO = 'chess_item_6_09_e_a';
const MUELSYSE = 'chess_char_6_11_a';
const PACK = 'chess_item_5_07_e_a';

function prep(t, { humans = 1 } = {}) {
  const h = makeMatch({ mode: 'coop', humans, seed: 11, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  for (const ps of h.m.players.values()) ps.bandId = null;
  return h;
}

for (const repeat of [1, 2, 3]) {
  test(`Muelsyse purchases keep granting after stock exhaustion (gain traits ×${repeat}, including elite merge)`, t => {
    const h = prep(t), m = h.m, ps = h.ps('p_0');
    if (repeat > 1) {
      for (const id of m.gd.bond('investShip').visibleMembers.slice(0, 3)) {
        give(m, ps, id, 'board', legalTileFor(m, ps, id));
      }
      assert.equal(ps.bonds.investShip.active, true);
      if (repeat === 3) { ps.layers.investShip = 100; ps.recompute(); }
    }
    ps.funds = 100;
    const totals = repeat === 3 ? [3, 6, 12] : [1, 2, 4, 5, 6].map(n => n * repeat);
    for (const total of totals) {
      ps.shop.slots[0] = { kind: 'chess', id: MUELSYSE, basePrice: 4, sold: false, frozen: false };
      assert.ok(ps.buy(0).ok);
      assert.equal(m.itemPool.held(ISO), total);
      assert.equal(m.itemPool.left(ISO), Math.max(0, 3 - total));
      checkInvariants(m);
      // Keep room for the next purchase without destroying gifts (buying itself requires a free hand slot).
      if (repeat > 1) for (const owner of ps.board.values()) {
        while (owner.items.length < m.gd.equipPerChess) {
          const item = ps.hand.find(p => p?.id === ISO);
          if (!item) break;
          assert.ok(ps.equip(item.uid, owner.uid).ok);
        }
      }
    }
    assert.equal(m.itemPool.canGain(ISO), false);
    assert.equal(ps.acquireItem(ISO), null, 'ordinary acquisition still requires stock');
    ps.shop.slots[1] = { kind: 'item', id: ISO, basePrice: 1, sold: false, frozen: false };
    const funds = ps.funds;
    // v0.3.0: an already displayed item is purchasable even after its pool is exhausted (#624).
    const held = m.itemPool.held(ISO);
    assert.equal(ps.buy(1).ok, true);
    assert.equal(ps.funds, funds - 1);
    assert.equal(ps.shop.slots[1].sold, true);
    assert.equal(m.itemPool.held(ISO), held + 1);
    assert.equal(m.itemPool.debtOf(ISO), 1);
    checkInvariants(m);
    assert.equal(h.logs.error.length, 0);
  });
}

test('fixed gifts count equipped and temporary copies, and stock only reopens below capacity', t => {
  const h = prep(t, { humans: 2 }), m = h.m, a = h.ps('p_0'), b = h.ps('p_1');
  const owner = give(m, a, [...m.pool.entries.keys()].find(id => m.gd.tierOf(id) === 1));
  const first = a.acquireItem(ISO), second = b.acquireItem(ISO), third = b.acquireItem(ISO);
  assert.ok(a.equip(first.uid, owner.uid).ok);
  while (b.hand.some(p => !p)) assert.ok(b.acquireItem('chess_item_2_03_e_b'));
  const extra = b.acquireItem(ISO, { requirePool: false });
  assert.ok(extra);
  assert.equal(b.find(extra.uid).area, 'temp');
  assert.equal(m.itemPool.held(ISO), 4);
  assert.ok(a.sell(owner.uid).ok);
  assert.equal(m.itemPool.held(ISO), 4, 'returned equipment still occupies stock');
  assert.ok(a.destroy(first.uid).ok);
  assert.equal(m.itemPool.left(ISO), 0, 'three owned copies still exhaust stock');
  assert.ok(b.destroy(second.uid).ok);
  assert.equal(m.itemPool.left(ISO), 1);
  assert.ok(third);
  checkInvariants(m);
});

test('Damatzi fixed-round gifts survive exhaustion; ordinary strategy gifts cannot bypass stock', t => {
  const h = prep(t), m = h.m, ps = h.ps('p_0');
  for (let i = 0; i < 3; i++) assert.ok(ps.acquireItem(ISO));
  ps.bandId = 'band_damaztic';
  for (const round of [5, 10, 15]) {
    m.round = round;
    const before = m.itemPool.held(ISO);
    m.dispatch(ps, 'onRoundStart');
    assert.equal(m.itemPool.held(ISO), before + 1);
    checkInvariants(m);
  }
  assert.ok(ps.acquireItem(PACK));
  assert.ok(ps.acquireItem(PACK));
  assert.equal(ps.acquireItem(PACK, { requirePool: false }), null, 'the flag cannot exempt ordinary equipment');
  ps.bandId = 'band_malkie'; m.round = 1;
  m.dispatch(ps, 'onRoundStart');
  assert.equal(m.itemPool.held(PACK), 2);
  checkInvariants(m);
  // The auditor still rejects ordinary over-cap ownership rather than globally relaxing equipment stock.
  ps.stow(ps.newPiece('item', PACK), { allowTemp: true });
  assert.ok(collectViolations(m).some(v => v.includes(`item group 1/${PACK}: held 3 > cap 2`)));
});

test('every data-defined fixed equipment trait produces at exhausted stock, including merged golden gifts', t => {
  for (const g of Object.values(DATA.garrisons).filter(g => g.effectType === 'SERVER_GAIN_EQUIP' && g.bb.count === 1)) {
    const h = prep(t), m = h.m, ps = h.ps('p_0'), id = g.bbStr.chess;
    assert.ok(m.gd.isUnlimitedGiftItem(id));
    const golden = m.gd.item(id).goldenId;
    assert.ok(m.gd.isUnlimitedGiftItem(golden));
    assert.equal(m.gd.isUnlimitedGiftItem('missing'), false);
    const cap = m.itemPool.cap(id);
    for (let i = 0; i < cap; i++) assert.ok(ps.acquireItem(id));
    assert.equal(m.itemPool.left(id), 0);
    const before = m.itemPool.held(id);
    assert.ok(ps.acquireChess(g.owners[0]));
    assert.equal(m.itemPool.held(id), before + 1, g.desc);
    assert.equal(m.itemPool.left(id), 0);
    if (m.gd.item(id).mergeable) assert.ok(ps.hand.some(p => p?.id === golden), 'golden gifts retain occupancy');
    checkInvariants(m);
  }
});
