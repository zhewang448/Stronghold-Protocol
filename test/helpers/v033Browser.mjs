import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');const require=createRequire(root+'/package.json');const P=require('puppeteer-core');
const {startServer}=await import(pathToFileURL(root+'/server/index.js'));
const srv=await startServer({port:0,host:'127.0.0.1',quiet:true,assetIndex:false,studio:false,versions:{enabled:'all'}});
const browser=await P.launch({executablePath:'C:/Users/34948/.cache/puppeteer/chrome/win64-151.0.7922.71/chrome-win64/chrome.exe',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--mute-audio']});
const errors=[];const pages=[];const clients=[];
async function page(name,w=1440,h=900){
 const {Client}=await import(pathToFileURL(root+'/test/e2e/client.mjs'));
 const c=new Client(P,srv.url,name,{w,h,prefix:'v033-local'}); clients.push(c); await c.open(); try { await c.enter(name); } catch (e) { console.log('PAGE',await c.page.evaluate(()=>({text:document.body.innerText.slice(0,1600),state:globalThis.__SP__?.store.get()}))); console.log('PROBLEMS',c.problems); throw e; } const p=c.page; pages.push(p); p.on('pageerror',e=>errors.push(name+': '+e.message)); return p;
}

try{
 const host=await page('VersionHost');
 await host.waitForSelector('[data-testid="version-switch"]');await host.click('[data-testid="version-switch"]');await host.waitForSelector('[data-version="act1autochess"].verpick__pick');await host.click('[data-version="act1autochess"].verpick__pick');
 await host.waitForFunction(()=>globalThis.__SP_CONTENT__?.state()?.version==='act1autochess'&&globalThis.__SP_CONTENT__.state().status==='ready');
 assert.equal(await host.evaluate(()=>globalThis.__SP__.data.list('bands').length),30);assert.equal(await host.evaluate(()=>globalThis.__SP__.data.list('bonds').length),18);
 await host.screenshot({path:path.join(root,'.cache/v033-historical-hub.png')});
 const made=await host.evaluate(()=>globalThis.__SP__.net.request('room.create',{mode:'coop',difficulty:'HARD',version:'act1autochess',capacity:8}));assert.equal(made.t,'ok');
 await host.waitForFunction(()=>globalThis.__SP__.store.get().room?.seats?.[0]?.content==='ready');const code=await host.evaluate(()=>globalThis.__SP__.store.get().room.code);
 const guest=await page('VersionGuest',844,390);await guest.evaluate(code=>globalThis.__SP__.net.request('room.join',{code}),code);await guest.waitForFunction(()=>globalThis.__SP_CONTENT__?.state()?.version==='act1autochess'&&globalThis.__SP_CONTENT__.state().status==='ready');
 await host.click('[data-testid="room-version"]');await host.waitForSelector('[data-version="act2autochess@V2_1"].verpick__pick');await host.click('[data-version="act2autochess@V2_1"].verpick__pick');await guest.waitForSelector('[data-testid="version-agree"]');await guest.click('[data-testid="version-agree"]');
 for(const p of [host,guest])await p.waitForFunction(()=>globalThis.__SP_CONTENT__?.state()?.version==='act2autochess@V2_1'&&globalThis.__SP_CONTENT__.state().status==='ready');
 await guest.screenshot({path:path.join(root,'.cache/v033-mobile-version-room.png')});
 await guest.click('.rs-exit'); await guest.waitForFunction(()=>!globalThis.__SP__.store.get().room&&globalThis.__SP_CONTENT__?.state()?.kind!=='version');
 assert.deepEqual(errors,[]);console.log('PASS local Hub version switch, historical data, 8-seat room, mobile guest, unanimous vote, leave restores default; page errors 0');
}finally{for(const c of clients) await c.close(); await browser.close();await srv.close();}
