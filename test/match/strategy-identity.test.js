import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { makeMatch } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { RANDOM_BAND_ID, ERR } from '../../shared/constants.js';
import { allowedBands, bandRecord } from '../../public/js/screens/bandDraft.js';
import { GameData } from '../../server/match/gamedata.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const regulation = loadData(path.join(root, 'data/versions/act3autochess-v3_1'), { log: { warn() {} } });

test('the strategy list matches server eligibility in every regulation mode, including fast solo', () => {
  for (const [modeId, mode] of Object.entries(regulation.config.modes)) {
    const server = new GameData(regulation, modeId);
    const client = allowedBands(Object.values(regulation.bands), mode.type, modeId).map(band => band.bandId);
    assert.deepEqual(new Set(client), new Set(server.bandIds()), modeId);
  }
  assert.equal(allowedBands(Object.values(regulation.bands), 'SINGLE', 'mode_single_funny').some(b => b.bandId === 'band_random'), false);
  assert.equal(allowedBands(Object.values(regulation.bands), 'SINGLE', 'mode_single_normal').some(b => b.bandId === 'band_random'), true);
});

test('the extension random intent is outside every official strategy namespace', () => {
  for (const dir of ['data', 'data/versions/act1autochess', 'data/versions/act1autochess-v1_1', 'data/versions/act2autochess-v2_1', 'data/versions/act3autochess-v3_1']) {
    const data = loadData(path.join(root, dir), { log: { warn() {} } });
    assert.equal(Object.hasOwn(data.bands, RANDOM_BAND_ID), false, dir);
  }
  const official = bandRecord({ band: id => regulation.bands[id] }, 'band_random');
  assert.equal(official.name, '“追随者们”');
  assert.equal(official.random, undefined);
  assert.match(official.desc, /从2个随机指令中选择1个/);
});

for (const route of ['manual', 'timeout']) test(`followers ${route}: keep the official strategy, its LP and passive; no random bonus`, t => {
  const results = [];
  for (const seed of [1, 2, 137]) {
    const h = makeMatch({ data: regulation, mode: 'coop', humans: 2, fake: true, seed, registry: createRegistry() }).start();
    t.after(() => h.m.dispose());
    const m = h.m;
    m.enterBandDraft();
    const ps = m.players.get(m.draftTurn());
    const funds = ps.funds;
    assert.deepEqual(m.bandFocus(ps, 'band_random'), { ok: true });
    if (route === 'manual') assert.deepEqual(m.pickBand(ps, 'band_random'), { ok: true });
    else { assert.equal(m.timeoutBand(ps.playerId), 'band_random'); h.sched.advance(m.bandTurnMs() + 1); }
    assert.equal(ps.bandId, 'band_random');
    assert.equal(ps.lp, regulation.bands.band_random.totalHp);
    assert.equal(ps.funds, funds);
    h.toPrep(1);
    assert.equal(ps.commandDrafts[0].cards.length, 2);
    results.push(ps.bandId);
  }
  assert.deepEqual(results, ['band_random', 'band_random', 'band_random']);
});

test('followers obey group duplicate rules while the separate random intent still pays one bonus', t => {
  const h = makeMatch({ data: regulation, mode: 'coop', humans: 3, fake: true, seed: 137 }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  m.enterBandDraft();
  assert.deepEqual(m.pickBand(m.players.get(m.draftTurn()), 'band_random'), { ok: true });
  const next = m.players.get(m.draftTurn());
  assert.equal(m.pickBand(next, 'band_random').error, ERR.BAD_TARGET);
  const funds = next.funds;
  assert.deepEqual(m.pickBand(next, RANDOM_BAND_ID), { ok: true });
  assert.notEqual(next.bandId, 'band_random', 'the teammate already holds it');
  assert.notEqual(next.bandId, RANDOM_BAND_ID, 'an intent is never stored as an assigned strategy');
  assert.equal(next.funds, funds + 1);
  assert.equal(next.lp, m.gd.startLp(next.bandId) + 1);
});

test('the legacy random id is accepted only in versions without an official strategy of that name', t => {
  const h = makeMatch({ mode: 'coop', humans: 2, fake: true, seed: 137 }).start();
  t.after(() => h.m.dispose());
  h.m.enterBandDraft();
  const ps = h.m.players.get(h.m.draftTurn());
  assert.equal(h.m.gd.band('band_random'), null);
  const funds = ps.funds;
  assert.deepEqual(h.m.pickBand(ps, 'band_random'), { ok: true });
  assert.notEqual(ps.bandId, 'band_random');
  assert.equal(ps.funds, funds + 1);
});
