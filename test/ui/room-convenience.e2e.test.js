import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

const enabled=process.env.SP_E2E==='1' && hasChrome();
test('room convenience: five defaults, host/guest sync, all versions and actual prep actions', {skip:!enabled,timeout:180000},async()=>{
  const prior=process.env.SP_TEST_MODE;process.env.SP_TEST_MODE='1';
  const srv=await startServer({port:0,host:'127.0.0.1',quiet:true,recovery:false,assetIndex:false,studio:false,versions:{enabled:'all'},matchHost:{matchOptions:{botRehearsal:0}}});
  const browser=await (await import('puppeteer-core')).default.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--mute-audio']});
  const errors=[];mkdirSync('.cache/room-checkbox-20261025',{recursive:true});
  const newPage=async name=>{const context=await browser.createBrowserContext();const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1280,height:720});await page.setRequestInterception(true);page.on('request',r=>r.resourceType()==='media'?r.abort():r.continue());await page.evaluateOnNewDocument(name=>{localStorage.setItem('sp.name',name);sessionStorage.setItem('sp.entered','1');},name);await page.goto(srv.url+'?render=fallback',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>globalThis.__SP__?.store.get().connection.status==='online');return{page,context};};
  const req=(page,t,body={})=>page.evaluate(async(t,body)=>{try{return await (await import('/js/net.js')).net.request(t,body);}catch(e){return{error:e.code,message:e.message};}},t,body);
  const phase=(page,value)=>page.waitForFunction(value=>globalThis.__SP__.store.get().match?.public?.phase===value,{},value);
  try{
    const {page:host,context:hc}=await newPage('Host');const {page:guest,context:gc}=await newPage('Guest');
    assert.ok(!(await req(host,'room.create',{mode:'coop',difficulty:'NORMAL'})).error);
    const code=await host.evaluate(()=>globalThis.__SP__.store.get().room.code);assert.ok(!(await req(guest,'room.join',{code})).error);
    await host.waitForSelector('.rs-pill__gear');await guest.waitForSelector('.rs-pill__gear');await host.click('.rs-pill__gear');await guest.click('.rs-pill__gear');
    assert.deepEqual(await host.$$eval('.rs-convenience input',es=>es.map(e=>e.checked)),[true,true,true,false,false]);
    assert.ok(await guest.$$eval('.rs-convenience input',es=>es.every(e=>e.disabled)));
    await host.click('[name="convenience-unequip"]');await guest.waitForFunction(()=>document.querySelector('[name="convenience-unequip"]').checked);
    for(const [width,height]of [[1280,720],[844,390],[640,360]]){await host.setViewport({width,height});await new Promise(r=>setTimeout(r,250));const r=await host.$eval('.rs-opts',e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight};});assert.ok(r.left>=-1&&r.right<=r.w+1&&r.top>=-1&&r.bottom<=r.h+1,JSON.stringify(r));await host.screenshot({path:'.cache/room-checkbox-20261025/CONVENIENCE-'+width+'x'+height+'.png'});}
    await hc.close();await gc.close();
    for(const version of ['act2autochess','act2autochess@V2_1','act1autochess','act1autochess@V1_1']){
      const {page,context}=await newPage(version);
      assert.ok(!(await req(page,'room.create',{mode:'solo',difficulty:'NORMAL',test:true,version})).error);
      await page.waitForFunction(version=>(globalThis.__SP__.data.get('config')?.version?.id||'act2autochess')===version&&(!version.startsWith('act1')&&version==='act2autochess'||globalThis.__SP_CONTENT__?.state()?.status==='ready'),{},version);
      await page.waitForSelector('.rs-pill__gear');await page.click('.rs-pill__gear');
      assert.deepEqual(await page.$$eval('.rs-convenience input',es=>es.map(e=>e.checked)),[true,true,true,false,false]);
      for(const key of ['benchEquip','soloUnlimited','prepLoadout','unequip','morphPairing']){
        const selector='[name="convenience-'+key+'"]';await page.$eval(selector,e=>e.scrollIntoView({block:'center'}));await page.click(selector);
        const want=!['benchEquip','soloUnlimited','prepLoadout'].includes(key);await page.waitForFunction((key,want)=>globalThis.__SP__.store.get().room.convenience[key]===want,{},key,want);
        if(!want){await page.waitForFunction(selector=>!document.querySelector(selector).disabled,{},selector);await page.click(selector);await page.waitForFunction(key=>globalThis.__SP__.store.get().room.convenience[key]===true,{},key);}
      }
      await page.keyboard.press('Escape');await req(page,'room.start');await phase(page,'INFO_CHECK');await req(page,'g.infoReady');await phase(page,'BAND_DRAFT');assert.ok(!(await req(page,'g.band',{bandId:'band_bldsk'})).error);await phase(page,'PREP');
      assert.deepEqual(await page.evaluate(()=>globalThis.__SP__.store.get().match.public.convenience),{benchEquip:true,soloUnlimited:true,prepLoadout:true,unequip:true,morphPairing:true});
      assert.equal(await page.evaluate(()=>globalThis.__SP__.store.get().match.public.deadline),0);
      assert.equal((await req(page,'room.setConvenience',{key:'unequip',on:false})).error,'ROOM_STARTED');
      const ids=await page.evaluate(()=>{const d=globalThis.__SP__.data;return{chess:Object.keys(d.get('chess')).find(id=>d.get('chess')[id].visible&&!d.get('chess')[id].isGolden),item:Object.keys(d.get('items')).find(id=>d.get('items')[id].effectId==='eff_acarm055')};});
      assert.ok(!(await req(page,'g.test',{cmd:'chess',args:{id:ids.chess}})).error);assert.ok(!(await req(page,'g.test',{cmd:'item',args:{id:ids.item}})).error);
      const pieces=await page.evaluate(()=>{const hand=globalThis.__SP__.store.get().match.private.hand;return{target:hand.find(p=>p?.kind==='chess').uid,item:hand.find(p=>p?.kind==='item').uid};});
      assert.ok(!(await req(page,'g.equip',{itemUid:pieces.item,targetUid:pieces.target})).error,'bench equip in '+version);
      assert.ok(!(await req(page,'g.unequip',{itemUid:pieces.item})).error,'unequip in '+version);
      assert.ok(!(await req(page,'room.loadout',{entries:{}})).error,'prep loadout in '+version);
      await context.close();
    }
    assert.deepEqual(errors,[]);
  } finally{await browser.close();srv.server.closeAllConnections();await srv.close();if(prior===undefined)delete process.env.SP_TEST_MODE;else process.env.SP_TEST_MODE=prior;}
});
