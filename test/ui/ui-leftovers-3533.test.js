// test/ui/ui-leftovers-3533.test.js — the §35.18 UI leftovers fixed in 0.3.2 (DESIGN §35.51), pinned in the stylesheets
// and the markup; the browser checks are test/ui/room-fit.e2e.test.js and lobby-hub.e2e.test.js (text-fit) and the
// measurements in §35.51.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (text, head) => {
  const i = text.indexOf(head);
  assert.ok(i >= 0, head);
  let depth = 0;
  for (let j = text.indexOf('{', i); j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  return text.slice(i);
};

test('the 机变 overlay leaves the corner\'s buttons uncovered: they wrap within its 2.8rem column, a phone\'s overlay starts past them', () => {
  const panels = css('public/css/screens/game-panels.css');
  assert.match(panels, /\.spov \{ position: absolute; inset: 0 0 0 2\.8rem;/);
  assert.match(block(panels, '@media (min-width: 768px) {\n  .gm.has-sp .gm__corner'),
    /\.gm\.has-sp \.gm__corner \{ flex-wrap: wrap-reverse; align-content: flex-start; max-width: calc\(2\.8rem - \.24rem - \.1rem\); \}/);
  const dev = css('public/css/devices.css');
  // the coarse phone's overlay starts past the corner's wrapped width (measured in the browser: mock.e2e's 「the 机变
  // overlay leaves every corner button clickable」, elementFromPoint at each button's centre, wide windows and a phone)
  assert.match(dev, /\.gm\.has-sp > \.spov \{ left: calc\(max\(2\.8rem,/);
  assert.match(dev, /\.gm\.is-collapsed\.has-sp \.gm__corner \{ flex-wrap: wrap-reverse;/);
});

test('local protocol and room controls preserve responsive layout and plugin exit feedback',()=>{
 const lobby=readFileSync(path.join(ROOT,'public/js/screens/lobby.js'),'utf8');
 const room=readFileSync(path.join(ROOT,'public/js/screens/room.js'),'utf8');
 const styles=css('public/css/screens/lobby.css')+css('public/css/reference-mobile.css');
 assert.match(lobby,/const openCoopCreate/);assert.match(lobby,/setSheetOpen/);
 assert.match(styles,/@media/);assert.match(styles,/proto/);assert.match(styles,/hub-entry/);
 assert.match(room,/savePref\('lobby\.difficulty', difficulty\)/);
 assert.match(room,/已退出插件模式/);assert.match(room,/setPicker\(false\)/);
});
test('local screen typography retains user-size variables and explicit small-screen controls',()=>{
 for(const file of ['lobby','room','draft','game','loadout'])assert.match(css('public/css/screens/'+file+'.css'),/var\(--t\)|var\(--utility-text/);
 assert.match(css('public/css/reference-mobile.css'),/round-history/);
 assert.match(css('public/css/screens/lobby.css'),/rseat/);
});
test('local draft and room portraits retain default fallbacks after failed outfit images',()=>{
 const draft=readFileSync(path.join(ROOT,'public/js/screens/bandDraft.js'),'utf8');
 const room=readFileSync(path.join(ROOT,'public/js/screens/room.js'),'utf8');
 assert.match(draft,/seatArtSrc\(arts, failed\)/);assert.match(draft,/setFailed/);
 assert.match(room,/portraitDefault/);assert.match(room,/bad !== portraitDefault/);
});
