import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRealServer, hasChrome, CHROME, sleep } from '../e2e/client.mjs';

test('deployment snapping: live renderer, mouse/touch following, host policy and saved preference', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 180000,
}, async t => {
  const srv=await startRealServer({env:{SP_ASSET_INDEX:'0',SP_VERSIONS:'act2autochess'}});
  const P=(await import('puppeteer-core')).default;
  const browser=await P.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--no-proxy-server']});
  t.after(async()=>{await browser.close();await srv.stop();});
  const output=path.resolve('.cache/deploy-snap/screenshots');fs.mkdirSync(output,{recursive:true});
  const results=[];
  for(const pointerType of ['mouse','touch']){
    const context=await browser.createBrowserContext(),page=await context.newPage();
    try{
      await page.setViewport({width:pointerType==='mouse'?1440:844,height:pointerType==='mouse'?900:390,hasTouch:pointerType==='touch'});
      await page.goto(`${srv.base}/dev/game-mock.html?shot=1&render=engine&phase=PREP`,{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>globalThis.__SP_VIEW__?.raw?.stats?.().mode==='prep',{timeout:60000});
      await page.evaluate(async()=>{await globalThis.__SP_VIEW__.raw.setBoardMode('2d');});await sleep(500);
      await page.click('[data-testid="settings-btn"]');
      const toggle='[role="switch"][aria-label="部署时按格子吸附"]';
      await page.waitForSelector(toggle);assert.equal(await page.$eval(toggle,e=>e.getAttribute('aria-checked')),'true');
      await page.click(toggle);await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sp.pref.settings')).deploySnap===false);
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>globalThis.__SP_VIEW__?.raw?.stats?.().mode==='prep',{timeout:60000});
      assert.equal(await page.evaluate(async()=>(await import('/js/ui/settings.js')).settingsStore.get().deploySnap),false);
      await page.evaluate(async()=>{await globalThis.__SP_VIEW__.raw.setBoardMode('2d');(await import('/js/ui/settings.js')).updateSettings({deploySnap:true});});await sleep(500);
      const prep=await page.evaluate(()=>{
        const raw=globalThis.__SP_VIEW__.raw;
        for(const piece of globalThis.__MOCK__.S().priv.board.filter(p=>p.kind==='chess'&&!p.golden)){
          const box=globalThis.__SP_VIEW__.pieceScreenRect(piece.uid),tile=raw.tileScreen(piece.row,piece.col);
          if(!box||!tile)continue;
          const points=[{x:tile.x,y:tile.y},...[.55,.7,.85,.95].map(y=>({x:box.left+box.width/2,y:box.top+box.height*y}))];
          const from=points.find(p=>raw.pieceAtClientPoint(p.x,p.y)===piece.uid);
          if(from&&[-.14,.14].every(n=>document.elementFromPoint(tile.x+n*tile.s,tile.y)?.tagName==='CANVAS'))return{uid:piece.uid,row:piece.row,col:piece.col,from,tile};
        }
        return null;
      });
      assert.ok(prep,'a visible operator and unobstructed target tile are available');
      const point=(offset)=>({x:prep.tile.x+offset*prep.tile.s,y:prep.tile.y});
      const a=point(-.14),b=point(.14);
      const move=async p=>{if(pointerType==='touch')await page.touchscreen.touchMove(p.x,p.y);else await page.mouse.move(p.x,p.y,{steps:4});await sleep(70);};
      if(pointerType==='touch')await page.touchscreen.touchStart(prep.from.x,prep.from.y);else{await page.mouse.move(prep.from.x,prep.from.y);await page.mouse.down();}
      await move({x:prep.from.x+24,y:prep.from.y});
      await move(a);await page.waitForFunction(()=>globalThis.__SP_VIEW__.raw.debug.drag.dragging,{timeout:5000});
      const position=()=>page.evaluate(uid=>{const d=globalThis.__SP_VIEW__.raw.debug,v=d.views.get('p:'+uid);return{x:v.x,y:v.y,z:v.z,target:d.tiles.highlights.get('dragTarget')?.tiles?.[0]};},prep.uid);
      const snapA=await position();await move(b);const snapB=await position();
      assert.ok(Math.hypot(snapB.x-snapA.x,snapB.y-snapA.y)<1e-6,'snapped model stays fixed inside one tile');
      await page.screenshot({path:path.join(output,pointerType+'-on.png')});
      await page.evaluate(async()=>(await import('/js/ui/settings.js')).updateSettings({deploySnap:false}));
      const immediate=await position();
      assert.ok(Math.hypot(immediate.x-snapB.x,immediate.y-snapB.y)>.02,'stationary drag updates immediately');
      await move(a);const freeA=await position();await move(b);const freeB=await position();
      assert.ok(Math.hypot(freeB.x-freeA.x,freeB.y-freeA.y)>.1,'free model follows the pointer inside the same tile');
      assert.deepEqual(freeA.target,snapA.target);assert.deepEqual(freeB.target,snapB.target);
      await page.screenshot({path:path.join(output,pointerType+'-off.png')});
      await page.evaluate(async()=>(await import('/js/clientPreferences.js')).setClientPreferencePolicy({defaults:{'settings.deploySnap':true},userControls:{'settings.deploySnap':false}}));
      assert.ok(Math.hypot((await position()).x-snapB.x,(await position()).y-snapB.y)<1e-6);
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sp.pref.settings')).deploySnap),false);
      await page.evaluate(async()=>(await import('/js/clientPreferences.js')).setClientPreferencePolicy(null));
      assert.ok(Math.hypot((await position()).x-snapB.x,(await position()).y-snapB.y)>.02);
      if(pointerType==='touch')await page.touchscreen.touchEnd();else await page.mouse.up();
      await sleep(200);
      assert.equal(await page.evaluate(()=>globalThis.__SP_VIEW__.raw.debug.drag.dragging),false);
      const final=await page.evaluate(uid=>globalThis.__MOCK__.S().priv.board.find(p=>p.uid===uid),prep.uid);
      assert.deepEqual([final.row,final.col],[prep.row,prep.col],'drop uses the pointer tile in both visual modes');
      if(await page.$('.fwheel'))await page.keyboard.press('Escape');
      results.push({pointerType,snapA,snapB,freeA,freeB,finalTile:[final.row,final.col]});
    }finally{await context.close();}
  }
  fs.writeFileSync(path.join(output,'measurements.json'),JSON.stringify(results,null,2));
});
