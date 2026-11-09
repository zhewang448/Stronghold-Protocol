import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, problemsOf } from '../e2e/client.mjs';
import { startServer } from '../../server/index.js';
import { getVersionData } from '../../server/data.js';
import { makeMatch } from '../match/harness.js';

const REG = 'act3autochess@V3_1';
const enabled = process.env.SP_E2E === '1' && hasChrome();
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const noHorizontalOverflow = c => c.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const settled = c => c.page.waitForFunction(() => !document.getAnimations().some(animation =>
  animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity));

test('regulation: default, all solo levels, room mode change and briefing group pick on desktop and phone', {
  skip: !enabled, timeout: 240000,
}, async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false,
    recovery: false, versions: { enabled: 'all', default: REG }, matchHost: { matchOptions: { botRehearsal: 0 } } });
  const P = (await import('puppeteer-core')).default;
  const clients = [];
  try {
    for (const [w, h] of [[1920, 1080], [667, 375]]) {
      const c = new Client(P, srv.url, `regulation-${w}`, { w, h, prefix: `regulation-migration-${w}` });
      clients.push(c);
      await c.open('?render=fallback');
      await c.enter(`Regulation${w}`);
      await c.page.waitForFunction(() => globalThis.__SP__.data.get('config')?.version?.id === 'act3autochess@V3_1');
      assert.equal(await c.page.$eval('[data-testid="version-switch"]', e => e.dataset.version), REG);
      await settled(c);
      await c.shot('lobby');
      await c.click('.hub-entry', '独立模拟');
      await c.page.waitForSelector('[data-testid="proto-ladder"]');
      assert.equal(await c.page.$$eval('.ladder button[data-mode]', nodes => nodes.length), 21);
      await c.click('.ladder button[data-mode="mode_single_20"]');
      await c.page.waitForFunction(() => document.querySelector('.ladder button[data-mode="mode_single_20"]')?.getAttribute('aria-pressed') === 'true');
      assert.ok(await noHorizontalOverflow(c));
      await settled(c);
      await c.shot('levels');
      await c.click('.proto-start', '开始模拟');
      await c.page.waitForFunction(() => globalThis.__SP__.store.get().room?.modeId === 'mode_single_20');
      await c.click('.rs-pill__diff');
      await c.page.waitForSelector('.rs-proto .ladder');
      await c.click('.rs-proto .ladder button[data-mode="mode_single_5"]');
      await c.click('.rs-proto .proto-start', '确认');
      await c.page.waitForFunction(() => globalThis.__SP__.store.get().room?.modeId === 'mode_single_5');
      await c.page.evaluate(async () => {
        const { diyPool, diyTierSlotIds } = await import('/shared/diy.js');
        const d = globalThis.__SP__.data;
        const data = { chess: d.get('chess'), backups: d.get('backups') };
        const picks = {};
        for (const tier of [5, 6]) {
          const keys = [...diyTierSlotIds(tier, data), `diyBench_${tier}_1`, `diyBench_${tier}_2`];
          diyPool(tier, { data }).slice(0, keys.length).forEach((charId, index) => { picks[keys[index]] = { charId }; });
        }
        await globalThis.__SP__.net.request('room.diy', { picks });
      });
      await c.click('.rs-go', '开始模拟');
      await c.waitFor(s => s.phase === 'INFO_CHECK', 'regulation briefing');
      await c.page.waitForSelector('[data-testid="bond-groups"]');
      assert.equal(await c.page.$$eval('.brief-bond-group', nodes => nodes.length), 2);
      assert.equal(await c.page.$eval('[data-testid="brief-ready"]', el => el.disabled), true);
      await c.click('[data-testid="bond-group-1"]');
      await c.page.waitForFunction(() => globalThis.__SP__.store.get().match.public?.bondChoice?.picked === 1);
      await c.page.waitForFunction(() => !document.querySelector('[data-testid="brief-ready"]')?.disabled);
      const slotCounts = await c.page.evaluate(() => globalThis.__SP__.store.get().match.private.diyChoice.tiers.map(tier => tier.slots));
      assert.deepEqual(slotCounts, [6, 6]);
      await c.page.evaluate(async () => {
        const s = globalThis.__SP__.store.get(), choices = {};
        for (const tier of s.match.private.diyChoice.tiers) choices[tier.tier] = tier.candidates.slice(0, 6).map(candidate => candidate.charId);
        await globalThis.__SP__.net.request('g.diyApply', { choices, setupRevision: s.match.public.setupRevision });
      });
      assert.deepEqual(await c.page.evaluate(() => globalThis.__SP__.store.get().match.private.diyChoice.tiers.map(tier => tier.chosen.length)), [6, 6]);
      assert.ok(await noHorizontalOverflow(c));
      await settled(c);
      await c.shot('briefing');
      await c.click('[data-testid="brief-ready"]');
      await c.waitFor(s => s.phase === 'BAND_DRAFT', 'strategy draft');
      await c.close();
    }
    assert.deepEqual(problemsOf(clients), []);
  } finally {
    for (const c of clients) await c.close();
    await srv.close();
  }
});

test('teammate lookup: twenty-seat component fixture follows roster scrolling and keeps the strategy column fixed', {
  skip: !enabled, timeout: 180000,
}, async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false,
    recovery: false, versions: { enabled: 'all', default: REG } });
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.url, 'team-flyout', { w: 1280, h: 720, prefix: 'regulation-team-flyout' });
  const h = makeMatch({ humans: 20, data: getVersionData(REG), difficulty: 'FUNNY', log: quiet });
  try {
    const m = h.m;
    m.phase = 'PREP'; m.round = 1;
    const ids = m.gd.visibleChess.slice(0, 10);
    for (const ps of m.order) {
      ps.bandId = 'band_fund';
      for (let i = 0; i < ids.length; i++) ps.board.set(`${9 + Math.floor(i / 5)},${3 + i % 5}`, ps.newPiece('chess', ids[i]));
      ps.recompute();
    }
    const pub = m.publicView();
    await c.open('?render=fallback'); await c.enter('LookupTester');
    await c.page.waitForFunction(() => globalThis.__SP__.data.get('config')?.version?.id === 'act3autochess@V3_1');
    await c.page.evaluate(async pub => {
      const { render } = await import('/vendor/preact.module.js');
      const { html } = await import('/js/ui/components.js');
      const { TeamPanel } = await import('/js/ui/teamPanel.js');
      const root = document.createElement('div');
      root.id = 'team-layout-fixture';
      root.style.cssText = 'position:fixed;inset:0;z-index:2000;background:#101713;';
      document.body.append(root);
      render(html`<${TeamPanel} pub=${pub} myId="p_0" watching=${null} bubbles=${new Map()} onWatch=${() => {}} />`, root);
    }, pub);
    for (const [w, height] of [[1280, 720], [667, 375]]) {
      await c.page.setViewport({ width: w, height, deviceScaleFactor: 1 });
      await c.page.waitForSelector('#team-layout-fixture .team__bonds-toggle');
      if (await c.page.$eval('.team__bonds-toggle', el => el.getAttribute('aria-expanded') !== 'true')) await c.click('.team__bonds-toggle');
      await c.page.waitForSelector('.team__fly-window');
      await c.page.evaluate(() => { const list = document.querySelector('#team-layout-fixture .team__list'); list.scrollTop = list.scrollHeight; });
      await c.shot(`before-scroll-check-${w}`);
      console.log('FLYOUT_GEOMETRY', await c.page.evaluate(() => {
        const box = selector => { const el = document.querySelector(selector); return el ? { rect: el.getBoundingClientRect().toJSON(), scrollTop: el.scrollTop, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight } : null; };
        return { roster: box('#team-layout-fixture .team__list'), scroll: box('.team__fly-scroll'),
          band: box('.team__fly-bands'), row: box('.team__row[data-player-id="p_19"]'), cell: box('.team__fly-row[data-player-id="p_19"] .team__fly-ops') };
      }));
      await c.page.waitForFunction(() => {
        const root = document.querySelector('#team-layout-fixture');
        const row = root.querySelector('.team__row[data-player-id="p_19"]');
        const cell = root.querySelector('.team__fly-row[data-player-id="p_19"] .team__fly-ops');
        return row && cell && Math.abs(row.getBoundingClientRect().top - cell.getBoundingClientRect().top) < 2;
      });
      const fixed = await c.page.evaluate(() => {
        const band = document.querySelector('.team__fly-bands');
        const left = band.getBoundingClientRect().left;
        const list = document.querySelector('.team__fly-scroll'); list.scrollLeft = list.scrollWidth;
        return Math.abs(band.getBoundingClientRect().left - left) < 1;
      });
      assert.ok(fixed); assert.ok(await noHorizontalOverflow(c));
      await c.shot(`twenty-${w}`);
    }
    await c.page.focus('.team__bonds-toggle'); await c.page.keyboard.press('Escape');
    assert.equal(await c.exists('.team__fly-window'), false);
    assert.deepEqual(problemsOf([c]), []);
  } finally { h.m.dispose(); await c.close(); await srv.close(); }
});
