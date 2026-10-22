// v0.2.6 integration at fixed-pool boundaries. Boss cases jump directly from R1 prep to R14/R15:
// they never play the preceding rounds or a complete match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { createRng } from '../../server/sim/rng.js';
import { Battle } from '../../server/sim/Battle.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { makeCtx } from '../../server/match/effectsMeta.js';
import { botPickBand, bondPlan, buyScoreOf } from '../../server/match/bot.js';
import { pairPlayers, bossPoolHp } from '../../server/match/finalAssault.js';
import { DATA, makeMatch, give, checkInvariants } from './harness.js';

function prep(t, humans, opts = {}) {
  const h = makeMatch({ humans, difficulty: 'HARD', seed: 26, fake: true, ...opts }).start().toPrep(1);
  t.after(() => h.m.dispose());
  return h;
}

const ids = groups => groups.map(g => g.map(p => p.playerId));

for (const humans of [7, 20]) {
  test(`${humans} players: displayed shops and rewards overdraw only their fixed operator pool`, t => {
    const h = prep(t, humans), m = h.m, a = h.ps('p_0'), mate = h.ps('p_1');
    const outside = m.players.get(m.poolGroups.at(-1).playerIds[0]);
    const id = Object.values(DATA.chess).find(c => !c.isGolden && c.name === '溯光星源').chessId;
    const untouched = outside.pool.snapshot();
    a.funds = 30;
    a.shop.slots[0] = { kind: 'chess', id, basePrice: 3, frozen: true, sold: false };
    a.pushRewardOffer('test', { ids: [id] });
    for (let i = 0; i < mate.pool.cap(id); i++) assert.ok(mate.acquireChess(id));
    assert.equal(a.pool.left(id), 0);
    assert.ok(a.buy(0).ok);
    assert.equal(a.buy(0).error, 'SOLD_OUT', 'a displayed card is still single-use');
    assert.ok(a.pickReward(0).ok);
    assert.equal(a.pool.entries.get(id).left, -2);
    assert.equal(a.pool.roll(m.rngShop, { tier: 6, filter: x => x === id }), null);
    assert.deepEqual(outside.pool.snapshot(), untouched);
    checkInvariants(m);
    for (const piece of [...a.allChess()].filter(c => m.gd.baseIdOf(c.id) === id)) assert.ok(a.sell(piece.uid).ok);
    assert.equal(a.pool.entries.get(id).left, 0, 'returns first repay the complete deficit');
    const elite = mate.allChess().find(c => m.gd.baseIdOf(c.id) === id && m.gd.isGolden(c.id));
    assert.ok(mate.sell(elite.uid).ok);
    assert.equal(a.pool.left(id), 3);
    assert.deepEqual(outside.pool.snapshot(), untouched);
    checkInvariants(m);
  });

  test(`${humans} players: upstream and legacy fixed-gift flags preserve grouped stock and upgrade inheritance`, t => {
    const h = prep(t, humans), m = h.m, a = h.ps('p_0'), mate = h.ps('p_1');
    const outside = m.players.get(m.poolGroups.at(-1).playerIds[0]);
    const fixed = 'chess_item_3_05_e_a', ordinary = 'chess_item_5_07_e_a';
    const stock = m.itemPoolFor(a), other = m.itemPoolFor(outside);
    const cap = stock.cap(fixed);
    for (let i = 0; i < cap; i++) assert.ok(mate.acquireItem(fixed));
    assert.equal(stock.left(fixed), 0);
    const ctx = makeCtx(m, a, { key: 'test' }, 'onTest');
    const grant = ctx.grantItem(fixed, { requirePool: false });
    assert.ok(grant);
    const piece = a.find(grant.uid).piece;
    assert.ok(piece.noPool, 'upstream gifts carry the approved fork upgrade marker');
    assert.equal(stock.held(fixed), cap + 1);
    assert.ok(a.upgradeItem(piece), 'a fixed gifted upgrade is not refused by exhaustion');
    assert.equal(stock.held(fixed), cap + 2);
    assert.equal(other.held(fixed), 0);
    assert.equal(other.left(fixed), other.cap(fixed));
    assert.ok(a.acquireItem(fixed, { noPool: true })?.noPool);
    assert.ok(a.acquireItem(ordinary));
    assert.ok(mate.acquireItem(ordinary));
    assert.equal(ctx.grantItem(ordinary, { requirePool: false }), null);
    assert.equal(ctx.grantItem(ordinary, { noPool: true }), null);
    assert.equal(other.left(ordinary), other.cap(ordinary));
    checkInvariants(m);
  });

  test(`${humans} players: AI opening reservations and high-tier scores ignore other pools and departed allies`, t => {
    const h = prep(t, humans), m = h.m, bot = h.ps('p_0'), mate = h.ps('p_1');
    const outside = m.players.get(m.poolGroups.at(-1).playerIds[0]);
    for (const p of m.order) p.bandId = null;
    const draws = () => {
      m.rngBots = createRng(401);
      return Array.from({ length: 500 }, () => botPickBand(m, bot));
    };
    const base = draws(), counts = new Map();
    for (const band of base) if (m.gd.bandBondIds(band).length) counts.set(band, (counts.get(band) || 0) + 1);
    const band = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    outside.bandId = band;
    assert.deepEqual(draws(), base, 'a cross-group strategy leaves the whole seeded selection stream unchanged');
    mate.bandId = band;
    const held = draws().filter(id => id === band).length;
    assert.ok(held > 0 && held < counts.get(band), 'same-group reservation lowers weight without forbidding a pick');
    m.onLeave(mate.playerId);
    assert.deepEqual(draws(), base, 'a departed same-pool seat releases its reservation');
    const survivor = h.ps('p_2');
    survivor.bandId = band;
    survivor.lp = 0; survivor.eliminate(0);
    assert.deepEqual(draws(), base, 'an eliminated same-pool seat releases its reservation');
    outside.bandId = 'band_chiave';
    bot.shop.level = 6;
    const high = 'chess_char_5_10_a';
    const crossScore = buyScoreOf(m, bot, high);
    outside.bandId = null;
    assert.equal(buyScoreOf(m, bot, high), crossScore, 'cross-group high-tier stock is independent');
    const remaining = h.ps('p_3');
    remaining.bandId = 'band_chiave';
    assert.ok(buyScoreOf(m, bot, high) < crossScore, 'living same-pool high-tier preferences are retained');
  });

  test(`${humans} players: AI core focus reserves only living members of its fixed pool`, t => {
    const h = prep(t, humans), m = h.m, bot = h.ps('p_0'), mate = h.ps('p_1');
    const outside = m.players.get(m.poolGroups.at(-1).playerIds[0]);
    for (const p of m.order) p.bandId = null;
    const chessOf = bond => Object.values(DATA.chess).find(c => c.visible && !c.isGolden && c.tier <= 3
      && c.bonds?.includes(bond) && c.bonds.filter(b => m.gd.bond(b)?.isCore).length === 1 && bot.pool.has(c.chessId));
    const cores = m.gd.bondIds.filter(id => m.gd.bond(id)?.isCore && !m.gd.modeInactiveBonds.has(id) && chessOf(id));
    const [a, b] = cores;
    assert.ok(a && b);
    give(m, bot, chessOf(a).chessId, 'hand'); give(m, bot, chessOf(b).chessId, 'hand');
    const focus = () => { bot._botFocus = null; bot._botFocusId = null; return bondPlan(m, bot).focus; };
    const natural = focus(), other = natural === a ? b : a;
    for (let layers = 10; layers <= 60; layers += 10) {
      bot.layers[other] = layers;
      if (focus() === other) break;
    }
    assert.equal(focus(), other);
    const band = m.gd.bandIds().find(id => m.gd.bandBondIds(id).includes(other) && !m.gd.bandBondIds(id).includes(natural));
    assert.ok(band);
    outside.bandId = band;
    assert.equal(focus(), other, 'other pools do not reserve this core');
    mate.bandId = band;
    assert.notEqual(focus(), other, 'same-pool strategy reserves this core');
    mate.lp = 0; mate.eliminate(0);
    assert.equal(focus(), other, 'elimination ends the local reservation');
    for (const p of m.order) p.recompute();
    checkInvariants(m);
  });

  test(`${humans} players: seeded boss pairing reaches every seat and keeps surviving pairs and sides`, () => {
    const all = Array.from({ length: humans }, (_, seat) => ({ seat, playerId: `p_${seat}` }));
    const partners = new Set();
    for (let seed = 1; seed <= 128; seed++) {
      const pairs = pairPlayers(all, createRng(seed));
      assert.deepEqual(ids(pairs), ids(pairPlayers([...all].reverse(), createRng(seed))));
      assert.equal(pairs.length, Math.ceil(humans / 2));
      assert.deepEqual(pairs.flat().map(p => p.seat).sort((a, b) => a - b), all.map(p => p.seat));
      const mate = pairs.find(g => g.some(p => p.seat === 0)).find(p => p.seat !== 0);
      if (mate) partners.add(mate.seat);
      const previous = ids(pairs), departed = pairs.find(g => g.length === 2)[0].playerId;
      const alive = all.filter(p => p.playerId !== departed);
      const next = ids(pairPlayers(alive, createRng(seed + 500), previous));
      for (const pair of previous.filter(g => g.length === 2 && !g.includes(departed))) {
        assert.ok(next.some(g => g.join() === pair.join()), 'complete pairs keep their partner and left/right sides');
      }
      assert.equal(new Set(next.flat()).size, humans - 1);
      assert.ok(!next.flat().includes(departed));
    }
    assert.equal(partners.size, humans - 1, 'random pairing is not restricted to a seat neighbour or pool group');
  });

  test(`${humans} players: elimination before boss prep and a prep quit preserve surviving partners into hidden prep`, t => {
    const h = prep(t, humans), m = h.m;
    const eliminated = h.ps('p_0');
    eliminated.lp = 0; eliminated.eliminate(0);
    m.startRound(m.gd.bossRound);
    h.drive(() => m.phase === PHASE.PREP && m.round === m.gd.bossRound, { ready: false, maxSteps: 50 });
    const previous = structuredClone(m.bossPairs);
    assert.equal(previous.flat().length, humans - 1);
    assert.ok(!previous.flat().includes(eliminated.playerId));
    const leaver = previous.find(g => g.length === 2)[0];
    m.onLeave(leaver);
    const afterQuit = structuredClone(m.bossPairs);
    for (const pair of previous.filter(g => g.length === 2 && !g.includes(leaver))) {
      assert.ok(afterQuit.some(g => g.join() === pair.join()));
    }
    assert.equal(new Set(afterQuit.flat()).size, humans - 2);
    assert.ok(!afterQuit.flat().includes(leaver));
    m.startRound(m.gd.hiddenRound);
    h.drive(() => m.phase === PHASE.PREP && m.round === m.gd.hiddenRound, { ready: false, maxSteps: 50 });
    assert.deepEqual(m.bossPairs, afterQuit, 'the updated surviving partnerships persist into the hidden preparation');
    for (const p of m.alivePlayers()) {
      const group = m.bossGroupOf(p), pair = afterQuit.find(g => g.includes(p.playerId));
      assert.equal(group.side, pair.indexOf(p.playerId) === 0 ? 'L' : 'R');
    }
    checkInvariants(m);
  });

  for (const hidden of [false, true]) test(`${humans} players: direct ${hidden ? 'hidden' : 'final'} boss entry keeps pair previews and rescales a quit`, t => {
    const h = prep(t, humans, { instant: false }), m = h.m;
    m.startRound(m.gd.bossRound);
    h.drive(() => m.phase === PHASE.PREP && m.round === m.gd.bossRound, { ready: false, maxSteps: 50 });
    assert.equal(m.phase, PHASE.PREP);
    const previous = structuredClone(m.bossPairs);
    if (hidden) {
      m.startRound(m.gd.hiddenRound);
      h.drive(() => m.phase === PHASE.PREP && m.round === m.gd.hiddenRound, { ready: false, maxSteps: 50 });
      assert.deepEqual(m.bossPairs, previous, 'hidden prep keeps the original draw');
      m.teamLp = m.alivePlayers().reduce((sum, p) => sum + p.lp, 0);
      for (const p of m.alivePlayers()) p.lpAtFinal = p.lp;
    }
    m.setDeadline(0); m.startFinalAssault(hidden);
    assert.deepEqual(m.fields.map(f => f.players), previous);
    assert.equal(m.publicView().bossPairs.flat().length, humans);
    const bossId = hidden ? m.hiddenBossId : m.bossId, pool = m.bossPool;
    assert.equal(pool.maxHp, bossPoolHp(m.gd, bossId, humans));
    pool.damage('p_1', pool.maxHp / 4);
    const ratio = pool.hp / pool.maxHp;
    m.onLeave('p_0');
    assert.equal(pool.maxHp, bossPoolHp(m.gd, bossId, humans - 1));
    assert.ok(Math.abs(pool.hp / pool.maxHp - ratio) < 1 / pool.maxHp);
    assert.equal(m.poolGroups.flatMap(g => g.playerIds).length, humans, 'quitting does not rebuild fixed stock groups');
    m._broadcastPool(true);
    h.sched.advance(300);
    assert.equal(h.lastBc('b.pool').max, pool.maxHp);
    assert.deepEqual(h.logs.error, []);
    checkInvariants(m);
  });

  for (const reason of ['eliminated', 'quit']) test(`${humans} players: Touch still grants across all groups after its holder ${reason}`, t => {
    const h = prep(t, humans), m = h.m, holder = h.ps('p_0');
    const receiver = m.players.get(m.poolGroups.at(-1).playerIds[0]);
    h.setStage('act2autochess_m01');
    for (const p of m.order) p.bandId = null;
    holder.bandId = 'band_amedic';
    if (reason === 'quit') m.onLeave(holder.playerId);
    else { holder.lp = 0; holder.eliminate(0); }
    assert.equal(m.teamMedicGranted(), true);
    assert.equal(receiver.privateView().prepMapChars.length, 1);
    const opts = m._normalOpts(receiver);
    const b = new Battle({ ...opts, data: getDefaultSource(), spawns: [], timeLimit: 300, autoFinish: false });
    b.start();
    assert.equal(b.errorCount, 0);
    assert.deepEqual(b.allyUnits.filter(u => u.alive && !u.removed && u.defId === 'char_605_cmedic').map(u => u.defId), ['char_605_cmedic']);
    assert.ok(!b.players[0].input.contentInfo.teammates.some(p => p.playerId === holder.playerId));
  });
}
