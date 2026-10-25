// Local Hub contracts: keep the maintainer-approved create flow and extensions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = file => fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const memory = new Map();
globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,String(v)), removeItem: k => memory.delete(k) };
const { HubEntry, ProtoCard, normalizeCode, codeArg, parseRoomParam, recruitingRooms, rememberRoom, recentRooms } = await import('../../public/js/screens/lobby.js');
function* walk(v) { if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; } if (!v || typeof v !== 'object') return; yield v; yield* walk(v.props?.children); }
const text = v => v == null || typeof v === 'boolean' ? '' : Array.isArray(v) ? v.map(text).join('') : typeof v === 'object' ? text(v.props?.children) : String(v);
const source = read('public/js/screens/lobby.js');
test('local entry receives explicit label/group and invokes the supplied mode action', () => {
  const calls=[];const tree=HubEntry({group:{icon:'user',label:'1 名博士'},name:'独立模拟',en:'SOLO SIMULATION',icon:'user',onClick:()=>calls.push('solo')});
  assert.match(text(tree),/1 名博士.*独立模拟/);const button=[...walk(tree)].find(v=>v.type==='button');assert.match(button.props.class,/hub-entry/);button.props.onClick();assert.deepEqual(calls,['solo']);
});
test('each protocol difficulty preserves selection and calls its exact difficulty', () => {
 for(const difficulty of ['FUNNY','NORMAL','HARD','ABYSS']) {const seen=[];const tree=ProtoCard({roomMode:'solo',difficulty,selected:true,onSelect:d=>seen.push(d)});assert.equal(tree.type,'button');assert.equal(tree.props['aria-pressed'],'true');tree.props.onClick();assert.deepEqual(seen,[difficulty]);assert.ok(text(tree).length>5);}
});
test('keys normalize safely; event arguments never become a room key',()=>{assert.equal(normalizeCode(' ab12 '),'AB12');assert.equal(codeArg({type:'click'},'AB12'),'AB12');assert.equal(parseRoomParam('?room=ab12'),'AB12');assert.equal(parseRoomParam('?room=%3Cbad%3E'),null);});
test('recent keys deduplicate and never auto-join',()=>{rememberRoom('AB12');rememberRoom('CD34');rememberRoom('AB12');assert.deepEqual(recentRooms().slice(0,2),['AB12','CD34']);});
test('recruiting uses the actual expanded capacity and excludes started/full rooms',()=>{const rows=recruitingRooms([{code:'A',humans:7,maxSeats:8},{code:'B',humans:19,maxSeats:20},{code:'C',humans:4,maxSeats:4},{code:'D',humans:2,maxSeats:8,inMatch:true}]);assert.deepEqual(rows.map(r=>r.code),['B','A']);});
test('create alliance opens protocol first; failure returns to key setup',()=>{const body=source.slice(source.indexOf('const openCoopCreate ='),source.indexOf('const closeProtocol ='));assert.match(body,/setSheetPurpose\('create'\)/);assert.match(body,/setAllyOpen\(false\).*setSheetOpen\(true\)/);assert.match(source,/result === false.*closeProtocol\(\)/);assert.match(source,/customCode.*code: customCode/s);});
test('version control and create payload follow current version; unavailable difficulties are filtered',()=>{assert.match(source,/VersionSwitch/);assert.match(source,/version: selectedVersion/);assert.match(source,/offeredDifficulties\(getConfig\(\), roomMode\)/);assert.match(source,/allowedDifficulties\.map/);assert.match(source,/data-testid="solo-unlimited"/);assert.match(source,/soloUnlimited: true/);});
test('local social, records and personal-data recovery remain reachable',()=>{for(const name of ['OnlinePlayersButton','PresenceSelector','openStats','openPersonalData','openRecovery','PersonalDataReminder'])assert.ok(source.includes(name),name);assert.match(source,/AchievementEntry/);assert.match(source,/setSweepOpen\(true\)/);});
test('Hub keeps complete local scenes and full-screen protocol navigation',()=>{const css=read('public/css/screens/lobby.css');assert.match(source,/ProtocolScene/);assert.match(source,/class="proto-list"/);assert.match(source,/aria-label=.*选择模拟协议/);assert.match(css,/\.proto/);assert.match(css,/prefers-reduced-motion/);});
