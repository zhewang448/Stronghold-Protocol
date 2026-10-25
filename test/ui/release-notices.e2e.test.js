import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('automatic release notices show only changed enabled sources and acknowledge only rendered sources', { skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000 }, async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, recovery: false });
  let browser;
  try {
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
    const page = await browser.newPage(); await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
    const cases = await page.evaluate(async () => {
      const { showReleaseNotes } = await import('/js/ui/releaseNotes.js');
      const results = [];
      for (const [label, prevExt, prevUp, preferences, expected] of [
        ['extension only', 'v0.3.3-extended.1', '0.3.3', {}, ['extension']],
        ['upstream only', 'v0.3.3-extended.2', '0.3.2', {}, ['upstream']],
        ['both', 'v0.3.2-extended.1', '0.3.2', {}, ['upstream', 'extension']],
        ['extension disabled', 'v0.3.2-extended.1', '0.3.2', { extensionReleaseNotes: false }, ['upstream']],
        ['upstream disabled', 'v0.3.2-extended.1', '0.3.2', { upstreamReleaseNotes: false }, ['extension']],
        ['both disabled', 'v0.3.2-extended.1', '0.3.2', { upstreamReleaseNotes: false, extensionReleaseNotes: false }, []],
        ['first install', null, null, {}, []],
        ['legacy migration', 'v0.3.2-extended.1', null, {}, ['upstream', 'extension']],
      ]) {
        document.querySelector('dialog[data-release-notes]')?.close();
        const saved = new Map(); if (prevExt) saved.set('test.notice', prevExt); if (prevUp) saved.set('test.notice.upstream', prevUp);
        const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
        const dialog = showReleaseNotes({ version: 'v0.3.3-extended.2', entries: ['extension content'] }, { upstream: { version: '0.3.3', entries: ['upstream content'] }, storage, storageKey: 'test.notice', preferences });
        const sources = dialog ? [...dialog.querySelectorAll('[data-release-source]')].map(e => e.dataset.releaseSource) : [];
        const before = Object.fromEntries(saved);
        if (dialog) { const closed = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('close event timeout: ' + label)), 3000); dialog.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true }); }); dialog.close(); await closed; }
        results.push({ label, sources, expected, before, after: Object.fromEntries(saved) });
      }
      return results;
    });
    for (const row of cases) {
      assert.deepEqual(row.sources, row.expected, row.label);
      for (const source of row.sources) assert.equal(row.after[source === 'extension' ? 'test.notice' : 'test.notice.upstream'], source === 'extension' ? 'v0.3.3-extended.2' : '0.3.3', row.label);
      if (row.label === 'extension disabled') assert.equal(row.after['test.notice'], row.before['test.notice']);
      if (row.label === 'upstream disabled') assert.equal(row.after['test.notice.upstream'], row.before['test.notice.upstream']);
    }
  } finally { await browser?.close(); await srv.close(); }
});
