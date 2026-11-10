import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('launcher proxy reaches the transport, preserves loopback bypass and supports explicit direct mode', async t => {
  const sockets = new Set();
  const proxy = createServer();
  let hits = 0;
  proxy.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  proxy.on('connect', (req, socket) => {
    assert.equal(req.url, 'download.invalid:80');
    hits++;
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied'));
  });
  const origin = createServer((_req, res) => res.end('local'));
  await Promise.all([new Promise(r => proxy.listen(0, '127.0.0.1', r)), new Promise(r => origin.listen(0, '127.0.0.1', r))]);
  t.after(() => { for (const s of sockets) s.destroy(); proxy.close(); origin.closeAllConnections(); origin.close(); });
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  const localUrl = `http://127.0.0.1:${origin.address().port}/asset`;
  const preload = fileURLToPath(new URL('../tools/assets/launcher-proxy.cjs', import.meta.url));
  const guard = new URL('../tools/assets/env-proxy.mjs', import.meta.url).href;
  const run = async (mode, url) => {
    const code = `import {guardDefaultFetch,restartForEnvProxy} from ${JSON.stringify(guard)}; if(restartForEnvProxy())throw Error('unexpected restart'); const r=await guardDefaultFetch()(${JSON.stringify(url)});console.log(await r.text());`;
    const env = { ...process.env, SP_DOWNLOAD_PROXY_MODE: mode, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl, NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1', NODE_USE_ENV_PROXY: '0', NODE_OPTIONS: '' };
    const child = spawn(process.execPath, ['--require', preload, '--input-type=module', '-e', code], {env, windowsHide:true});
    let stdout = '', stderr = '';
    child.stdout.on('data', x => stdout += x);
    child.stderr.on('data', x => stderr += x);
    const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    assert.equal(exit, 0, stderr);
    return stdout.trim();
  };
  for (const mode of ['system', 'manual']) assert.equal(await run(mode, 'http://download.invalid/asset'), 'proxied');
  assert.equal(hits, 2);
  assert.equal(await run('system', localUrl), 'local');
  assert.equal(await run('direct', localUrl), 'local');
  assert.equal(hits, 2, 'loopback bypass and direct must not contact the proxy');
});
