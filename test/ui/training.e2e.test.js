import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

const enabled = process.env.SP_E2E === '1' && hasChrome();
const out = path.resolve('.cache/training-ui');
async function browserFixture(t, viewport = { width: 1440, height: 1000 }) {
  const { default: puppeteer } = await import('puppeteer-core');
  const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true, studio: false, recovery: false, assetIndex: false });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio'] });
  t.after(async () => { await browser.close(); await server.close(); });
  await fs.mkdir(out, { recursive: true });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport(viewport);
  return { page, errors, server };
}
async function ready(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="training-library"]');
  await page.waitForSelector('[data-testid="training-canvas"][data-ready="true"]', { timeout: 30000 });
}
async function selectOperator(page, name, id) {
  await page.$$eval('.tf-library header button', buttons => buttons.find(b => b.textContent === '干员').click());
  await page.$eval('input[type="search"]', e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type('input[type="search"]', name);
  await page.click(`[data-chess="${id}"]`);
  await page.waitForFunction(id => globalThis.__TRAINING__.palette?.chessId === id || globalThis.__TRAINING__.doc.plans.A[0].units.some(u => u.chessId === id), {}, id);
}
async function tileClick(page, row, col) {
  const tile = await page.evaluate((row, col) => globalThis.__TRAINING__.views.A.tileScreen(row, col), row, col);
  await page.mouse.click(tile.x, tile.y);
}

test('native training: zero-time prep, icon equipment/skills, live A/B, seeking and quick results agree', { skip: !enabled, timeout: 120000 }, async t => {
  const { page, errors, server } = await browserFixture(t);
  await ready(page, server.url + '/training/?version=act2autochess');
  const preference = await page.evaluate(() => localStorage.getItem('sp.pref.loadout'));
  await selectOperator(page, '能天使', 'chess_char_3_01_a');
  await page.waitForFunction(() => globalThis.__TRAINING__.views.A?.pieceArt(1)?.shown?.endsWith('.skel'));
  assert.equal(await page.evaluate(() => globalThis.__TRAINING__.phase), 'prep');
  assert.equal(await page.evaluate(() => Object.keys(globalThis.__TRAINING__.packets).length), 0);
  await page.click('[data-testid="training-equip-0"]');
  await page.waitForSelector('[data-item]'); await page.click('[data-item]');
  await page.waitForFunction(() => globalThis.__TRAINING__.doc.plans.A[0].units[0].items.length === 1);
  await page.click('[data-skill="0"]'); await page.click('[data-skill="2"]');
  await page.click('[data-testid="training-copy"]');
  await page.click('[data-testid="training-run-both"]');
  await page.waitForSelector('[data-testid="training-comparison"]', { timeout: 20000 });
  const fast = await page.$eval('[data-testid="training-comparison"]', e => e.innerText);
  await page.click('[data-testid="training-open-report"]');
  await page.waitForSelector('[data-testid="training-result-curve"]');
  await page.select('[aria-label="曲线指标"]', 'dps');
  await page.$$eval('.trp-report-tabs button', buttons => buttons.find(b => b.textContent === '单位明细').click());
  const table = await page.$eval('[data-testid="training-unit-table"]', e => e.innerText);
  assert.match(table, /有效治疗/); assert.match(table, /承伤/); assert.match(table, /攻击次数/);
  await page.click('[aria-label="关闭战报"]');
  await page.select('[aria-label="排行指标"]', 'healing');
  await page.select('[aria-label="排行指标"]', 'damage');
  await page.click('[data-testid="training-dual"]');
  await page.waitForFunction(() => !!globalThis.__TRAINING__.views.A && !!globalThis.__TRAINING__.views.B);
  await page.click('[data-testid="training-run"]');
  await page.waitForFunction(() => globalThis.__TRAINING__.packets.A?.ticks > 45 && globalThis.__TRAINING__.packets.B?.ticks > 45);
  await page.click('[data-testid="training-play"]');
  await page.waitForFunction(() => !globalThis.__TRAINING__.playback.playing && !globalThis.__TRAINING__.playback.inflight);
  assert.equal(await page.evaluate(() => globalThis.__TRAINING__.packets.A.ticks), await page.evaluate(() => globalThis.__TRAINING__.packets.B.ticks));
  assert.equal(await page.evaluate(() => globalThis.__TRAINING__.packets.A.metrics.damage), await page.evaluate(() => globalThis.__TRAINING__.packets.B.metrics.damage));
  await page.$eval('[aria-label="播放进度"]', e => { e.value = '59.9'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => globalThis.__TRAINING__.packets.A?.ticks >= 1797 && !globalThis.__TRAINING__.playback.inflight);
  await page.click('[data-testid="training-play"]');
  await page.waitForFunction(() => globalThis.__TRAINING__.packets.A?.finished && globalThis.__TRAINING__.packets.B?.finished);
  assert.equal(await page.$eval('[data-testid="training-comparison"]', e => e.innerText), fast);
  await page.screenshot({ path: path.join(out, 'native-dual.png'), fullPage: true });
  await page.click('[data-testid="training-edit"]');
  assert.equal(await page.evaluate(() => localStorage.getItem('sp.pref.loadout')), preference);
  await page.click('[data-testid="training-conditions-open"]');
  await page.$eval('[data-testid="training-hp"]', e => { e.value = '10'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$$eval('.tf-drawer header button', buttons => buttons[0].click());
  await page.click('[data-testid="training-run"]');
  await page.waitForFunction(() => globalThis.__TRAINING__.packets.A?.finished && globalThis.__TRAINING__.packets.B?.finished);
  assert.equal(await page.evaluate(() => globalThis.__TRAINING__.packets.A.metrics.damage), 10);
  assert.deepEqual(errors, []);
});

test('native team: field clicks, direction wheel, elite, summon and two boss fields', { skip: !enabled, timeout: 90000 }, async t => {
  const { page, errors, server } = await browserFixture(t);
  await ready(page, server.url + '/training/?version=act2autochess');
  await page.click('[data-testid="training-team"]');
  await selectOperator(page, '伺夜', 'chess_char_3_19_a');
  // Resolve the ID by the visible catalogue name because historical versions reuse chess identifiers.
  if (!(await page.evaluate(() => globalThis.__TRAINING__.doc.plans.A[0].units.length))) {
    await tileClick(page, 12, 4); await page.waitForSelector('.fwheel');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => globalThis.__TRAINING__.doc.plans.A[0].units.length === 1);
  await page.$$eval('.tf-unit-tools button', buttons => buttons.find(b => b.textContent === '晋升精锐').click());
  await page.waitForFunction(() => globalThis.__TRAINING__.compiled.A?.tokens[0]?.length);
  await page.$$eval('.tf-library header button', buttons => buttons.find(b => b.textContent === '召唤物').click());
  await page.click('.tf-catalogue button');
  await tileClick(page, 12, 5); await page.waitForSelector('.fwheel'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => globalThis.__TRAINING__.doc.plans.A[0].units.length === 2);
  await page.click('[data-testid="training-conditions-open"]');
  await page.$$eval('.tf-drawer label', labels => { const select = labels.find(l => l.firstChild?.textContent === '战场区域').querySelector('select'); select.value = 'boss'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$$eval('.tf-drawer header button', buttons => buttons[0].click());
  await page.$$eval('.tf-workbar button', buttons => buttons.find(b => b.textContent === '添加第二阵地').click());
  assert.equal(await page.evaluate(() => globalThis.__TRAINING__.doc.environment.fields), 2);
  assert.equal(await page.evaluate(() => globalThis.__TRAINING__.doc.plans.B.length), 2);
  await selectOperator(page, '能天使', 'chess_char_3_01_a'); await tileClick(page, 12, 4);
  await page.waitForSelector('.fwheel'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await page.click('[data-testid="training-run"]'); await page.waitForFunction(() => globalThis.__TRAINING__.packets.A?.ticks > 10);
  await page.screenshot({ path: path.join(out, 'native-boss.png'), fullPage: true });
  assert.deepEqual(errors, []);
});

test('mobile and missing 3D: native viewport stays usable and fallback keeps deployment', { skip: !enabled, timeout: 90000 }, async t => {
  const { page, errors, server } = await browserFixture(t, { width: 390, height: 844, isMobile: true, hasTouch: true });
  await ready(page, server.url + '/training/?version=act2autochess');
  await selectOperator(page, '能天使', 'chess_char_3_01_a');
  assert.equal(await page.$('[data-testid="training-dual"]'), null);
  let size = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.equal(size[0], size[1]);
  await page.screenshot({ path: path.join(out, 'native-mobile.png'), fullPage: true });
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  size = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.equal(size[0], size[1]);
  await ready(page, server.url + '/training/?version=act2autochess&render=fallback');
  await page.waitForSelector('[data-render="fallback"]');
  await selectOperator(page, '能天使', 'chess_char_3_01_a');
  await page.click('[data-testid="training-run"]'); await page.waitForFunction(() => globalThis.__TRAINING__.packets.A?.ticks > 10);
  await page.$$eval('.tf-mobile-nav button', buttons => buttons.find(b => b.textContent === '统计').click());
  await page.click('[data-testid="training-open-report"]');
  await page.waitForSelector('[data-testid="training-full-report"]');
  size = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.equal(size[0], size[1]);
  await page.screenshot({ path: path.join(out, 'native-result-mobile.png'), fullPage: true });
  await page.click('[aria-label="关闭战报"]');
  await page.screenshot({ path: path.join(out, 'native-fallback.png'), fullPage: true });
  assert.deepEqual(errors, []);
});
