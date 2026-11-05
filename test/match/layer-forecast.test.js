// 预计叠层 (feedback #25, server/match/layerForecast.js): the layers a player's own <休整期结束时> effects add, as a
// recording preview of onPrepEnd — deterministic sources and their order, the 999 cap, random sources flagged and left
// out, never a write to the match or a draw of its RNG; delivered in the own m.private during PREP only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { layerForecast } from '../../server/match/layerForecast.js';
import { makeMatch, give } from './harness.js';

const playerSnapshot = (ps) => structuredClone(Object.fromEntries(Object.entries(ps).filter(([k, v]) => k !== 'm' && k !== 'gd' && typeof v !== 'function')));
const rngs = (m) => [m.rngMeta, m.rngBots, m.rngShop, m.rngWaves, m.rngDraft, m.rngSetup].filter(Boolean).map((r) => r.state());

/** A PREP of round 1 with the first human's own state cleared: no strategy, no effects, an empty board and hand. */
function setup(registry = createRegistry(), o = {}) {
  const h = makeMatch({ humans: 2, seed: 41, registry, ...o }).start().toPrep();
  const m = h.m, ps = m.order[0];
  ps.bandId = null;
  ps.effects = [];
  for (const p of [...ps.board.values(), ...ps.hand, ...ps.temp]) if (p && p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps.layers = {};
  ps.bondCountBonus = {};
  ps.recompute();
  return { h, m, ps };
}

/** The layers the real onPrepEnd dispatch adds now (on the live player: the caller's last step). */
function realGains(m, ps) {
  const before = { ...ps.layers };
  m.dispatch(ps, 'onPrepEnd', { round: m.round });
  const out = {};
  for (const [id, n] of Object.entries(ps.layers)) if (n - (before[id] || 0) > 0) out[id] = n - (before[id] || 0);
  return out;
}
const totals = (f) => Object.fromEntries(Object.entries(f.bonds).map(([id, b]) => [id, b.n]));

test('预计叠层: 助力 +2 to every active bond, then 波登可 feeds the active bond with the most layers — the real deadline adds the same', () => {
  const { h, m, ps } = setup();
  try {
    give(m, ps, 'chess_char_1_06_a', 'board', [9, 4]); // 刺玫: 助力 + 维多利亚 (inactive: its +1 needs it active)
    give(m, ps, 'chess_char_1_13_a', 'board', [9, 5]); // 波登可: 助力; <休整期结束时>当前激活且层数最多的盟约层数+1
    ps.bondCountBonus = { steadShip: 2 };
    ps.layers = { deputShip: 4, steadShip: 6 };
    ps.recompute();
    assert.ok(ps.bonds.deputShip.active && ps.bonds.steadShip.active && !ps.bonds.victoriaShip.active);
    const players = m.order.map(playerSnapshot);
    const rng = rngs(m);
    const dirty = new Set(m._privDirty);
    const sent = h.sent.length;
    const f = m.dispatcher.forecastLayers(ps);
    assert.deepEqual(f, {
      bonds: {
        deputShip: { n: 2, sources: [{ kind: 'bond', id: 'deputShip', n: 2 }] },
        steadShip: { n: 3, sources: [{ kind: 'bond', id: 'deputShip', n: 2 }, { kind: 'garrison', id: 'chess_char_1_13_a', n: 1 }] },
      },
      random: false,
      randomSources: [],
      partial: false,
    });
    assert.deepEqual(m.order.map(playerSnapshot), players, 'no player field changes');
    assert.deepEqual(rngs(m), rng, 'no match RNG is drawn');
    assert.deepEqual(new Set(m._privDirty), dirty, 'nothing is marked dirty');
    assert.equal(h.sent.length, sent, 'no m.layer cue (or anything else) is sent');
    assert.equal(m.dispatcher.errors, 0);
    assert.deepEqual(realGains(m, ps), totals(f), 'the deadline adds what the forecast said');
  } finally { m.dispose(); }
});

test('预计叠层: reads go through the ledger (an earlier 特质 makes another bond the 层数最多 one); a plugin handler is never called', () => {
  const registry = createRegistry();
  // registered after createRegistry (like a plugin or DSL spec): not the engine's own, so the forecast never calls it
  const calls = [];
  registry.global('forecast_plugin', { onPrepEnd(ctx, ev) {
    if (ctx.playerId !== 'p_0') return;
    calls.push(ev.preview === true);
    ctx.addLayers('indomShip', 50);
  } });
  const { m, ps } = setup(registry);
  try {
    give(m, ps, 'chess_char_2_17_a', 'board', [9, 4]); // 折桠 (坚守 / 孤狼): <休整期结束时>使已激活的【坚守】层数+4
    give(m, ps, 'chess_char_1_13_a', 'board', [9, 5]); // 波登可: then the active bond with the most layers +1
    ps.bondCountBonus = { steadShip: 2, indomShip: 2 };
    ps.layers = { steadShip: 8, indomShip: 10 };
    ps.recompute();
    calls.length = 0;
    const f = layerForecast(m, ps);
    assert.deepEqual(f.bonds, { steadShip: { n: 5, sources: [{ kind: 'garrison', id: 'chess_char_2_17_a', n: 4 }, { kind: 'garrison', id: 'chess_char_1_13_a', n: 1 }] } },
      'stead 8 + 4 = 12 beats indom 10: 波登可 feeds 坚守');
    assert.equal(f.random, false);
    assert.equal(f.partial, true, 'the skipped plugin handler makes the forecast partial');
    assert.deepEqual(calls, [], 'the plugin handler was not called by the forecast');
    const real = realGains(m, ps);
    assert.deepEqual(calls, [false], 'the deadline calls it once, as usual');
    // the plugin's +50 runs first at the deadline (a global), so 不屈 becomes the 层数最多 bond there: what `partial` warns of
    assert.deepEqual(real, { steadShip: 4, indomShip: 51 });
  } finally { m.dispose(); }
});

test('预计叠层: a random source (重点监护 picks an operator per 阶级) is flagged and not counted; the match RNG stays where it was', () => {
  const { m, ps } = setup();
  try {
    give(m, ps, 'chess_char_1_06_a', 'board', [9, 4]);
    give(m, ps, 'chess_char_1_13_a', 'board', [9, 5]);
    ps.bandId = 'band_bldsk'; // prep_finish_char_bond_add_layer (bands/meta.js): ctx.rng.pick per tier, +2 to its bonds
    ps.recompute();
    const rng = rngs(m);
    const players = m.order.map(playerSnapshot);
    const f = m.dispatcher.forecastLayers(ps);
    assert.equal(f.random, true);
    assert.deepEqual(f.randomSources, [{ kind: 'band', id: 'band_bldsk' }]);
    assert.ok(!Object.values(f.bonds).some((b) => b.sources.some((s) => s.kind === 'band')), 'the strategy adds nothing to the forecast');
    // 助力 2/2 (+2 to 助力) and 波登可's +1 on the only active bond still count
    assert.deepEqual(totals(f), { deputShip: 3 });
    assert.deepEqual(rngs(m), rng, 'the band drew a clone of rngMeta, not the match stream');
    assert.deepEqual(m.order.map(playerSnapshot), players);
    assert.deepEqual(m.dispatcher.forecastLayers(ps), f, 'the same answer every time (the clone starts at the same position)');
  } finally { m.dispose(); }
});

test('预计叠层 in m.private: own seat during PREP only, memoized on its inputs, never public / for a bot / disconnected / outside PREP', () => {
  const { m, ps } = setup(createRegistry(), { bots: 1 });
  try {
    give(m, ps, 'chess_char_1_06_a', 'board', [9, 4]);
    give(m, ps, 'chess_char_1_13_a', 'board', [9, 5]);
    const keys = Object.keys(m).sort();
    let calls = 0;
    const real = m.dispatcher.forecastLayers.bind(m.dispatcher);
    m.dispatcher.forecastLayers = (p) => { calls++; return real(p); };
    const v = ps.privateView();
    assert.deepEqual(totals(v.layerForecast), { deputShip: 3 });
    ps.privateView();
    assert.equal(calls, 1, 'an unchanged prep is not recomputed');
    ps.layers = { ...ps.layers, deputShip: 998 };
    ps.recompute();
    assert.deepEqual(totals(ps.privateView().layerForecast), { deputShip: 1 }, 'a change recomputes (998 + 2 → 999, then no room)');
    assert.equal(calls, 2);
    assert.deepEqual(Object.keys(m).sort(), keys, 'no Match field is added (nothing for a checkpoint)');
    assert.ok(!JSON.stringify(m.publicView()).includes('layerForecast'));
    assert.ok(!JSON.stringify(m.prepFieldMeta(ps)).includes('layerForecast'), 'a teammate scouting the board sees no forecast');
    const mate = m.order.find((p) => p !== ps && !p.isBot);
    const bot = m.order.find((p) => p.isBot);
    assert.ok(mate && bot);
    assert.ok('layerForecast' in mate.privateView(), 'the other human has its own');
    assert.ok(!('layerForecast' in bot.privateView()), 'a bot gets none');
    mate.connected = false;
    assert.ok(!('layerForecast' in mate.privateView()), 'a disconnected seat gets none');
    mate.connected = true;
    m.phase = PHASE.COMBAT;
    assert.ok(!('layerForecast' in ps.privateView()), 'outside PREP the field is absent');
    m.phase = PHASE.PREP;
  } finally { m.dispose(); }
});

test('预计叠层: the detached game-data view is made once per match, not for every forecast (rel20 hotfix)', () => {
  const { m, ps } = setup();
  try {
    give(m, ps, 'chess_char_1_06_a', 'board', [9, 4]);
    give(m, ps, 'chess_char_1_13_a', 'board', [9, 5]);
    ps.layers = { deputShip: 4 };
    ps.recompute();
    const first = m.dispatcher.forecastLayers(ps);
    assert.equal(m.dispatcher._forecastData.size, 1);
    const view = [...m.dispatcher._forecastData.values()][0];
    assert.deepEqual(m.dispatcher.forecastLayers(ps), first);
    assert.equal(m.dispatcher._forecastData.size, 1);
    assert.equal([...m.dispatcher._forecastData.values()][0], view);
  } finally { m.dispose(); }
});
