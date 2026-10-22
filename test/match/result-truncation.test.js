// Production compaction/validation and takeover with scripted battle outcomes. Runtime Unite children stay free;
// original escaped enemies, including high-seat sources, must survive every wire bound before settlement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactResult, fitResult, RESULT_FRAME_BUDGET } from '../../server/sim/spec.js';
import { validateClientResult, specBounds } from '../../server/match/fields.js';
import { planUnite, uniteSurvivors } from '../../server/match/unite.js';
import { validateC2S } from '../../shared/protocol.js';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';
import { FakeBattle } from './fakeBattle.js';

const row = (props = {}) => ({ killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0,
  damageDealt: 0, bossDamage: 0, healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [], ...props });
const result = (perPlayer, props = {}) => ({ reason: 'timeout', time: 8, killed: 0, total: 0, errors: 0, perPlayer, ...props });
const leak = (enemyKey, sourcePlayerId, props = {}) => ({ enemyKey, sourcePlayerId, counted: true, lpr: 1, ...props });

test('exactly 400 leaks stay complete; 401 leaks or unspawned entries require server re-simulation', () => {
  for (const count of [400, 401]) for (const kind of ['leaked', 'unspawned']) {
    const entries = Array.from({ length: count }, () => leak('enemy_1007_slime', 'p_0'));
    const raw = result({ p_0: row({ total: count, perfect: false, leaked: kind === 'leaked' ? entries : [] }) },
      kind === 'unspawned' ? { unspawned: entries } : {});
    const compact = compactResult(raw);
    assert.equal(compact.truncated, count > 400 ? true : undefined);
    assert.equal((kind === 'leaked' ? compact.perPlayer.p_0.leaked : compact.unspawned).length, 400);
    const wire = fitResult(compact);
    assert.equal(validateC2S({ t: 'b.result', battleId: 'boundary', result: wire }), null);
    if (count > 400) {
      assert.deepEqual(validateClientResult({ kind: 'unite' }, wire), { ok: false, reason: 'truncated result' });
      assert.equal(compactResult(wire).truncated, true, 'recompaction cannot clear the incomplete marker');
    }
    assert.equal(entries.length, count, 'the raw result is not mutated');
  }
  assert.notEqual(validateC2S({ t: 'b.result', battleId: 'boundary',
    result: { ...compactResult(result({ p_0: row() })), truncated: 'true' } }), null);
});

test('a non-boss result still above the frame budget sends a small takeover report', () => {
  const longLeak = leak('e'.repeat(64), 'p'.repeat(64), { tag: 'x'.repeat(16), spawned: true });
  const raw = result({ p_0: row({ total: 400, perfect: false, leaked: Array(400).fill(longLeak) }) });
  const compact = compactResult(raw);
  assert.equal(compact.truncated, undefined, 'the list itself fits');
  const frame = r => ({ t: 'b.result', battleId: 'budget', rid: 1, result: r });
  assert.ok(Buffer.byteLength(JSON.stringify(frame(compact))) > RESULT_FRAME_BUDGET);
  const wire = fitResult(compact, { battleId: 'budget' });
  assert.equal(wire.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(frame(wire))) < RESULT_FRAME_BUDGET);
  assert.equal(validateC2S(frame(wire)), null);
  assert.equal(validateClientResult({ kind: 'unite' }, wire).reason, 'truncated result');
  assert.equal(compact.perPlayer.p_0.leaked.length, 400);
});

for (const humans of [4, 20]) for (const runtimeOnly of [false, true]) {
  test(`${humans} seats: overflow takeover retains original leaks${runtimeOnly ? ' and never bills runtime children' : ' after 500 leak rows'}`, () => {
    const h = makeMatch({ humans, fake: true, clientCombat: true, clients: false, verify: 'off' }).start().toPrep(1);
    const m = h.m;
    try {
      m.setDeadline(0);
      for (const ps of m.order) { ps.lp = 100; ps.bandId = null; }
      const parent = 'enemy_1195_sfyin', child = 'enemy_1196_msfyin';
      const plain = Object.keys(m.gd.raw.enemies).find(k => !m.gd.enemy(k).notCountInTotal
        && specBounds({ spawns: [{ enemyKey: k, count: 1 }] }, m.gd).derived.size === 0);
      const parents = runtimeOnly ? 201 : 100;
      const original = Array.from({ length: parents }, () => leak(parent, 'p_2'));
      const survivors = [];
      for (let i = 2; i < humans; i++) {
        const count = runtimeOnly ? (i === 2 ? 0 : i === humans - 1 ? 10 : 1)
          : humans === 4 ? (i === 2 ? 200 : 100) : i === 2 ? 0 : i === humans - 1 ? 28 : 17;
        survivors.push(...Array.from({ length: count }, () => leak(plain, `p_${i}`)));
      }
      original.push(...survivors);
      m.lastResults = new Map(m.order.map(ps => {
        const leaked = original.filter(l => l.sourcePlayerId === ps.playerId);
        return [ps.playerId, row({ leaked, total: leaked.length, perfect: !leaked.length })];
      }));
      const plan = planUnite(m, m.lastResults);
      assert.ok(plan);
      plan.reserveHelpers = []; plan.roundsMax = 1;
      const leaked = [
        ...Array.from({ length: parents * 2 }, () => leak(child, 'p_2', { uniteRuntime: true })), ...survivors,
      ];
      const full = result({ p_0: row({ total: original.length, killed: parents, perfect: false, leaked }), p_1: row() },
        { total: original.length, killed: parents });
      assert.ok(original.length <= 400 && leaked.length > 400, 'runtime growth bypasses the initial-size guard');
      // Only the server reconstruction is scripted; production compaction, validation, takeover and settlement run.
      m.BattleClass = class extends FakeBattle { result() { return structuredClone(full); } };
      m.startUnite(plan);
      const field = m.fields[0], auth = field.authority;
      assert.equal(field.mode, 'client');
      assert.ok(validateClientResult(field.spec, full, { gd: m.gd }).ok, 'the full scripted outcome is plausible');
      const compact = compactResult(full);
      assert.equal(compact.truncated, true);
      const wire = fitResult(compact, { battleId: field.battleId });
      const message = { t: 'b.result', battleId: field.battleId, result: wire };
      assert.equal(validateC2S(message), null, 'the report reaches semantic validation through the socket schema');
      assert.deepEqual(m.handle(auth, message), { ok: true });
      assert.equal(field.mode, 'server');
      assert.equal(field.resultSource, 'server');
      assert.equal(field.result.perPlayer.p_0.leaked.length, leaked.length, 'server result is never compacted');
      assert.equal(h.lastTo(auth, 'b.end').reason, 'takeover');
      const expected = uniteSurvivors(plan, full);
      h.runToPhase(PHASE.SETTLE);
      for (const ps of m.order) assert.equal(100 - ps.lp, Math.min(m.gd.lpCapPerRound, expected.get(ps.playerId) || 0));
      assert.equal(100 - h.ps(`p_${humans - 1}`).lp, 10, 'the last source no longer disappears behind runtime children');
      if (runtimeOnly) assert.equal(h.ps('p_2').lp, 100, 'only runtime children remain for this source: no LP charge');
      assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
    } finally { m.dispose(); }
  });
}
