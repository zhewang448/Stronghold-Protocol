import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { recordRound, roundChartHistory } from '../../server/match/history.js';
import { resetHostSettings, setRoundCharts, setLiveRoundDamage } from '../../server/match/hostSettings.js';
import { capturePrep, rewindToPrep } from '../../server/match/rewind.js';
import { pointsOf } from '../../public/js/ui/roundChart.js';
import { battleDamage, LIVE_DAMAGE_UNITS } from '../../shared/battleDamage.js';
import { validateC2S } from '../../shared/protocol.js';

test('live and settled history distinguish same-name pieces while combining their own waves', () => {
  const h = makeMatch({ humans: 1, fake: true }).start().toPrep(), m = h.m;
  try {
    const chessId = Object.keys(m.data.chess)[0], name = m.gd.chess(chessId).name;
    const unit = (uid, dmg) => ({ uid, defId: chessId, name, dmg, kills: 1 });
    m.phase = 'UNITE';
    m.lastResults.set('p_0', { damageDealt: 30, unitStats: [unit(71, 10), unit(72, 20)] });
    const wave = { perPlayer: { p_0: { damageDealt: 7, unitStats: [unit(71, 7)] } } };
    m.fields = [{ done: true, result: wave }];
    const live = roundChartHistory(m, { live: true }).at(-1).players[0].units;
    assert.deepEqual(live.map(({ uid, dmg }) => ({ uid, dmg })).sort((a, b) => a.uid - b.uid), [
      { uid: 71, dmg: 17 }, { uid: 72, dmg: 20 },
    ]);
    m.order[0].stats.dmgDealt = 37;
    recordRound(m, { uniteResult: wave });
    assert.deepEqual(roundChartHistory(m).at(-1).players[0].units, live);
  } finally { m.dispose(); }
});

test('public round charts use settled records, exclude noStack bonds and host-only details, follow rewind and the host gate', (t) => {
  const h = makeMatch({ humans: 2, fake: true }).start().toPrep();
  t.after(() => { h.m.dispose(); resetHostSettings(); });
  const m = h.m, ps = m.order[0];
  assert.equal(m.publicView().roundCharts, true);
  assert.deepEqual(m.publicView().roundHistory, []);
  const bonds = {
    yanShip: { active: true, layers: 15, tier: 1 },
    soloShip: { active: true, layers: 9, tier: 1 },
    maniShip: { active: true, layers: 5, tier: 1 },
  };
  ps.lastRoundBonds = bonds;
  recordRound(m);
  recordRound(m);
  m.history[0].players[0].units = [{ defId: 'test-op', name: 'Test', dmg: 123, kills: 2, internal: 'private' }];
  const pub = m.publicView();
  assert.equal(pub.roundHistory.length, 1, 'one record per round');
  const p = pub.roundHistory[0].players[0];
  assert.deepEqual(p.bonds, [{ id: 'yanShip', name: m.gd.bond('yanShip').name, active: true, layers: 15 }]);
  assert.equal(p.lp, m.history[0].players[0].lp);
  assert.equal(p.spent, m.history[0].players[0].spent);
  assert.deepEqual(p.units, [{ defId: 'test-op', name: 'Test', dmg: 123, kills: 2 }]);
  assert.equal(p.economy, undefined);
  assert.equal(pub.roundHistory[0].enemy, undefined);
  assert.equal(m.history[0].players[0].bonds.find((b) => b.id === 'soloShip').noStack, true);
  m.round = 2; m.prepSnapshots.set(2, capturePrep(m));
  recordRound(m);
  assert.equal(m.publicView().roundHistory.length, 2);
  assert.equal(rewindToPrep(m, 2).ok, true);
  assert.deepEqual(m.publicView().roundHistory.map((h) => h.round), [1]);
  setRoundCharts(false);
  assert.equal(m.publicView().roundCharts, false);
  assert.deepEqual(m.publicView().roundHistory, []);
  setRoundCharts(true);
  assert.equal(m.publicView().roundHistory.length, 1, 'history survives a hidden panel');
});

test('chart points stop after elimination and distinguish missing legacy economy from zero', () => {
  const history = [
    { round: 1, players: [{ playerId: 'a', alive: true, income: null }] },
    { round: 2, players: [{ playerId: 'a', alive: false, income: 0 }] },
    { round: 3, players: [{ playerId: 'a', alive: false, income: 7 }] },
  ];
  assert.deepEqual(pointsOf(history, 'a', 'income'), [{ round: 2, v: 0 }]);
});

test('public round history appends bounded live damage for the current combat round', () => {
  const h = makeMatch({ humans: 1, fake: true }).start().toPrep();
  const m = h.m;
  try {
    recordRound(m);
    const chessId = Object.keys(m.data.chess)[0];
    m.round = 2; m.phase = 'COMBAT';
    m.fields = [{ mode: 'client', players: ['p_0'], progress: { damage: [{ playerId: 'p_0', units: [{ uid: 7, dmg: 123, kills: 2 }] }] },
      spec: { players: [{ playerId: 'p_0', units: [{ uid: 7, chessId }] }] } }];
    const history = roundChartHistory(m, { live: true });
    assert.equal(history.at(-1).round, 2);
    assert.equal(history.at(-1).live, true);
    assert.equal(history.at(-1).players[0].roundDmg, 123);
    assert.equal(history.at(-1).players[0].units[0].kills, 2);
    setLiveRoundDamage(false);
    assert.equal(m.publicView().roundHistory.length, 1, 'live toggle preserves settled history');
    setLiveRoundDamage(true);
    assert.equal(m.publicView().roundHistory.length, 2);
    assert.equal(m.history.length, 1, 'provisional data never enters settled history');
    m.fields[0].progress.damage[0].units[0].dmg = 246;
    assert.equal(roundChartHistory(m, { live: true }).at(-1).players[0].roundDmg, 246);
    m.phase = 'PREP';
    assert.equal(roundChartHistory(m, { live: true }).length, 1, 'a rewind/prep drops the provisional round');
  } finally { m.dispose(); resetHostSettings(); }
});

test('live counters include summon damage in totals and bound protocol operator rows', () => {
  const units = Array.from({ length: LIVE_DAMAGE_UNITS + 1 }, (_, i) => ({ uid: i + 1, kind: 'op', stats: { dmg: 10, kills: 1 } }));
  units.push({ kind: 'token', uid: 999, stats: { dmg: 500, kills: 1 } });
  const damage = battleDamage({ players: [{ playerId: 'p_0', units }], _perPlayer: { p_0: { damageDealt: 1150 } } });
  assert.equal(damage[0].damageDealt, 1150);
  assert.equal(damage[0].units.length, LIVE_DAMAGE_UNITS);
  assert.ok(damage[0].units.every((u) => u.uid !== 999));
  const frame = { t: 'b.progress', battleId: 'test', gt: 1, killed: 0, total: 1, damage };
  assert.equal(validateC2S(frame), null);
  assert.ok(validateC2S({ ...frame, damage: [{ ...damage[0], damageDealt: -1 }] }));
  assert.ok(validateC2S({ ...frame, damage: [{ ...damage[0], units: [...damage[0].units, damage[0].units[0]] }] }));
});

test('headless live history follows field time and unite merges both phases exactly once', () => {
  const h = makeMatch({ humans: 1, fake: true }).start().toPrep(), m = h.m;
  try {
    const chessId = Object.keys(m.data.chess)[0], name = m.gd.chess(chessId).name;
    m.phase = 'COMBAT';
    const sample = (dmg) => [{ playerId: 'p_0', damageDealt: dmg + 20, units: [{ uid: 7, dmg, kills: 1 }] }];
    const field = { cc: true, mode: 'server', players: ['p_0'], startAt: m._clockNow(),
      damageTimeline: [[0, sample(10)], [10, sample(100)]],
      spec: { timeLimit: 60, players: [{ playerId: 'p_0', units: [{ uid: 7, chessId }] }] } };
    m.fields = [field];
    assert.equal(roundChartHistory(m, { live: true }).at(-1).players[0].roundDmg, 30, 'never expose precomputed final damage');
    field.startAt -= 10000 / m.gameSpeed;
    assert.equal(roundChartHistory(m, { live: true }).at(-1).players[0].roundDmg, 120);
    const own = { damageDealt: 120, unitStats: [{ defId: chessId, name, dmg: 100, kills: 1 }] };
    const unite = { perPlayer: { p_0: { damageDealt: 70, unitStats: [{ defId: chessId, name, dmg: 50, kills: 2 }] } } };
    m.lastResults.set('p_0', own); m.phase = 'UNITE';
    m.fields = [{ done: true, result: unite }];
    const live = roundChartHistory(m, { live: true }).at(-1).players[0];
    assert.equal(live.roundDmg, 190);
    assert.equal(live.units[0].dmg, 150);
    assert.equal(live.units[0].kills, 3);
    m.order[0].stats.dmgDealt = 190;
    recordRound(m, { uniteResult: unite });
    assert.deepEqual(roundChartHistory(m).at(-1).players[0].units, live.units);
    assert.equal(roundChartHistory(m, { live: true }).length, 1, 'settlement replaces the live round');
  } finally { m.dispose(); }
});

test('multi-wave Unite keeps prior helpers in live and settled operator rankings', () => {
  const h = makeMatch({ humans: 8, fake: true }).start().toPrep(), m = h.m;
  try {
    const chessId = Object.keys(m.data.chess)[0], name = m.gd.chess(chessId).name;
    const result = (pid, dmg) => ({ perPlayer: { [pid]: { damageDealt: dmg + 20,
      unitStats: [{ defId: chessId, name, dmg, kills: 1 }] } } });
    m.lastResults.set('p_0', { damageDealt: 120, unitStats: [{ defId: chessId, name, dmg: 100, kills: 1 }] });
    m.phase = 'UNITE';
    const prior = result('p_0', 50), current = result('p_4', 80);
    m.unitePlan = { history: [prior, { ...result('p_0', 999), synthetic: true }] };
    m.fields = [{ done: true, result: current }];
    const live = roundChartHistory(m, { live: true }).at(-1);
    assert.equal(live.players[0].roundDmg, 190, 'the first helper does not lose its completed wave');
    assert.equal(live.players[0].units[0].dmg, 150);
    assert.equal(live.players[4].roundDmg, 100, 'the current wave is counted once');
    m.order[0].stats.dmgDealt = 190; m.order[4].stats.dmgDealt = 100;
    recordRound(m, { uniteResults: [prior, current] });
    const settled = roundChartHistory(m).at(-1);
    assert.deepEqual(settled.players.map((p) => p.units), live.players.map((p) => p.units));
  } finally { m.unitePlan = null; m.dispose(); }
});
