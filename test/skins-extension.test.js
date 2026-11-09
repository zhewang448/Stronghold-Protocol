import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSkinSelection, cleanSkins } from '../shared/skins.js';
import { validateC2S } from '../shared/protocol.js';
import { spineEntry, avatarUrl, hasBackSpine } from '../public/js/assets.js';
import { skinForUnit, setSkins, randomSkins } from '../public/js/ui/skins.js';
import { store } from '../public/js/store.js';
import { exportPayload, parseImport } from '../public/js/ui/loadoutModel.js';
import { buildSkinPlan, skinCatalogue } from '../tools/assets/skins.mjs';
import { resolveTemplate } from '../tools/assets/manifest.mjs';
import { installSkins } from '../tools/install-skins.mjs';
import { makeMatch, DATA } from './match/harness.js';
import { buildBattleSpec } from '../server/sim/spec.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const CHAR = 'char_498_inside', SKIN = `${CHAR}@kitchen#2`;
const choice = { [CHAR]: SKIN };
const research = JSON.parse(readFileSync(new URL('../docs/research/operator-skins.json', import.meta.url), 'utf8'));

test('skin protocol limits, character ownership and catalogue filtering', () => {
  assert.equal(validateC2S({ t: 'room.skins', skins: choice }), null);
  for (const bad of [null, [], Object.create(choice), { [CHAR]: 'https://x/a' }, { [CHAR]: 'char_112_siege@x#1' }, JSON.parse('{"__proto__":"x"}')]) {
    assert.equal(isSkinSelection(bad), false);
    // Plugin skin keys are structural on the wire; installed-catalogue imports still check ownership.
    if (bad?.[CHAR] !== 'char_112_siege@x#1') assert.ok(validateC2S({ t: 'room.skins', skins: bad }));
  }
  const many = Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`char_${i}_x`, `char_${i}_x@x#1`]));
  assert.equal(isSkinSelection(many), false);
  assert.deepEqual(cleanSkins({ ...choice, char_999_unknown: 'char_999_unknown@x#1' }, DATA.skins), choice);
  assert.deepEqual(cleanSkins(choice, { chars: {} }), {});
});

test('selected avatar and model use only installed entries, preserving stable default fallbacks', () => {
  const front = { skel: '/assets/base.skel', atlas: '/assets/base.atlas', anims: { idle: 'Idle' } };
  const back = { skel: '/assets/back.skel', atlas: '/assets/back.atlas', anims: { idle: 'Idle' } };
  const sf = { skel: '/assets/skin.skel', atlas: '/assets/skin.atlas', anims: { idle: 'SkinIdle' } };
  const m = { chars: { [CHAR]: { avatar: '/assets/default.png', spine: { front, back }, skins: { [SKIN]: { avatar: '/assets/skin.png', spine: { front: sf } } } } } };
  assert.equal(avatarUrl(m, `${CHAR}_2`, { skin: SKIN }), '/assets/skin.png');
  const s = spineEntry(m, CHAR, { skin: SKIN });
  assert.equal(s.skel, sf.skel);
  assert.equal(s.fallback, front);
  assert.equal(spineEntry(m, CHAR, { skin: SKIN }), s, 'stable cache/refcount identity');
  assert.equal(spineEntry(m, CHAR, { skin: SKIN, back: true }).skel, sf.skel);
  assert.equal(hasBackSpine(m, CHAR, { skin: SKIN }), false, 'never mix the default back with a skin front');
  assert.equal(spineEntry(m, CHAR, { skin: 'missing' }), front);
  assert.equal(avatarUrl(m, CHAR, { skin: 'missing' }), '/assets/default.png');
});

test('random outfits exclude defaults, absent art and broken models; no alternatives use default', () => {
  const second = `${CHAR}@summer#22`, absent = `${CHAR}@missing#1`, broken = `${CHAR}@broken#1`;
  const soloChar = 'char_112_siege', solo = `${soloChar}@winter#1`;
  const emptyChar = 'char_999_unknown', empty = `${emptyChar}@winter#1`;
  const catalogue = { chars: { [CHAR]: [SKIN, second, absent, broken].map((id) => ({ id })),
    [soloChar]: [{ id: solo }], [emptyChar]: [{ id: empty }] } };
  const installed = { avatar: '/assets/skin.png', spine: { front: { skel: '/assets/skin.skel', atlas: '/assets/skin.atlas', anims: { idle: 'Idle' } } } };
  const manifest = { chars: { [CHAR]: { skins: { [SKIN]: installed, [second]: installed,
    [absent]: { spine: installed.spine }, [broken]: { avatar: installed.avatar } } },
  [soloChar]: { skins: { [solo]: installed } } } };
  assert.deepEqual(randomSkins(catalogue, manifest, () => 0), { [CHAR]: SKIN, [soloChar]: solo });
  assert.deepEqual(randomSkins(catalogue, manifest, () => 0.999), { [CHAR]: second, [soloChar]: solo });
  assert.deepEqual(randomSkins(catalogue, { chars: {} }), {});
  assert.deepEqual(randomSkins(null, manifest), {});
});

test('own, teammate, bot, DIY and stand-in rendering choices are independent', () => {
  setSkins(choice);
  store.patch('match', { public: { players: [{ playerId: 'other', skins: {} }, { playerId: 'owner', skins: choice }] } });
  const u = { avatar: `${CHAR}_2`, side: 'ally', kind: 'op' };
  assert.equal(skinForUnit(u), SKIN);
  assert.equal(skinForUnit({ ...u, ownerId: 'other' }), null);
  assert.equal(skinForUnit({ ...u, ownerId: 'owner' }), SKIN);
  assert.equal(skinForUnit({ ...u, ownerId: 'ai_0' }), null);
  assert.equal(skinForUnit({ ...u, avatar: 'slot', diy: { charId: CHAR } }), SKIN);
  assert.equal(skinForUnit({ ...u, kind: 'token' }), null);
  assert.equal(skinForUnit({ ...u, standInFor: CHAR }), null);
  assert.equal(skinForUnit({ ...u, side: 'enemy' }), null);
  setSkins({}); store.reset();
});

test('portable skin-only presets round-trip; old presets leave the skin field absent', () => {
  const p = exportPayload({}, { skins: choice });
  assert.deepEqual(parseImport(JSON.stringify(p)).skins, choice);
  assert.equal(parseImport(exportPayload({ chess_char_1_01_a: { skill: 0 } })).skins, undefined);
});

test('a mid-match skin change broadcasts preferences without changing battle input/spec', () => {
  const h = makeMatch({ mode: 'solo', seats: [{ seat: 0, playerId: 'p_0', name: 'P', isBot: false, connected: true, skins: choice }] }).start();
  try {
    h.toPrep(1);
    const beforeInput = h.ps('p_0').battleInput();
    const beforeSpec = buildBattleSpec(h.m._normalOpts(h.ps('p_0')));
    assert.deepEqual(h.m.publicView().players[0].skins, choice);
    assert.deepEqual(h.m.setSkins('p_0', {}), { ok: true });
    assert.deepEqual(h.ps('p_0').battleInput(), beforeInput);
    assert.deepEqual(buildBattleSpec(h.m._normalOpts(h.ps('p_0'))), beforeSpec);
    assert.equal(h.m.publicView().players[0].skins, undefined);
    assert.ok(h.m.setSkins('p_0', { [CHAR]: 'https://bad' }).error);
  } finally { h.m.dispose(); }
});

test('skin directory and plans are restricted to the current operators and isolated asset folders', () => {
  const cat = skinCatalogue(research, new Set([CHAR]));
  assert.deepEqual(Object.keys(cat.chars), [CHAR]);
  const plan = buildSkinPlan(research, [SKIN]);
  assert.equal(plan.models.size, 2);
  for (const model of plan.models.values()) {
    assert.ok(model.strict);
    assert.ok(model.dir.startsWith(`spine/op/${CHAR}/char_498_inside_kitchen_2/`));
  }
});

test('the eight issue #20 outfits install portrait and illustration separately from their avatar', () => {
  const ids = ['char_1045_svash2@sale#20', 'char_4098_vvana@epoque#40', 'char_4098_vvana@epoque#59',
    'char_4039_horn@epoque#59', 'char_4162_cathy@kitchen#5', 'char_1040_blaze2@nlc#1', 'char_1033_swire2@nlc#1', 'char_2025_shu@nlc#1'];
  const plan = buildSkinPlan(research, ids);
  for (const id of ids) {
    const skin = plan.template.chars[id.split('@')[0]].skins[id];
    assert.ok(skin.portrait.alts[0].urls[0].includes('/portrait/'));
    assert.ok(skin.illust.alts[0].urls[0].includes('/skin/'));
    assert.notEqual(skin.portrait.alts[0].rel, skin.illust.alts[0].rel);
  }
});

test('single-model outfits use their real upstream folder without requesting absent backs', () => {
  for (const id of ['char_1012_skadi2@boc#4', 'char_1012_skadi2@iteration#2',
    'char_4134_cetsyr@epoque#50', 'char_291_aglina@boc#1', 'char_291_aglina@summer#5']) {
    const plan = buildSkinPlan(research, [id]);
    assert.equal(plan.models.size, 1, id);
    const [model] = plan.models.values();
    assert.ok(model.skel.urls[0].includes(id.startsWith('char_1012_skadi2@') ? '/Spine/' : '/Front/'), id);
    assert.equal(plan.template.chars[id.split('@')[0]].skins[id].spine.back, undefined);
  }
});

test('installed skin posters resolve to distinct local URLs, while missing posters fall back without leaking plan objects', t => {
  const root = mkdtempSync(join(tmpdir(), 'sp-skin-posters-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const second = `${CHAR}@summer#22`;
  const choices = [SKIN, second].map((id, i) => ({ id, portrait: `/assets/seat-portrait/skin-${i}.png` }));
  const seatArt = { chars: { [CHAR]: { choices } } };
  for (const row of choices) {
    const file = join(root, row.portrait.slice('/assets/'.length));
    mkdirSync(join(root, 'seat-portrait'), { recursive: true });
    writeFileSync(file, 'poster');
  }
  const plan = buildSkinPlan(research, [SKIN, second], seatArt);
  const model = { skel: '/assets/model.skel', atlas: '/assets/model.atlas', textures: [] };
  const spine = new Map([...plan.models.keys()].map(key => [key, model]));
  const resolve = () => resolveTemplate(plan.template, { root, spine });
  for (const row of choices) assert.equal(resolve().value.chars[CHAR].skins[row.id].portrait, row.portrait);
  rmSync(join(root, 'seat-portrait/skin-1.png'));
  const missing = resolve();
  assert.equal(missing.value.chars[CHAR].skins[second].portrait, undefined);
  assert.equal(missing.value.chars[CHAR].skins[second].spine.front, model);
  assert.ok(missing.droppedLeaves.some(p => p.endsWith('.portrait')));
});

test('an incomplete offline install leaves the working manifest byte-identical', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sp-skins-'));
  try {
    mkdirSync(join(root, 'docs/research'), { recursive: true }); mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'docs/research/operator-skins.json'), JSON.stringify(research));
    writeFileSync(join(root, 'data/skins.json'), JSON.stringify(DATA.skins));
    const manifest = JSON.stringify({ chars: { [CHAR]: { avatar: '/assets/working.png' } } });
    writeFileSync(join(root, 'data/assets.json'), manifest);
    const r = await installSkins([SKIN], { root, offline: true, log() {} });
    assert.deepEqual(r, { installed: [], failed: [SKIN] });
    assert.equal(readFileSync(join(root, 'data/assets.json'), 'utf8'), manifest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('real WebSocket lifecycle: preferences survive room start, reconnect and reach spectators', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, versions: { default: 'act2autochess' } });
  const clients = [];
  const connect = async () => { const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c); return c; };
  const ok = async (c, msg) => assert.equal((await c.request(msg)).t, 'ok');
  try {
    const c = await connect(), w = await c.hello('Skin');
    await ok(c, { t: 'room.skins', skins: choice });
    await ok(c, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const room = await c.waitFor('room.state');
    await ok(c, { t: 'room.start' });
    assert.deepEqual((await c.waitFor('m.public')).players.find((p) => p.playerId === w.playerId).skins, choice);
    const spec = await connect(); await spec.hello('Watch');
    await ok(spec, { t: 'room.spectate', code: room.code });
    assert.deepEqual((await spec.waitFor('m.public')).players.find((p) => p.playerId === w.playerId).skins, choice);
    await c.close();
    const back = await connect(); await back.hello('Skin', w.token);
    assert.deepEqual((await back.waitFor('m.public')).players.find((p) => p.playerId === w.playerId).skins, choice);
    await ok(back, { t: 'room.skins', skins: {} });
    const pub = await spec.waitFor('m.public', (p) => !p.players.find((x) => x.playerId === w.playerId).skins);
    assert.equal(pub.players.find((p) => p.playerId === w.playerId).skins, undefined);
  } finally { await Promise.all(clients.map((c) => c.terminate())); await srv.close(); }
});
