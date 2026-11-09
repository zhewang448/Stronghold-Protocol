import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, problemsOf } from '../e2e/client.mjs';
import { startServer } from '../../server/index.js';

test('regulation-default server creates the explicitly selected classic version from the actual lobby', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000,
}, async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false, assetIndex: false,
    versions: { enabled: 'all', default: 'act3autochess@V3_1' } });
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.url, 'classic-switch', { prefix: 'regulation-classic-switch' });
  try {
    await c.open('?render=fallback'); await c.enter('ClassicTester');
    await c.click('[data-testid="version-switch"]');
    await c.page.waitForSelector('.verpick__pick[data-version="act2autochess"]');
    await c.click('.verpick__pick[data-version="act2autochess"]');
    await c.page.waitForFunction(() => globalThis.__SP__.data.get('config') && !globalThis.__SP__.data.get('config').version);
    await c.click('.hub-entry', '独立模拟');
    await c.page.waitForSelector('.proto .pcard');
    assert.equal(await c.page.$$eval('[data-testid="proto-ladder"]', nodes => nodes.length), 0);
    await c.click('.proto-start', '开始模拟');
    await c.page.waitForFunction(() => !!globalThis.__SP__.store.get().room);
    const room = await c.page.evaluate(() => globalThis.__SP__.store.get().room);
    assert.equal(room.version ?? 'act2autochess', 'act2autochess');
    assert.equal(room.modeId, undefined);
    assert.deepEqual(problemsOf([c]), []);
  } finally { await c.close(); await srv.close(); }
});
