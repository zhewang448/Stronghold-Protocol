import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateReceiver, diffState, applyStatePatch } from '../shared/stateDelta.js';
import { Net } from '../public/js/net.js';
import { startServer } from '../server/index.js';
import { send } from '../server/net.js';
import { negotiateStateDelta } from '../server/stateTransport.js';
import { TestClient } from './helpers/wsClient.js';
import { rewindToPrep } from '../server/match/rewind.js';

test('delta frames equal full JSON through nested changes, deletions and array length changes; writes own their baseline', () => {
  const receiver = new StateReceiver(), frames = [];
  const socket = { readyState: 1, bufferedAmount: 0, send: (text) => frames.push(text) };
  negotiateStateDelta(socket, 1);
  let current = { t: 'm.public', players: [{ id:'a', funds:1, items:['a','b'] }], round:1, padding:'unchanged'.repeat(100) };
  let patches = 0;
  for (let i=0; i<250; i++) {
    current.players[0].funds=i;
    if(i%7===0)current.players[0].items.push(String(i));
    if(i%9===0)delete current.extra;else current.extra={value:i,empty:null};
    assert.equal(send(socket, current), true);
    const frame = JSON.parse(frames.at(-1));
    if (frame.patch) patches++;
    assert.deepEqual(receiver.receive(frame).message, JSON.parse(JSON.stringify(current)));
  }
  assert.ok(patches>200);
  const before = JSON.parse(JSON.stringify(current));
  socket.readyState = 3;
  assert.equal(send(socket, { ...current, round: 2 }), false);
  socket.readyState = 1;
  assert.equal(send(socket, before), true);
  assert.deepEqual(receiver.receive(JSON.parse(frames.at(-1))).message, before);
  const baseline={t:'m.public',nested:{a:1}};
  for(const patch of [[[['__proto__','polluted'],true]],[[['nested','constructor'],{}]],[[['t'],'m.private']]])assert.throws(()=>applyStatePatch(baseline,patch));
  assert.deepEqual(baseline,{t:'m.public',nested:{a:1}});assert.equal({}.polluted,undefined);
  assert.deepEqual(applyStatePatch(before,diffState(before,current)),current);
});

test('the browser coalesces gap recovery and emits only complete reconstructed views', () => {
  const sent=[],events=[],timers=new Map();let id=0;
  const net=new Net({timers:{setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(key){timers.delete(key);},setInterval(){return 0;},clearInterval(){}}});
  net.status='online';net.ws={readyState:1,send:text=>sent.push(JSON.parse(text))};net.on('m.public',m=>events.push(m));
  const deliver=m=>net._onMessage(JSON.stringify(m));
  deliver({t:'m.state',kind:'m.public',seq:2,base:1,patch:[]});
  deliver({t:'m.state',kind:'m.private',seq:3,base:2,patch:[]});
  assert.equal(sent.filter(m=>m.t==='state.resync').length,1);assert.deepEqual(events,[]);
  deliver({t:'m.state',kind:'m.public',seq:1,full:{t:'m.public',round:1}});
  deliver({t:'m.state',kind:'m.private',seq:1,full:{t:'m.private',funds:5}});
  deliver({t:'m.state',kind:'m.public',seq:2,base:1,patch:[[['round'],2]]});
  assert.deepEqual(events.map(m=>m.round),[1,2]);
  deliver({t:'m.state',kind:'m.public',seq:2,base:1,patch:[[['round'],2]]});assert.equal(events.length,2);
  net._teardownSocket();for(const entry of net._pending.values())net._clearEntryTimer(entry);net._pending.clear();
});

test('mixed clients, spectator privacy, resync, reconnect, rewind and result replay use equivalent views', async () => {
  const srv=await startServer({port:0,host:'127.0.0.1',quiet:true});const clients=[];
  const connect=async(delta,token)=>{
    const c=await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);clients.push(c);c.decoded=[];c.receiver=new StateReceiver();
    c.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.t==='m.state'){const next=c.receiver.receive(msg);assert.equal(next.resync,false);if(next.message)c.decoded.push(next.message);}else if(msg.t==='m.public'||msg.t==='m.private')c.decoded.push(msg);});
    c.welcome=await c.hello('Delta',token,delta?{stateDelta:1}:{});return c;
  };
  try {
    const old=await connect(false),modern=await connect(true),spectator=await connect(true);
    await old.request({t:'room.create',mode:'coop',difficulty:'NORMAL'});const room=await old.waitFor('room.state');
    await modern.request({t:'room.join',code:room.code});await spectator.request({t:'room.spectate',code:room.code});
    await modern.request({t:'room.ready',ready:true});await old.request({t:'room.start'});
    await modern.waitFor('m.state',m=>m.kind==='m.private'&&!!m.full);await modern.waitFor('m.state',m=>m.kind==='m.public'&&!!m.full);
    await old.waitFor('m.private');await spectator.waitFor('m.state',m=>m.kind==='m.public');
    assert.ok(!old.log.some(m=>m.t==='m.state'));assert.ok(!spectator.log.some(m=>m.kind==='m.private'||m.t==='m.private'));
    const m=srv.lobby.getRoom(room.code).match,ps=m.players.get(modern.welcome.playerId);
    modern.clearInbox();ps.funds+=7;ps.dirty();m.flush();
    const changed=await modern.waitFor('m.state',f=>f.kind==='m.private');assert.ok(changed.patch);
    assert.deepEqual(modern.decoded.findLast(v=>v.t==='m.private'),JSON.parse(JSON.stringify(ps.privateView())));
    modern.clearInbox();await modern.request({t:'state.resync'});
    await modern.waitFor('m.state',f=>f.kind==='m.public'&&!!f.full);await modern.waitFor('m.state',f=>f.kind==='m.private'&&!!f.full);
    const token=modern.welcome.token;await modern.close();const resumed=await connect(true,token);
    await resumed.waitFor('m.state',f=>f.kind==='m.private'&&!!f.full);
    m.round=1;m.enterPrep();ps.funds+=11;ps.dirty();m.flush();
    assert.equal(rewindToPrep(m,1).ok,true);
    await resumed.waitFor('m.state',f=>f.kind==='m.public');
    const plain=v=>{const{serverNow,...rest}=v;return rest;};
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.deepEqual(plain(resumed.decoded.findLast(v=>v.t==='m.public')),plain(JSON.parse(JSON.stringify(m.publicView()))));
    m.finish({victory:false,reason:'admin'});await resumed.waitFor('m.result');
    await resumed.close();const final=await connect(true,token);await final.waitFor('m.result');
    assert.ok(final.log.some(f=>f.t==='m.state'&&f.kind==='m.public'&&f.full));
    assert.ok(!spectator.log.some(f=>f.kind==='m.private'||f.t==='m.private'));
  } finally {await Promise.all(clients.map(c=>c.terminate()));await srv.close();}
});
