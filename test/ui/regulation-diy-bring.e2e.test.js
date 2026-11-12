import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { startServer } from '../../server/index.js';
import { Client, hasChrome } from '../e2e/client.mjs';

test('Regulation selection UI caps each tier, confirms none/one/two and survives reload', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 180000,
}, async t => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false,
    versions: { enabled: 'all' }, matchHost: { matchOptions: { botRehearsal: 0 } } });
  const c = new Client((await import('puppeteer-core')).default, srv.url, 'regulation-bring',
    { w: 1280, h: 720, lobbyVersion: 'act3autochess@V3_1' });
  t.after(async () => { await c.close(); await srv.close(); });
  mkdirSync('.cache/upstream-20261112/shots', { recursive: true });
  const request = (type, body = {}) => c.page.evaluate((type, body) => globalThis.__SP__.net.request(type, body), type, body);
  await c.open('?render=fallback'); await c.enter('自编验收');
  for (const count of [0, 1, 2]) {
    await request('room.create', { mode: 'solo', difficulty: 'FUNNY', version: 'act3autochess@V3_1', soloUnlimited: true });
    await c.page.waitForFunction(() => globalThis.__SP__.data.get('config')?.version?.id === 'act3autochess@V3_1'
      && globalThis.__SP_CONTENT__?.state()?.status === 'ready');
    await c.page.evaluate(async () => {
      const { data } = await import('/js/data.js');
      const { diySlot, diySlotIds } = await import('/shared/diy.js');
      const raw = { chess: data.get('chess'), backups: data.get('backups') }, picks = {};
      for (const tier of [5, 6]) {
        const ids = diySlotIds(raw).filter(id => diySlot(id, raw).tier === tier);
        data.get('backups').diy.prototypes[tier].slice(0, 3).forEach((charId, i) => { picks[ids[i]] = { charId }; });
      }
      (await import('/js/ui/loadoutSync.js')).setDiyPicks(picks);
    });
    await c.page.waitForFunction(async () => (await import('/js/ui/loadoutSync.js')).loadoutStore.get().diySync === 'synced');
    await request('room.start'); await c.waitFor(s => s.phase === 'INFO_CHECK', 'briefing');
    assert.equal(await c.page.$('[data-testid="diy-choice-open"]'), null);
    if (await c.page.$('[data-testid="bond-group-0"]')) await c.click('[data-testid="bond-group-0"]');
    await c.click('[data-testid="brief-ready"]'); await c.waitFor(s => s.phase === 'BAND_DRAFT', 'strategy');
    await request('g.band', { bandId: 'band_fund' });
    await c.page.waitForSelector('[data-testid="diy-check"]');
    await c.page.setViewport({ width: count === 2 ? 1280 : count === 1 ? 667 : 844, height: count === 2 ? 720 : count === 1 ? 375 : 390 });
    await c.page.evaluate(async () => (await import('/js/ui/settings.js')).settingsStore.set({ textSize: 'lg' }));
    const cards = await c.page.$$eval('[data-testid="diy-check-card"]', nodes => nodes.map(node => ({ id: node.dataset.slot,
      tier: node.closest('[data-tier]')?.getAttribute('data-tier'), on: node.getAttribute('aria-pressed') === 'true', disabled: node.disabled })));
    assert.equal(cards.length, 6);
    for (const card of cards.filter(card => card.on)) await c.page.locator(`[data-slot="${card.id}"]`).click();
    for (const tier of [5, 6]) {
      const group = cards.filter(card => card.id.includes(`_${tier}_`) && !card.disabled);
      assert.ok(group.length >= 3);
      for (const card of group.slice(0, count)) await c.page.locator(`[data-slot="${card.id}"]`).click();
      if (count === 2) {
        await c.page.locator(`[data-slot="${group[2].id}"]`).click();
        assert.equal(await c.page.$eval(`[data-slot="${group[2].id}"]`, node => node.getAttribute('aria-pressed')), 'false');
      }
    }
    await c.page.screenshot({ path: `.cache/upstream-20261112/shots/diy-${count}.png` });
    await c.click(count === 0 ? '[data-testid="diy-check-none"]' : '[data-testid="diy-check-confirm"]');
    await c.waitFor(s => s.phase === 'PREP', 'prep');
    const selected = await c.page.evaluate(() => globalThis.__SP__.store.get().match.private.diyBring);
    assert.equal(selected.length, count * 2);
    await c.page.reload();
    await c.page.waitForFunction(() => globalThis.__SP__?.store.get().match.public?.phase === 'PREP'
      && Array.isArray(globalThis.__SP__.store.get().match.private?.diyBring));
    assert.deepEqual(await c.page.evaluate(() => globalThis.__SP__.store.get().match.private.diyBring), selected);
    await c.page.evaluate(async () => (await import('/js/ui/matchChrome.js')).quitMatch());
    await c.page.waitForFunction(() => !globalThis.__SP__.store.get().room);
  }
  assert.deepEqual(c.problems.filter(problem => problem.startsWith('pageerror')), []);
});
