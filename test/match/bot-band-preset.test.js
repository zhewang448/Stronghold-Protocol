import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

for (const conflict of [false, true]) test(`designated AI strategy handles human conflict: ${conflict}`, (context) => {
  const seats = [
    { seat: 0, playerId: 'human', name: 'Human', isBot: false, connected: true },
    { seat: 1, playerId: 'bot', name: 'Bot', isBot: true, connected: true, botBand: 'band_amiya' },
  ];
  const harness = makeMatch({ seats, fake: true, aiPicksLast: true, hostId: 'human' }).start();
  context.after(() => harness.m.dispose());
  harness.m.handle('human', { t: 'g.infoReady' });
  harness.sched.advance(1);
  assert.equal(harness.m.phase, PHASE.BAND_DRAFT);
  assert.deepEqual(harness.m.handle('human', { t: 'g.band', bandId: conflict ? 'band_amiya' : 'band_bldsk' }), { ok: true });
  harness.sched.advance(1);
  assert.equal(harness.m.players.get('bot').bandId === 'band_amiya', !conflict);
  if (conflict) assert.ok(harness.sent.some(([id, frame]) => id === 'human' && frame.msgid === 'AI 队友 {name} 的预设策略不可用，已自动改选'));
});
