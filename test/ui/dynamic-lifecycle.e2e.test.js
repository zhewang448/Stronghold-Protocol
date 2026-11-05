import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { startServer } from '../../server/index.js';

test('dynamic lifecycle: JSON without bounds, failures, rapid changes, visibility, DPR, offscreen and independent siblings',
  {skip:process.env.SP_E2E!=='1'||!hasChrome(),timeout:90000},async t=>{
    const srv=await startServer({port:0,host:'127.0.0.1',quiet:true,recovery:false});
    const browser=await(await import('puppeteer-core')).default.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--edge-skip-compat-layer-relaunch']});
    t.after(async()=>{await browser.close();await srv.close();});
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(()=>{const get=HTMLCanvasElement.prototype.getContext;window.__dynamicGL=[];HTMLCanvasElement.prototype.getContext=function(type,...args){const ctx=get.call(this,type,...args);if(ctx&&/webgl/.test(type)&&!window.__dynamicGL.includes(ctx))window.__dynamicGL.push(ctx);return ctx;};});
    await page.setViewport({width:1440,height:900,deviceScaleFactor:2});
    const skeleton={skeleton:{spine:'3.8.99'},bones:[{name:'root'}],slots:[{name:'body',bone:'root',attachment:'dot'}],
      skins:[{name:'default',attachments:{body:{dot:{path:'dot',width:32,height:64}}}}],
      animations:{Idle:{bones:{root:{translate:[{time:0,x:0},{time:1,x:4}]}}}}};
    const atlas='page.png\nsize: 1,1\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\ndot\n  rotate: false\n  xy: 0,0\n  size: 1,1\n  orig: 1,1\n  offset: 0,0\n  index: -1\n';
    const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle='#ff0000';x.fillRect(0,0,1,1);return c.toDataURL().split(',')[1];}),'base64');
    await page.setRequestInterception(true);
    page.on('request',req=>{
      const u=new URL(req.url());
      if(!u.pathname.startsWith('/assets/dynamic-fixture/')) return void req.continue();
      if(u.pathname.endsWith('/missing.json'))return void req.respond({status:404,body:'missing'});
      const json=u.pathname.endsWith('.json'),image=u.pathname.endsWith('.png');
      void req.respond({status:200,contentType:json?'application/json':image?'image/png':'text/plain',body:json?JSON.stringify(skeleton):image?png:atlas});
    });
    await page.goto(srv.url);
    await page.evaluate(async()=>{
      const [{h,render},{CoverIllustration},{settingsStore}]=await Promise.all([import('/vendor/preact.module.js'),import('/js/ui/dynamicIllustration.js'),import('/js/ui/settingsStore.js')]);
      settingsStore.set({dynamicIllustrations:'auto',fpsLimit:30});
      const el=document.createElement('div');el.id='lifecycle';Object.assign(el.style,{position:'fixed',inset:'0',zIndex:99999,background:'#141816'});document.body.appendChild(el);
      const base={skel:'/assets/dynamic-fixture/actor.json',atlas:'/assets/dynamic-fixture/actor.atlas',textures:['/assets/dynamic-fixture/page.png'],anims:{idle:'Idle'},pma:false};
      window.fixtureEntry=base;
      window.draw=(entries=[base])=>render(h('div',{id:'siblings',style:{position:'relative',display:'flex'}},entries.flatMap((entry,i)=>[
        h('img',{key:'image'+i,src:'/assets/dynamic-fixture/page.png',style:{width:'100px',height:'160px',objectFit:'cover'}}),
        h(CoverIllustration,{key:'dynamic'+i,entry,framing:{rect:{x:-16,y:-32,width:32,height:64},autoPosition:true}})])),el);
      window.clear=()=>render(null,el);window.draw();
    });
    await page.waitForFunction(()=>['ready','fallback'].includes(document.querySelector('.dyn-cover')?.dataset.state));
    assert.equal(await page.$eval('.dyn-cover',e=>e.dataset.state),'ready',JSON.stringify(await page.evaluate(async()=>(await import('/js/ui/dynamicStage.js')).dynamicStage.stats)));
    assert.equal(await page.$eval('.dyn-cover canvas',c=>c.width),150,'DPR capped at 1.5 and the canvas matches its individual image box');
    await page.evaluate(async()=>{const canvas=(await import('/js/ui/dynamicStage.js')).dynamicStage.canvas;const gl=window.__dynamicGL.find(gl=>gl.canvas===canvas&&!gl.isContextLost());if(!gl)throw new Error('Shared renderer context not found');window.__lostDynamicGL=gl;window.__lostEvents=0;canvas.addEventListener('webglcontextlost',()=>window.__lostEvents++);const ext=gl.getExtension('WEBGL_lose_context');window.__restoreDynamic=ext.restoreContext.bind(ext);ext.restoreContext=()=>{};window.__lostDynamic=ext;ext.loseContext();});
    await new Promise(r=>setTimeout(r,300));
    const loss=await page.evaluate(async()=>({state:document.querySelector('.dyn-cover')?.dataset.state,lost:window.__lostDynamicGL.isContextLost(),events:window.__lostEvents,stats:(await import('/js/ui/dynamicStage.js')).dynamicStage.stats}));
    assert.equal(loss.state,'fallback',JSON.stringify(loss));
    await new Promise(r=>setTimeout(r,100));
    await page.evaluate(()=>window.__restoreDynamic());
    await page.waitForFunction(()=>document.querySelector('.dyn-cover')?.dataset.state==='ready');
    await page.evaluate(()=>window.draw([{...window.fixtureEntry,skel:'/assets/dynamic-fixture/missing.json'}]));
    await page.waitForFunction(()=>document.querySelector('.dyn-cover')?.dataset.state==='fallback');
    assert.equal(await page.$eval('#siblings>img',e=>getComputedStyle(e).visibility),'visible');
    await page.evaluate(async()=>{for(let n=0;n<10;n++){window.draw([{...window.fixtureEntry,identity:String(n)}]);await new Promise(r=>requestAnimationFrame(r));}window.draw();});
    await page.waitForFunction(()=>document.querySelector('.dyn-cover')?.dataset.state==='ready');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await page.evaluate(async()=> (await import('/js/ui/dynamicStage.js')).dynamicStage.stats.scheduled),false);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(async()=> (await import('/js/ui/dynamicStage.js')).dynamicStage.stats.scheduled);
    await page.evaluate(()=>{document.querySelector('#lifecycle').style.transform='translateY(2000px)';});
    await page.waitForFunction(async()=> (await import('/js/ui/dynamicStage.js')).dynamicStage.stats.views===0);
    await page.evaluate(()=>{document.querySelector('#lifecycle').style.transform='';window.draw([window.fixtureEntry,{...window.fixtureEntry,skel:'/assets/dynamic-fixture/missing.json'}]);});
    await page.waitForFunction(()=>[...document.querySelectorAll('.dyn-cover')].map(e=>e.dataset.state).join(',')==='ready,fallback');
    const visibility=await page.$$eval('#siblings>img',es=>es.map(e=>getComputedStyle(e).visibility));
    assert.deepEqual(visibility,['hidden','visible'],'one live view cannot hide its failed sibling fallback');
    await page.evaluate(()=>window.clear());
    await page.waitForFunction(async()=> (await import('/js/ui/dynamicStage.js')).dynamicStage.stats.views===0);
    assert.equal(await page.evaluate(async()=>(await import('/js/assets.js')).assets.spine.stats().refs),0);
    assert.deepEqual(errors,[]);
  });
