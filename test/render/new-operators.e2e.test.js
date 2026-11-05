import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { startServer } from '../../server/index.js';
import { getData } from '../../server/data.js';
import { makeMatch, legalTileFor } from '../match/harness.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { GEO } from '../../shared/constants.js';

const IDS = ['char_4247_oxi', 'char_4246_dminon', 'char_4244_tocka'];
test('three new operators: all 36 slot/skill/form BattleSpecs agree in Node and browser and replay identically',
  { skip: process.env.SIM_E2E !== '1' || !hasChrome(), timeout: 120000 }, async t => {
    const data = getData(), specs = [];
    for (const id of IDS) for (const tier of [5, 6]) for (const elite of [false, true]) for (const skillIndex of [0, 1, 2]) {
      const slot = `chess_char_${tier}_diy1_a`;
      const h = makeMatch({ mode: 'solo', seed: 11, seats: [{ seat: 0, playerId: 'p', name: 'P', connected: true,
        diy: { [slot]: { charId: id, skillIndex, uniEquipId: null } } }] }).start().toPrep(1);
      try {
        const ps = h.ps('p'), piece = ps.acquireChess(elite ? data.backups.diy.slots[slot].goldenId : slot, { source: 'buy' });
        const tile = legalTileFor(h.m, ps, piece.id);
        assert.deepEqual(h.m.handle('p', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true });
        specs.push(buildBattleSpec({ battleId: `${id}-${tier}-${elite}-${skillIndex}`, fieldId: 'test', kind: 'normal', seed: 77,
          modeId: h.m.modeId, round: 1, stageId: h.m.stageId, rect: GEO.NORMAL_RECT, timeLimit: 8, players: [ps.battleInput()],
          spawns: h.m.wave.spawns, routes: h.m.wave.routes, flags: { ...h.m.gd.dp, startOpCooldown: 0 }, content: 'full' }));
      } finally { h.m.dispose(); }
    }
    const run = b => {
      for (let n = 0; n < 240 && !b.finished; n++) {
        if (n === 1) for (const u of b.allyUnits) if (u.skill) { u.skill.sp = u.skill.spCost; u.skill.charges = u.skill.maxCharges; }
        b.step();
      }
      return { result: b.result(), snapshot: b.snapshot(), errors: b.errors };
    };
    const expected = specs.map(s => run(createBattleFromSpec(s, data, { quiet: true })));
    for (const result of expected) assert.deepEqual(result.errors, []);
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
    const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--edge-skip-compat-layer-relaunch'] });
    t.after(async () => { await browser.close(); await srv.close(); });
    const page = await browser.newPage(); await page.goto(srv.url);
    const actual = await page.evaluate(async ({ specs, data }) => {
      const { createBattleFromSpec } = await import('/sim/spec.js');
      const run = spec => {
        const b = createBattleFromSpec(spec, data, { quiet: true });
        for (let n = 0; n < 240 && !b.finished; n++) {
          if (n === 1) for (const u of b.allyUnits) if (u.skill) { u.skill.sp = u.skill.spCost; u.skill.charges = u.skill.maxCharges; }
          b.step();
        }
        return { result: b.result(), snapshot: b.snapshot(), errors: b.errors };
      };
      return specs.map(spec => ({ first: run(spec), replay: run(JSON.parse(JSON.stringify(spec))) }));
    }, { specs, data });
    for (let i = 0; i < specs.length; i++) {
      assert.deepEqual(JSON.parse(JSON.stringify(expected[i])), actual[i].first, specs[i].battleId);
      assert.deepEqual(actual[i].first, actual[i].replay, 'replay ' + specs[i].battleId);
    }
    mkdirSync('.cache/dynamic-illustrations-new-operators', { recursive: true });
    writeFileSync('.cache/dynamic-illustrations-new-operators/sim-browser-digests.json', JSON.stringify(specs.map((s,i) => ({ id: s.battleId,
      sha256: createHash('sha256').update(JSON.stringify(actual[i].first)).digest('hex') })), null, 2));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(srv.url + '/dev/render-demo.html?scene=prep&paused=1&panel=0&board=2d');
    await page.waitForFunction(() => globalThis.__demo?.ready, { timeout: 60000 });
    const models = [];
    for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
      await page.evaluate(({ids,dir}) => {
        const view = window.__demo.view, rect = { r0: 9, r1: 12, c0: 0, c1: 10 };
        const units = ids.map((id,i) => ({ id:i+1, kind:'op', side:'ally', defId:id, name:id, spine:id, avatar:id,
          x:2+i*3,y:11,dir,facing:1,maxHp:5000,tier:6,skillIndex:0 }));
        view.enterBattle({fieldId:'new-operator-models',kind:'normal',rect,stageId:'act2autochess_m01',units});
        view.setCamera('normal',{rect,instant:true});
        view.pushSnapshot({t:'b.snap',fieldId:'new-operator-models',gt:0,units:units.map(u=>[u.id,u.x,u.y,5000,5000,0,20,0,0]),dp:10,killed:0,total:3});
        view.debug.interp.snapToNewest();
      },{ids:IDS,dir});
      await page.waitForFunction(() => {
        const views=[...window.__demo.view.debug.views.values()];return views.length===3&&views.every(v=>v.spineReady&&v.actor?.spine);
      },{timeout:60000});
      const rows = await page.evaluate(() => [...window.__demo.view.debug.views.values()].map(v=>{
        const a=v.actor, played=[];
        a.attack(1,true);a.update(.1);played.push(a.spine.state.tracks[0]?.animation.name);
        for(const i of [0,1,2]) {a.setSkill(false);a.setSkillIndex(i);a.setSkill(true);a.attack(1,true);a.update(.2);played.push(a.spine.state.tracks[0]?.animation.name);}
        return {id:v.info.defId,skel:a.entry.skel,dir:v.dir,played,valid:played.every(n=>Object.hasOwn(a.entry.animations,n))};
      }));
      for (const row of rows) { assert.ok(row.valid,JSON.stringify(row)); assert.equal(/\/back\//.test(row.skel),dir==='UP'); }
      models.push(...rows);
      await page.screenshot({path:`.cache/dynamic-illustrations-new-operators/new-operator-models-${dir}.png`});
    }
    writeFileSync('.cache/dynamic-illustrations-new-operators/new-operator-render-models.json',JSON.stringify(models,null,2));
  });
