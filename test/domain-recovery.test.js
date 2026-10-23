import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizePersonalDataConfig, readPersonalDataConfig, writePersonalDataConfig } from '../server/http/personalDataConfig.js';
import { storedPersonalSummary, markGameEntry, domainConfig, migrationRequest, LAST_ENTRY_KEY } from '../public/js/ui/domainRecoveryModel.js';
import { capturePersonalData, restorePersonalData } from '../public/js/ui/personalData.js';
import { startServer } from '../server/index.js';
import { startAdmin } from '../server/admin.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { beginDirectMigration, receiveDirectMigration, directTransferRequest, validDirectMessage, TRANSFER_HASH } from '../public/js/ui/domainTransfer.js';
import { setImmediate } from 'node:timers/promises';
import { createDomainDiscovery, openDiscoveryWindow, trustedDiscovery, validDiscoverySummary } from '../public/js/ui/domainDiscovery.js';
function storage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,String(v)), removeItem: k => map.delete(k), map };
}
const config = { canonicalOrigin: 'https://new.example.test', sources: [
  { origin: 'http://old.example.test:8080', label: '旧站一', mode: 'smart', enabled: true },
  { origin: 'https://older.example.test', label: '旧站二', mode: 'notice', enabled: false },
] };
test('multiple origins validate, preserve scheme and port, persist atomically and reject ambiguous destinations', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-domain-config-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'local', 'personal-data.json');
  assert.deepEqual(writePersonalDataConfig(config, file), config); assert.deepEqual(readPersonalDataConfig(file), config);
  for (const invalid of [
    { ...config, canonicalOrigin: 'https://user:pass@new.example.test' }, { ...config, canonicalOrigin: 'https://new.example.test/path' },
    { ...config, sources: [...config.sources, config.sources[0]] }, { ...config, canonicalOrigin: config.sources[0].origin },
    { ...config, sources: Array(13).fill(config.sources[0]) }, { ...config, sources: [{ ...config.sources[0], mode: 'evil' }] },
    { ...config, sources: [{ ...config.sources[0], enabled: 'false' }] }, { ...config, sources: [{ ...config.sources[0], label: '\n' }] },
    { ...config, canonicalOrigin: '' },
  ]) { assert.throws(() => writePersonalDataConfig(invalid, file)); assert.deepEqual(readPersonalDataConfig(file), config); }
  assert.deepEqual(normalizePersonalDataConfig({ ...config, secret: 'hidden' }), config);
  assert.deepEqual(domainConfig(config).sources.map(r => r.origin), [config.sources[0].origin]);
  assert.equal(domainConfig({ migrationSource: 'http://old.example.test:8080/' }).sources[0].origin, config.sources[0].origin);
});
test('summary never changes entry time, distinguishes denied storage, and old saves report unknown time', () => {
  const ls = storage({ 'sp.name': 'Doctor', 'sp.pref.localAccount': '{"tag":"4321"}', 'sp.pref.stats': '{"records":[{"t":1000},{"t":2000}]}' });
  assert.equal(storedPersonalSummary(ls).lastEnteredAt, null);
  assert.equal(storedPersonalSummary(ls).recentMatchAt, 2000);
  markGameEntry(ls, 12345); const before = JSON.stringify([...ls.map]);
  assert.equal(storedPersonalSummary(ls).lastEnteredAt, 12345);
  assert.equal(JSON.stringify([...ls.map]), before);
  assert.equal(storedPersonalSummary(storage({ [LAST_ENTRY_KEY]: '12345' })).hasData, false);
  assert.throws(() => storedPersonalSummary({ getItem() { throw new Error('denied'); } }));
  const hash = '#sp-recover-source=' + encodeURIComponent(JSON.stringify({ origin: config.canonicalOrigin, nonce: 'a'.repeat(32) }));
  assert.equal(migrationRequest(hash).origin, config.canonicalOrigin); assert.equal(migrationRequest(hash + 'broken'), null);
});
test('exact undo restores original personal keys and media, removes imported additions and keeps sessions', async () => {
  const ls = storage({ 'sp.name': 'Before', 'sp.token': 'keep', 'sp.pref.settings': '{"music":0}' });
  let backdrop = new Blob(['old'], { type: 'image/png' }), music = null;
  const io = { storage: ls, readMedia: async () => backdrop, writeMedia: async v => { backdrop = v; }, readTrack: async () => music, writeTrack: async v => { music = v; } };
  const backup = await capturePersonalData(ls, io.readMedia, io.readTrack);
  const incoming = { ...backup, entries: { 'sp.name': 'Imported', 'sp.pref.skins': '{}' }, backdrop: null };
  await restorePersonalData(incoming, io); assert.equal(ls.getItem('sp.name'), 'Imported');
  await restorePersonalData(backup, { ...io, replace: true });
  assert.equal(ls.getItem('sp.name'), 'Before'); assert.equal(ls.getItem('sp.pref.skins'), null);
  assert.equal(ls.getItem('sp.token'), 'keep'); assert.equal(await backdrop.text(), 'old'); assert.equal(music, null);
});
test('console domain API requires auth, isolates config, rereads saves, and public endpoint cannot mutate', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-domain-admin-')); let server, admin;
  t.after(async () => { await admin?.close(); await server?.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch, recovery: false });
  admin = await startAdmin({ lobby: server.lobby, network: server.network, port: 0, root: dir, resultsDir: path.join(dir,'results'), settingsFile: path.join(dir,'settings.json'), log: { info() {}, error() {} } });
  const request = (body, auth = true) => fetch(admin.url + '/api/domain-recovery', { method: body ? 'POST' : 'GET', headers: { ...(auth ? { 'x-admin-token': admin.token } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request(config, false)).status, 403);
  assert.deepEqual((await (await request(config)).json()).config, config);
  assert.deepEqual((await (await request()).json()).config, config);
  assert.equal((await request({ ...config, canonicalOrigin: 'javascript:alert(1)' })).status, 400);
  assert.deepEqual((await (await request()).json()).config, config);
  assert.equal((await fetch(server.url + '/personal-data-config.json', { method: 'POST', body: '{}' })).status, 405);
});

test('direct migration checks exact peer, origin, nonce and route; URL never contains save data', async () => {
  const origin = 'https://old.example.test', nonce = 'b'.repeat(32);
  const hash = raw => TRANSFER_HASH + encodeURIComponent(JSON.stringify(raw));
  assert.deepEqual(directTransferRequest(hash({ origin, nonce })), { origin, nonce });
  for (const value of [origin + '/path', 'javascript:bad', 'https://user:pass@old.example.test', origin + '/?secret=1']) assert.equal(directTransferRequest(hash({ origin:value, nonce })), null);
  assert.equal(directTransferRequest(hash({ origin, nonce:'short' })), null);
  const peer = {}, event = { source:peer, origin, data:{ nonce, type:'ready' } };
  assert.equal(validDirectMessage(event,peer,origin,nonce,'ready'),true);
  for (const bad of [{...event,source:{}},{...event,origin:'https://other.test'},{...event,data:{nonce:'wrong',type:'ready'}}]) assert.equal(validDirectMessage(bad,peer,origin,nonce,'ready'),false);
  const handlers = new Set(), sent = [], states = []; let opened = '', captured = 0;
  const popup = { closed:false, postMessage:(data,target)=>sent.push({data,target}) };
  const win = { location:{origin}, crypto:globalThis.crypto, addEventListener:(_,fn)=>handlers.add(fn), removeEventListener:(_,fn)=>handlers.delete(fn), open:url=>{ opened=url; return popup; } };
  const cancel = beginDirectMigration('https://new.example.test',state=>states.push(state),{win,capture:async()=>{captured++;return 'private-save';},encode:async raw=>'encoded:'+raw});
  await setImmediate();
  const request = directTransferRequest(new URL(opened).hash);
  assert.ok(request); assert.equal(opened.includes('private-save'),false); assert.equal(captured,1); assert.equal(sent.length,0);
  const send = data => [...handlers].forEach(fn=>fn(data));
  send({source:popup,origin:'https://evil.test',data:{type:'sp.direct-ready',nonce:request.nonce}}); assert.equal(sent.length,0);
  send({source:popup,origin:'https://new.example.test',data:{type:'sp.direct-ready',nonce:request.nonce}});
  assert.equal(sent.length,1); assert.equal(sent[0].target,'https://new.example.test'); assert.equal(sent[0].data.code,'encoded:private-save');
  send({source:popup,origin:'https://new.example.test',data:{type:'sp.direct-received',nonce:request.nonce}});
  assert.deepEqual(states,['sending','sent']); assert.equal(handlers.size,0); cancel();
});
test('direct migration popup blocking stops capture; receiver validates before handing off a preview', async () => {
  let captured=0; const states=[];
  beginDirectMigration('https://new.example.test',state=>states.push(state),{win:{location:{origin:'http://old.test'},crypto:globalThis.crypto,addEventListener(){},removeEventListener(){},open:()=>null},capture:async()=>{captured++;return {};}});
  await setImmediate(); assert.deepEqual(states,['blocked']); assert.equal(captured,0);
  const handlers = new Set(), sent = [], results = []; let decoded=0;
  const peer={closed:false,postMessage:(data,target)=>sent.push({data,target})};
  const win={opener:peer,addEventListener:(_,fn)=>handlers.add(fn),removeEventListener:(_,fn)=>handlers.delete(fn)};
  const request={origin:'http://old.test',nonce:'a'.repeat(32)};
  const cancel=receiveDirectMigration(request,data=>results.push(data),()=>assert.fail('unexpected failure'),{win,decode:async code=>{decoded++;return {code};}});
  assert.equal(sent[0].data.type,'sp.direct-ready');
  const event={source:peer,origin:request.origin,data:{nonce:request.nonce,type:'sp.direct-data',code:'private-code'}};
  await Promise.all([...handlers].map(fn=>fn({...event,source:{}}))); assert.equal(decoded,0);
  await Promise.all([...handlers].map(fn=>fn(event)));
  assert.equal(decoded,1); assert.equal(results[0].data.code,'private-code'); assert.equal(results[0].origin,request.origin);
  assert.equal(sent[1].data.type,'sp.direct-received'); assert.equal(handlers.size,0); cancel();
});
test('all-site discovery reuses one helper and rejects wrong window, origin and stale nonce', async () => {
  const listeners=new Set(), visits=[], sent=[], results=[], states=[], previews=[];
  const peer={closed:false,location:{replace:url=>visits.push(new URL(url))},postMessage:(data,origin)=>sent.push({data,origin}),close(){this.closed=true;}};
  const win={location:{origin:'https://new.example.test'},crypto:globalThis.crypto,addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)};
  const rows=[{origin:'https://a.test'},{origin:'http://b.test:8080'}];
  const summary={hasData:true,name:'Doctor',tag:'1234',count:2,records:3,lastEnteredAt:null,recentMatchAt:null,avatar:null};
  const machine=createDomainDiscovery({win,onResult:(origin,row)=>results.push({origin,...row}),onStatus:state=>states.push(state),onPreview:(data,origin)=>previews.push({data,origin}),onExportError:()=>assert.fail('export failure'),decode:async code=>({fixture:code})});
  machine.scan(rows,peer);
  const first=migrationRequest(visits[0].hash), reply=(request,origin,data,source=peer)=>Promise.all([...listeners].map(fn=>fn({source,origin,data:{...data,nonce:request.nonce}})));
  assert.equal(first.auto,true);
  await reply(first,rows[0].origin,{type:'sp.recovery-summary',summary},{});
  await reply(first,'https://evil.test',{type:'sp.recovery-summary',summary}); assert.equal(visits.length,1);
  await reply(first,rows[0].origin,{type:'sp.recovery-summary',summary}); assert.equal(visits.length,2);
  const second=migrationRequest(visits[1].hash);
  await reply(first,rows[0].origin,{type:'sp.recovery-summary',summary}); assert.equal(visits.length,2);
  await reply(second,rows[1].origin,{type:'sp.recovery-summary',summary:{...summary,hasData:false}});
  assert.equal(results.filter(row=>row.status==='found').length,1); assert.equal(results.filter(row=>row.status==='empty').length,1);
  assert.equal(states.at(-1),'complete'); assert.equal(sent.length,0,'summary scan does not export full saves');
  machine.select(rows[0],peer); const selected=migrationRequest(visits.at(-1).hash);
  await reply(selected,rows[0].origin,{type:'sp.recovery-summary',summary});
  assert.equal(sent[0].data.type,'sp.recovery-export'); assert.equal(sent[0].origin,rows[0].origin);
  await reply(selected,rows[0].origin,{type:'sp.recovery-data',code:'selected-save'});
  assert.deepEqual(previews,[{data:{fixture:'selected-save'},origin:rows[0].origin}]);
  machine.dispose();assert.equal(listeners.size,0);assert.equal(peer.closed,true);
  assert.equal(validDiscoverySummary({...summary,records:-1}),false);
  assert.equal(openDiscoveryWindow({open:()=>null}),null);
  assert.equal(trustedDiscovery({origin:win.location.origin,auto:true},{canonicalOrigin:win.location.origin,sources:rows},rows[0].origin),true);
  assert.equal(trustedDiscovery({origin:'https://evil.test',auto:true},{canonicalOrigin:win.location.origin,sources:rows},rows[0].origin),false);
  assert.equal(trustedDiscovery({origin:win.location.origin,auto:true},{canonicalOrigin:win.location.origin,sources:[{...rows[0],enabled:false}]},rows[0].origin),false);
});
test('all-site timeout records an unavailable reply then continues rather than inventing an empty save', async () => {
  const visits=[],results=[],listeners=new Set();
  const peer={closed:false,location:{replace:url=>visits.push(url)},close(){this.closed=true;}};
  const win={location:{origin:'https://new.test'},crypto:globalThis.crypto,addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)};
  let complete;const done=new Promise(resolve=>{complete=resolve;});
  const machine=createDomainDiscovery({win,timeoutMs:10,onResult:(origin,row)=>results.push({origin,...row}),onStatus:status=>{if(status==='complete')complete();},onPreview:()=>assert.fail('preview'),onExportError:()=>assert.fail('export')});
  machine.scan([{origin:'https://offline-a.test'},{origin:'https://offline-b.test'}],peer);
  await done;assert.equal(visits.length,2);assert.equal(results.filter(r=>r.status==='unavailable').length,2);assert.equal(results.some(r=>r.status==='empty'),false);machine.dispose();
});
