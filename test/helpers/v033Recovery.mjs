import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');const {startServer}=await import(pathToFileURL(root+'/server/index.js'));const {TestClient}=await import(pathToFileURL(root+'/test/helpers/wsClient.js'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sp-v033-recovery-'));let srv,client;const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 srv=await startServer({port:0,host:'127.0.0.1',quiet:true,assetIndex:false,studio:false,recovery:{dir,identity:'v033-host-test'},versions:{enabled:'all'},matchHost:{matchOptions:{timerScale:0}}});
 client=await TestClient.connect(srv.url.replace('http','ws')+'/ws');const welcome=await client.hello('恢复测试');
 assert.equal((await client.request({t:'room.create',mode:'solo',difficulty:'NORMAL',version:'act1autochess',soloUnlimited:true})).t,'ok');const room=[...srv.lobby.rooms.values()][0],code=room.code;
 await client.request({t:'room.contentReady',cs:room.content.cs});assert.equal((await client.request({t:'room.start'})).t,'ok');
 await client.waitFor('m.public',m=>m.phase==='INFO_CHECK');await client.request({t:'g.infoReady'});await client.waitFor('m.public',m=>m.phase==='BAND_DRAFT');
 const data=srv.lobby.dataFor(room);await client.request({t:'g.band',bandId:Object.keys(data.bands)[0]});await client.waitFor('m.public',m=>m.phase==='PREP');
 for(let i=0;i<100&&!fs.existsSync(path.join(dir,'room-'+code+'.bin'));i++)await wait(100);
 assert.ok(fs.existsSync(path.join(dir,'room-'+code+'.bin')),'historical host wrote recovery');srv.lobby.recovery.prepareShutdown();await client.terminate();await srv.close();srv=null;
 srv=await startServer({port:0,host:'127.0.0.1',quiet:true,assetIndex:false,studio:false,recovery:{dir,identity:'v033-host-test'},versions:{enabled:'all'},matchHost:{matchOptions:{timerScale:0}}});
 client=await TestClient.connect(srv.url.replace('http','ws')+'/ws');await client.hello('恢复测试',welcome.token);const restored=await client.waitFor('m.public',m=>m.phase==='PREP');assert.equal(restored.version,'act1autochess');assert.equal(srv.lobby.rooms.get(code).version,'act1autochess');
 assert.deepEqual(srv.lobby.recovery.status().issues,[]);console.log('PASS historical version host PREP persisted, restarted, restored same player token and version');
}finally{await client?.terminate().catch(()=>{});await srv?.close();fs.rmSync(dir,{recursive:true,force:true});}

