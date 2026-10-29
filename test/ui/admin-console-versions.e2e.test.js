import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startServer } from '../../server/index.js';
import { startAdmin } from '../../server/admin.js';
import { replayIdentity, saveReplay } from '../../server/replay-store.js';
import { makeMatch } from '../match/harness.js';
import { VERSIONS, DEFAULT_VERSION } from '../../shared/versions.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
test('console four-version replay digests, live/wall context and summary filters', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 240000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-console-versions-'));
  const resultsDir = path.join(dir, 'results'), replaysDir = path.join(dir, 'replays');
  fs.mkdirSync(resultsDir);
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, versions: { enabled: 'all' } });
  const admin = await startAdmin({ lobby: srv.lobby, port: 0, resultsDir, replaysDir, settingsFile: path.join(dir, 'settings.json'), log: quiet });
  const browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--no-first-run', '--disable-background-timer-throttling'] });
  const page = await browser.newPage(), requests = [], local = [];
  page.on('request', r => requests.push(r.url()));
  try {
    await page.goto(admin.url);
    for (const v of VERSIONS) {
      const cs = srv.versions.csOf(v.id), id = 'record-' + v.id.replace(/[^a-z0-9]/gi, '-') + '.json';
      const output = path.join(dir, id);
      const recorded = spawnSync(process.execPath, ['test/helpers/consoleVersionRecording.mjs', v.id, cs,
        replayIdentity(path.resolve('.')), output], { encoding: 'utf8', timeout: 60000 });
      assert.equal(recorded.status, 0, recorded.stderr);
      const replay = JSON.parse(fs.readFileSync(output, 'utf8')), fields = replay.rounds.flatMap(r => r.fields);
      assert.ok(fields.some(f => f.kind === 'unite' && f.playable), recorded.stdout);
      saveReplay(replaysDir, id, replay);
      fs.writeFileSync(path.join(resultsDir, id), JSON.stringify({ savedAt: replay.savedAt, room: 'TEST', mode: 'coop',
        difficulty: 'NORMAL', version: v.id, result: { players: [], victory: true, roundsPassed: 2 }, history: [] }));
      await page.goto(admin.url + '/replay?id=' + id);
      await page.waitForSelector('[data-field]');
      assert.match(await page.$eval('#match-meta', e => e.textContent), new RegExp(v.label));
      const normal = fields.findIndex(f => f.kind === 'normal' && f.playable && f.players.includes('p_0'));
      const unite = fields.findIndex(f => f.kind === 'unite' && f.playable);
      for (const i of [normal, unite, normal]) {
        await page.click('[data-field="' + i + '"]');
        await page.select('#speed', '8'); await page.click('#play');
        await page.waitForFunction(() => document.querySelector('#digest').textContent === '与记录一致'
          || document.querySelector('#digest').className === 'bad', { timeout: 30000 });
        assert.equal(await page.$eval('#digest', e => e.textContent), '与记录一致', v.id + ' field ' + i);
      }
      saveReplay(replaysDir, id, { ...replay, made: { ...replay.made, identity: 'previous-fingerprint' } });
      await page.reload();
      await page.waitForSelector('[data-field]');
      assert.match(await page.$eval('#notice', e => e.textContent), /版本已变/);
      page.once('dialog', d => d.dismiss());
      await page.click('[data-field="' + normal + '"]'); await page.click('#play');
      assert.equal(await page.$eval('#field', e => e.hidden), true);
      console.log('replay ' + v.id + ': normal/unite/reselect digests match');
      const { getVersionData } = await import('../../server/data.js');
      const h = makeMatch({ data: getVersionData(v.id, { log: quiet }), humans: 2, cs, fake: true,
        clientCombat: true, clients: false }).start().toPrep();
      local.push(h);
      h.m.version = v.id === DEFAULT_VERSION ? null : v.id;
      h.m.convenience = { prepLoadout: true, unequip: true, morphPairing: true };
      srv.lobby.rooms.set('TEST', { code: 'TEST', mode: 'coop', difficulty: 'NORMAL', version: v.id,
        content: srv.versions.content(v.id), seats: h.m.order.map(p => ({ ...p })), spectators: [], match: h.m });
      await page.goto(admin.url);
      await page.waitForSelector('[data-open-room="TEST"]');
      await page.click('[data-open-room="TEST"]');
      const expectedCatalog = h.m.gd.visibleChess.reduce((n, id) => n + 1
        + Number(!!h.m.gd.chess(id).goldenId && !!h.m.gd.chess(h.m.gd.chess(id).goldenId)), 0);
      await page.waitForFunction(n => document.querySelector('#chess-list')?.children.length === n,
        {}, expectedCatalog);
      assert.ok(requests.some(u => u.includes('/api/catalog?room=TEST')));
      const before = requests.length;
      for (const wall of [false, true]) {
        await page.goto(admin.url + '/live?room=TEST&playerId=p_0' + (wall ? '&wall=1' : ''));
        await page.waitForSelector('.shopbar');
        const state = await page.evaluate(async () => {
          const { store } = await import('/js/store.js');
          const { shownVersion } = await import('/js/versions.js');
          const { contentSet } = await import('/js/content.js');
          const { effectiveRoomRules } = await import('/shared/roomConvenience.js');
          const s = store.get();
          return { version: s.room.version, shown: shownVersion(s), content: contentSet.get(), rules: effectiveRoomRules(s.room) };
        });
        assert.equal(state.version, v.id); assert.equal(state.shown, v.id);
        assert.equal(state.rules.unequip, 'allow'); assert.equal(state.rules.prepLoadout, 'prep');
        assert.equal(state.rules.morphPairing, 'plus');
        if (v.id !== DEFAULT_VERSION) { assert.equal(state.content.status, 'ready'); assert.equal(state.content.version, v.id); }
        assert.equal(await page.$eval('#live-control', e => e.checked), false);
        if (wall) assert.equal(await page.$eval('#live-control', e => e.disabled), true);
        if (!wall) {
          await page.select('#live-player', 'p_1');
          await page.waitForFunction(() => document.querySelector('#live-status').textContent.includes('P1'));
          assert.equal(await page.evaluate(async () => (await import('/js/store.js')).store.get().room.version), v.id);
        }
        for (const [width, height] of [[1440,900], [844,390]]) {
          await page.setViewport({ width, height });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        }
      }
      if (v.id !== DEFAULT_VERSION) assert.ok(requests.slice(before).some(u => u.includes('/data/versions/') && u.includes('config.json')));
      console.log('live ' + v.id + ': viewer/wall identity and convenience match');
      srv.lobby.rooms.delete('TEST');
    }
    await page.goto(admin.url); await page.click('[data-tab="records"]');
    await page.waitForSelector('#summary-version');
    await page.select('#summary-rules', '');
    assert.equal(await page.$$eval('#summary-version option', opts => opts.length), 5);
    for (const v of VERSIONS) {
      await page.select('#summary-version', v.id); await page.click('[data-summary-filter]');
      await page.waitForFunction(label => document.querySelector('#summary-data').textContent.includes(label)
        && document.querySelector('#summary-data').textContent.includes('1 局'), {}, v.label);
      assert.equal(await page.$$eval('#summary-data tbody tr', rows => rows.length), 1);
    }
    console.log('summary: four game version filters return one group');
    await page.select('#summary-version', ''); await page.click('[data-summary-filter]');
    await page.waitForFunction(() => document.querySelector('#summary-data tbody')?.children.length === 4);
    assert.match(await page.$eval('#summary-data', e => e.textContent), /4 局/);
  } finally {
    await browser.close(); srv.lobby.rooms.clear();
    for (const h of local) h.m.dispose();
    await admin.close(); await srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
