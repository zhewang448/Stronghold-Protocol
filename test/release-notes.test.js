import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReleaseNotes, parseReleaseHistory, readReleaseHistory } from '../server/release-notes.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shouldShowReleaseNotes } from '../public/js/ui/releaseNotes.js';

test('release notes select only current player content and never testing results', () => {
  const notes = parseReleaseNotes('## date — v1：title\n- 玩家功能\n- 发布全量验证：123\n- golden 与工具链：298\n\n## date — v0：old\n- old', 'v1');
  assert.deepEqual(notes.entries, ['玩家功能']);
  assert.deepEqual(parseReleaseNotes('', 'v1').entries, []);
  assert.equal(shouldShowReleaseNotes(null, 'v1'), false);
  assert.equal(shouldShowReleaseNotes('v1', 'v1'), false);
  assert.equal(shouldShowReleaseNotes('v0', 'v1'), true);
});

test('history retains every release and multiline prose in document order', () => {
  const markdown = ['## 0.3.3 — date', '### Fixes', '- **New** [feature](https://example.com)', '  continued', '## 0.1.0 — date', 'Old paragraph', '- oldest'].join(String.fromCharCode(10));
  const history = parseReleaseHistory(markdown, { upstream: true });
  assert.deepEqual(history.map(r => r.version), ['0.3.3', '0.1.0']);
  assert.deepEqual(history[0].entries, ['New feature continued']);
  assert.deepEqual(history[1].entries, ['Old paragraph', 'oldest']);
});

test('extension history includes unversioned records and omits validation output', () => {
  const history = parseReleaseHistory(['## date — development', '- feature', '- 发布全量验证：123', '  test details', '## date — v0.3.3-extended.1：release', '- shipped'].join(String.fromCharCode(10)));
  assert.equal(history[0].version, '');
  assert.deepEqual(history[0].entries, ['feature']);
  assert.equal(history[1].version, 'v0.3.3-extended.1');
  assert.deepEqual(readReleaseHistory('/nonexistent-release-history-root'), { upstream: [], extension: [] });
});

test('installed history covers both complete source documents and permanent entry points', () => {
  const root = new URL('../', import.meta.url);
  const history = readReleaseHistory(fileURLToPath(root));
  for (const [source, file] of [['upstream', 'CHANGELOG.md'], ['extension', 'docs/LOCAL-CHANGELOG.md']]) {
    const headings = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').match(/^## /gm);
    assert.equal(history[source].length, headings.length);
    assert.ok(history[source].every(r => r.title && r.entries.length));
  }
  assert.equal(history.upstream[0].version, '0.3.3');
  assert.equal(history.upstream.at(-1).version, '0.1.0');
  for (const screen of ['title', 'lobby']) assert.match(fs.readFileSync(new URL('../public/js/screens/' + screen + '.js', import.meta.url), 'utf8'), /ReleaseHistoryButton/);
});
