import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('process entry enables recovery by default and console toggles persist across a real restart', { skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000 }, async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-default-recovery-'));
  const freePort = async () => { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; };
  const port = await freePort(), adminPort = await freePort(), base = 'http://127.0.0.1:' + adminPort;
  fs.mkdirSync('.cache/default-recovery-20261026', { recursive: true });
  let child, browser, logs = '';
  const stop = async () => { if (!child || child.exitCode !== null) return; const exited = new Promise(r => child.once('exit', r)); child.kill(); await exited; };
  try {
    for (const dir of ['server', 'shared', 'data', 'public/js', 'public/studio/js', 'public/vendor', 'tools', 'schemas']) fs.cpSync(path.join(root, dir), path.join(fixture, dir), { recursive: true });
    for (const dir of ['packs', 'plugins']) fs.mkdirSync(path.join(fixture, dir));
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ type: 'module' }));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const start = async () => {
      child = spawn(process.execPath, ['server/index.js'], { cwd: fixture, windowsHide: true, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), SP_ADMIN: '1', SP_ADMIN_PORT: String(adminPort), SP_ASSET_INDEX: '0', SP_AI_TAKEOVER: '', SP_PLUGIN_SCRIPTS: 'off', SP_UPDATE_RESTART: '', SP_REQUIRE_ADMIN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
      for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(logs);
        try { const html = await fetch(base, { signal: AbortSignal.timeout(300) }).then(r => r.text()); if (html.includes('const TOKEN')) return; } catch { /* starting */ }
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error('isolated process did not start: ' + logs);
    };
    await start();
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling'] });
    const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', error => { logs += '\nPAGE: ' + error.stack; });
    page.on('dialog', d => d.accept());
    const open = async () => { await page.goto(base, { waitUntil: 'networkidle0' }); await page.click('[data-tab=settings]'); await page.waitForSelector('#recovery-enabled'); };
    await open();
    assert.equal(await page.$eval('#recovery-enabled', e => e.checked), true);
    assert.equal(await page.$eval('#recovery-enabled', e => e.disabled), false);
    assert.equal(await page.$eval('#ai-takeover-allowed', e => e.checked), true);
    const recovery = async on => {
      await page.$eval('#recovery-enabled', e => e.scrollIntoView({ block: 'center' }));
      if (await page.$eval('#recovery-enabled', e => e.checked) !== on) await page.click('#recovery-enabled');
      const response = page.waitForResponse(r => r.url().endsWith('/api/recovery') && r.request().method() === 'POST');
      await page.click('[data-recovery-save]'); assert.equal((await (await response).json()).enabled, on);
      await page.waitForFunction(on => document.querySelector('#recovery-enabled').checked === on && !document.querySelector('[data-recovery-save]').disabled, {}, on);
    };
    await recovery(false);
    await page.$eval('#ai-takeover-allowed', e => e.scrollIntoView({ block: 'center' })); await page.click('#ai-takeover-allowed');
    const saved = page.waitForResponse(r => r.url().endsWith('/api/settings') && r.request().method() === 'POST');
    await page.click('[data-ai-takeover-save]'); assert.equal((await (await saved).json()).allowAiTakeover, false);
    await stop(); await start(); await open();
    assert.equal(await page.$eval('#recovery-enabled', e => e.checked), false, 'saved recovery off survives actual restart');
    assert.equal(await page.$eval('#recovery-enabled', e => e.disabled), false, 'recovery can be re-enabled after restart');
    assert.equal(await page.$eval('#ai-takeover-allowed', e => e.checked), false, 'saved host opt-out remains respected');
    await recovery(true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, 'logs/recovery-settings.json'), 'utf8')).enabled, true);
    fs.mkdirSync('.cache/default-recovery-20261026', { recursive: true });
    await page.screenshot({ path: '.cache/default-recovery-20261026/recovery-enabled.png' });
  } catch (error) {
    for (const page of await browser?.pages() || []) logs += '\nPAGE STATE: ' + await page.evaluate(() => document.body.innerText.slice(-3000)).catch(() => 'unavailable');
    throw error;
  } finally { fs.writeFileSync('.cache/default-recovery-20261026/process.log', logs); await browser?.close(); await stop(); fs.rmSync(fixture, { recursive: true, force: true }); }
});
