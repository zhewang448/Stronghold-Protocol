import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { RELEASE_TAG } from '../../server/release-version.js';
import { APP_VERSION } from '../../shared/constants.js';
export const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
export const put = (root, rel, text) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
};
export const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
export function manifest(files, app = APP_VERSION) {
  return JSON.stringify({ format: 1, app, files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, { size: Buffer.byteLength(data), sha256: sha(data) }])) });
}
export function storedZip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [nameText, body] of entries) {
    const name = Buffer.from(nameText), data = Buffer.from(body);
    const crc = typeof zlib.crc32 === 'function' ? zlib.crc32(data) >>> 0 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x800, 8);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, name); offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
export const tag = RELEASE_TAG.startsWith(`v${APP_VERSION}-`)
  ? RELEASE_TAG.replace(/\d+$/, revision => String(Number(revision) + 1)) : `v${APP_VERSION}-extended.1`;
export const files = { 'package.json': JSON.stringify({ version: APP_VERSION, type: 'module' }), 'server/index.js': '// new server', 'server/new.js': '// new file' };
export const archive = (extra = []) => storedZip([...Object.entries({ ...files, 'MANIFEST.json': manifest(files),
  ...(!extra.some(([name]) => name === 'Stronghold-Protocol/data/assets.json') ? { 'data/assets.json': '{}' } : {}),
}).map(([name, body]) => [`Stronghold-Protocol/${name}`, body]), ...extra]);
export function releaseFor(zip = archive(), version = tag) {
  const name = `Stronghold-Protocol-${version}-assets.zip`;
  const url = `https://github.com/zhewang448/Stronghold-Protocol/releases/download/${version}`;
  return { tag_name: version, name: version, assets: [{ name, size: zip.length, digest: `sha256:${sha(zip)}`, browser_download_url: `${url}/${name}` }] };
}
/** Add SHA256SUMS.txt and its signature to `release`; returns the bodies and the test key list to verify with. */
export function signRelease(release, zip, { signTag = release.tag_name, key = crypto.generateKeyPairSync('ed25519') } = {}) {
  const base = release.assets[0].browser_download_url.replace(/[^/]+$/, '');
  const sums = `${sha(zip)}  ${release.assets[0].name}\n`;
  const message = Buffer.concat([Buffer.from(`stronghold-protocol-release\n${signTag}\n`), Buffer.from(sums)]);
  const sig = `${crypto.sign(null, message, key.privateKey).toString('base64')}\n`;
  release.assets.push({ name: 'SHA256SUMS.txt', browser_download_url: `${base}SHA256SUMS.txt` },
    { name: 'SHA256SUMS.txt.sig', browser_download_url: `${base}SHA256SUMS.txt.sig` });
  return { sums, sig, keys: [key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')] };
}
export const tick = () => new Promise((r) => setImmediate(r));
export function healthServerSource(port) {
  return `import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {computeBuildTag} from ${JSON.stringify(new URL('../../server/http/buildTag.js', import.meta.url).href)};
import {WebSocketServer} from ${JSON.stringify(new URL('../../node_modules/ws/wrapper.mjs', import.meta.url).href)};
const root=fileURLToPath(new URL('..',import.meta.url));
const server=http.createServer((q,r)=>r.end(q.url==='/healthz'?JSON.stringify({ok:true,app:${JSON.stringify(APP_VERSION)},build:computeBuildTag(root),pid:process.pid}):q.url==='/js/main.js'?'export {};':'<html><body>ready</body></html>'));
const wss=new WebSocketServer({server});wss.on('connection',ws=>ws.on('message',data=>{const m=JSON.parse(String(data));ws.send(JSON.stringify({t:'pong',c:m.c}));}));
server.listen(Number(process.env.PORT)||${port},'127.0.0.1',()=>{if(process.env.SP_UPDATE_PROBE)process.send?.({t:'sp.updateProbe',nonce:process.env.SP_UPDATE_PROBE,pid:process.pid,port:server.address().port});});
process.on('message',m=>{if(m.t==='sp.probe.stop'){wss.close();server.close(()=>process.exit(0));}});`;
}
export async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)); } throw new Error('timed out'); }
