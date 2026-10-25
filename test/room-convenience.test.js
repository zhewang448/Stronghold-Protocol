import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONVENIENCE_DEFAULTS, roomConvenience, convenienceRules, effectiveRoomRules } from '../shared/roomConvenience.js';
import { validateC2S } from '../shared/protocol.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { wireOptions } from '../server/match/host/proxy.js';
import { getData, getVersionData } from '../server/data.js';
import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { give, giveItem } from './match/harness.js';
import { normalizeRecord, buildRecord } from '../public/js/ui/stats.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
function lobbyHarness() {
  const registry = new SessionRegistry();
  const lobby = new Lobby({registry,log:quiet,getData});
  const player = name => { const p=registry.create(name);p.connected=true;p.ws={readyState:1,bufferedAmount:0,send(){}};return p; };
  return {lobby,player};
}
test('five room choices use exactly the requested defaults and no shop bias',()=>{
  assert.deepEqual(roomConvenience(),{benchEquip:true,soloUnlimited:true,prepLoadout:true,unequip:false,morphPairing:false});
  assert.deepEqual(Object.keys(CONVENIENCE_DEFAULTS),['benchEquip','soloUnlimited','prepLoadout','unequip','morphPairing']);
  for(const key of Object.keys(CONVENIENCE_DEFAULTS)) {
    assert.equal(validateC2S({t:'room.setConvenience',key,on:true}),null);
    assert.notEqual(validateC2S({t:'room.setConvenience',key,on:1}),null);
  }
  assert.notEqual(validateC2S({t:'room.setConvenience',key:'shopBias',on:true}),null);
  assert.equal(convenienceRules().prepLoadout,'prep');
  assert.equal(convenienceRules(null,{prepLoadout:'locked'}).prepLoadout,'locked');
  const room={convenience:roomConvenience()};assert.equal(effectiveRoomRules(room),effectiveRoomRules(room));
});
test('settled record preserves the exact convenience choices through normalization', () => {
  const choices=roomConvenience({unequip:true,morphPairing:true,benchEquip:false});
  const record=buildRecord({players:[{playerId:'p',name:'Host'}],convenience:choices},{myId:'p'});
  assert.deepEqual(record.convenience,choices);
  assert.deepEqual(normalizeRecord(record).convenience,choices);
});
test('host changes synchronize, clear guest readiness, lock during play, and respect plugin declarations',()=>{
  const {lobby,player}=lobbyHarness();const host=player('Host'),guest=player('Guest');
  assert.deepEqual(lobby.create(host,{mode:'coop'}),{ok:true});const room=lobby.roomOf(host);
  assert.deepEqual(lobby.join(guest,{code:room.code}),{ok:true});const seat=room.seatOf(guest.playerId);seat.ready=true;
  assert.equal(lobby.setConvenience(guest,{key:'unequip',on:true}).error,'NOT_HOST');
  assert.deepEqual(lobby.setConvenience(host,{key:'unequip',on:true}),{ok:true});
  assert.equal(room.toState().convenience.unequip,true);assert.equal(seat.ready,false);
  assert.equal(lobby.setConvenience(host,{key:'shopBias',on:true}).error,'BAD_MSG');
  room.match={};assert.equal(lobby.setConvenience(host,{key:'benchEquip',on:false}).error,'ROOM_STARTED');room.match=null;
  room.content={...room.content,rules:{unequip:'official'}};
  assert.equal(lobby.setConvenience(host,{key:'unequip',on:true}).error,'BAD_TARGET');
  assert.deepEqual(wireOptions({convenience:room.convenience}).convenience,room.convenience);
});
for(const version of ['act2autochess','act2autochess@V2_1','act1autochess','act1autochess@V1_1'])test(version+': bench equip, loadout and unequip actually obey room choices',()=>{
  const data=version==='act2autochess'?getData():getVersionData(version);
  const create=choices=>new Match({data,version,roomCode:'TEST',mode:'solo',difficulty:'NORMAL',seats:[{seat:0,playerId:'p_0',name:'Host',isBot:false,connected:true}],sched:new VirtualScheduler(),send(){},broadcast(){},onEnd(){},convenience:roomConvenience(choices),log:quiet,botRehearsal:0});
  for(const enabled of [true,false]) {
    const m=create({benchEquip:enabled,soloUnlimited:enabled,prepLoadout:enabled,unequip:enabled,morphPairing:enabled});m.phase='PREP';m.round=1;
    assert.equal(m.soloUntimed, enabled || !version.startsWith('act1'));
    const ps=m.players.get('p_0');
    const chessId=m.gd.visibleChess.find(id=>!m.gd.chess(id).isGolden);
    const itemId=Object.keys(data.items).find(id=>data.items[id].effectId==='eff_acarm055');
    const unit=give(m,ps,chessId),item=giveItem(m,ps,itemId);
    const equip=ps.equip(item.uid,unit.uid);
    const expected=enabled || !version.startsWith('act1');
    assert.equal(equip.ok===true,expected);
    if(expected)assert.equal(ps.unequip(item.uid).ok===true,enabled);
    assert.equal(m.setLoadout('p_0',{}).ok===true,enabled);
    assert.equal(m.rules.morphPairing,enabled?'plus':'official');
    if(enabled){ps.ready=true;assert.equal(m.setLoadout('p_0',{}).error,'WRONG_PHASE');}
    m.dispose();
  }
});
