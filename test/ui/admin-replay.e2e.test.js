import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAdmin, resultRecord } from '../../server/admin.js';
import { replayIdentity, saveReplay } from '../../server/replay-store.js';
import { getReplayConfig, setReplayConfig, replayRecord } from '../../server/match/replay.js';
import { computeVanillaContent } from '../../server/plugins/identity.js';
import { DATA_SHIM_JS } from '../../server/http/static.js';
import { makeMatch } from '../match/harness.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('console replay: normal playback, boss/hidden attempts across versions, controls, deletion and responsive layout', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-replay-ui-'));
  const old = getReplayConfig(), id = '20261013-TEST.json', resultsDir = path.join(dir, 'results'), replaysDir = path.join(dir, 'replays');
  let browser, admin, h;
  try {
    fs.mkdirSync(resultsDir);
    setReplayConfig({ enabled: true, identity: replayIdentity(path.resolve('.')) });
    const content = computeVanillaContent({ simDir: path.resolve('server/sim'), sharedDir: path.resolve('shared'), dataDir: path.resolve('data'), shim: DATA_SHIM_JS });
    h = makeMatch({ humans: 1, bots: 7, cs: content.cs, seed: 4242, clientCombat: true, captureFrames: false }).start().autoHumans();
    assert.ok(h.drive(() => h.ended != null));
    const replay = replayRecord(h.m, { room: 'TEST', savedAt: Date.now(), resultId: id });
    assert.equal(replay.players.length, 8);
    assert.ok(replay.rounds.flatMap((r) => r.fields).every((f) => f.spec.cs === content.cs), 'production recordings carry the vanilla content hash');
    saveReplay(replaysDir, id, replay);
    fs.writeFileSync(path.join(resultsDir, id), JSON.stringify(resultRecord({ code: 'TEST', mode: 'coop', difficulty: 'NORMAL' }, h.m, h.ended)));
    admin = await startAdmin({ lobby: { rooms: new Map(), safeData: () => ({}), onMatchEnd() {} }, port: 0, resultsDir, replaysDir,
      settingsFile: path.join(dir, 'settings.json'), log: { info() {}, error() {} } });
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const waitPlaying = async () => {
      await page.waitForFunction(() => !document.querySelector('#pause').disabled || document.querySelector('#digest').className === 'bad');
      const digest = await page.$eval('#digest', (el) => ({ text: el.textContent, kind: el.className }));
      assert.notEqual(digest.kind, 'bad', digest.text);
    };
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.click('[data-tab="records"]');
    await page.waitForSelector('.replay-link');
    const href = await page.$eval('.replay-link', (el) => el.getAttribute('href'));
    await page.goto(`${admin.url}${href}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-field]');
    await page.select('#speed', '8'); await page.click('#play');
    await waitPlaying();
    await page.click('#pause');
    assert.equal(await page.$eval('#pause', (el) => el.textContent), '继续播放');
    assert.match(await page.$eval('#digest', (el) => el.textContent), /已暂停/);
    await page.select('#speed', '4'); await page.click('#pause');
    await page.select('#speed', '8');
    await page.waitForFunction(() => document.querySelector('#digest').textContent === '与记录一致', { timeout: 45000 });
    const canvases = await page.$$eval('#field canvas', (els) => els.length);
    assert.ok(canvases >= 1);
    await page.click('#restart'); await waitPlaying(); await page.click('#pause');
    assert.equal(await page.$$eval('#field canvas', (els) => els.length), canvases, 'restart disposes old renderer');
    const fieldIndex = replay.rounds.flatMap((r) => r.fields).findIndex((f) => f.playable && f.spec.round >= 2 && f.players.includes('ai_6') && f.lineup.some((p) => p.units.length));
    assert.ok(fieldIndex >= 0, 'capture a recorded formation from the second four-seat group');
    await page.click(`[data-field="${fieldIndex}"]`); await page.click('#play');
    await waitPlaying();
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    await page.click('#pause');
    const shots = path.resolve('.impeccable/review'); fs.mkdirSync(shots, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} viewer fits`);
      await page.screenshot({ path: path.join(shots, `replay-${name}.png`), fullPage: true });
    }
    const fields = replay.rounds.flatMap((r) => r.fields);
    const bossIndex = fields.findIndex((f) => f.kind === 'boss');
    assert.ok(bossIndex >= 0, 'the real match reached the Final Assault');
    const boss = fields[bossIndex];
    // Keep real captured boss input and an unemptied pool, but shorten the recorded duration to
    // exercise the local cutoff quickly. The hidden fixture shares that input with its own kind.
    boss.result.time = 2;
    const hidden = structuredClone(boss);
    hidden.kind = hidden.spec.kind = 'hidden';
    hidden.battleId = hidden.spec.battleId = `${boss.battleId}-hidden`;
    hidden.spec.round = 15;
    replay.rounds.push({ round: 15, phase: 'HIDDEN_CORE', admin: [], fields: [hidden] });
    for (const identity of [replay.made.identity, 'previous-version']) {
      saveReplay(replaysDir, id, { ...replay, made: { ...replay.made, identity } });
      await page.reload({ waitUntil: 'networkidle0' });
      for (const index of [bossIndex, fields.length]) {
        await page.click(`[data-field="${index}"]`);
        assert.equal(await page.$eval('#play', (el) => el.disabled), false);
        assert.equal(await page.$eval('#play', (el) => el.textContent), '仍然尝试播放');
        assert.match(await page.$eval('#digest', (el) => el.textContent), /共享血池/);
        page.once('dialog', (d) => d.dismiss()); await page.click('#play');
        assert.equal(await page.$eval('#field', (el) => el.hidden), true);
        const dialog = new Promise((resolve) => page.once('dialog', async (d) => { const message = d.message(); await d.accept(); resolve(message); }));
        await page.click('#play');
        assert.match(await dialog, /共享血池/);
        await page.waitForFunction(() => document.querySelector('#digest').textContent.includes('领袖战尝试播放结束'), { timeout: 15000 });
        assert.equal(await page.$eval('#digest', (el) => el.className), 'warn');
        assert.equal(await page.$eval('#pause', (el) => el.disabled), true);
        assert.match(await page.$eval('#digest', (el) => el.textContent), /无法保证原样重放|结果不同|与记录不同/);
        assert.equal(boss.spec.timeLimit, null, 'the saved boss input keeps its original unlimited duration');
      }
    }
    await page.reload({ waitUntil: 'networkidle0' });
    assert.match(await page.$eval('#notice', (el) => el.textContent), /版本已变/);
    page.once('dialog', (d) => d.dismiss()); await page.click('#play');
    assert.equal(await page.$eval('#field', (el) => el.hidden), true);
    page.once('dialog', (d) => d.accept()); await page.click('#play');
    await page.waitForFunction(() => document.querySelector('#digest').textContent.includes('版本不一致'), { timeout: 30000 });
    await page.goto(admin.url, { waitUntil: 'domcontentloaded' });
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#storage-form');
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      await page.evaluate(() => scrollTo(0, 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} console fits`);
      await page.screenshot({ path: path.join(shots, `replay-storage-${name}.png`), fullPage: true });
    }
    await page.click('input[name="storage"][value="adminLogs"]');
    page.once('dialog', (d) => d.dismiss()); await page.click('[data-storage-clear]');
    assert.ok(fs.existsSync(path.join(resultsDir, id)));
    page.once('dialog', (d) => d.accept()); await page.click('[data-storage-clear]');
    await page.waitForFunction(() => document.querySelector('#storage-saved').textContent === '已完成清理');
    await page.click('[data-tab="records"]'); await page.waitForSelector('[data-record-delete]');
    page.once('dialog', (d) => d.dismiss()); await page.click('[data-record-delete]');
    assert.ok(fs.existsSync(path.join(replaysDir, `${id}.gz`)));
    page.once('dialog', (d) => d.accept()); await page.click('[data-record-delete]');
    await page.waitForSelector('#records-list .empty');
    assert.equal(await page.$$eval('[data-record-delete]', (els) => els.length), 0);
    assert.equal(fs.existsSync(path.join(resultsDir, id)), false);
    assert.equal(fs.existsSync(path.join(replaysDir, `${id}.gz`)), false);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close(); if (admin) await admin.close(); h?.m.dispose();
    setReplayConfig(old); fs.rmSync(dir, { recursive: true, force: true });
  }
});
