import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { migrateThemePreferences } from '../../shared/themePreferences.js';
import { normalizeClientPreferencePolicy } from '../../shared/clientPreferences.js';
import { createClientPreferenceStore, setClientPreferencePolicy } from '../../public/js/clientPreferences.js';

test('old theme choices and silent default migrate once; explicit new settings win', () => {
  const old = { terminalTheme: 'ac_s_closur', terminalVoice: true, textSize: 'xl' };
  const migrated = migrateThemePreferences(old);
  assert.deepEqual(migrateThemePreferences(migrated), migrated);
  assert.equal(sanitizeSettings(old).uiTheme, 'ac_s_closur');
  assert.equal(sanitizeSettings(old).themeVoice, true);
  assert.equal(sanitizeSettings({}).themeVoice, false);
  assert.equal(sanitizeSettings({ ...old, uiTheme: '', themeVoice: false }).uiTheme, '');
  assert.equal(sanitizeSettings({ ...old, uiTheme: '', themeVoice: false }).themeVoice, false);
  assert.equal(sanitizeSettings({ uiTheme: '../other' }).uiTheme, '');
  assert.equal(sanitizeSettings({ uiTheme: 'my_local_theme' }).uiTheme, 'my_local_theme');
  assert.equal(sanitizeSettings(old).textSize, 'xl');
  assert.equal(Object.hasOwn(migrated, 'terminalTheme'), false);
  assert.deepEqual(old, { terminalTheme: 'ac_s_closur', terminalVoice: true, textSize: 'xl' });
});

test('legacy host policy maps to the new field; unlocking restores the personal theme', t => {
  t.after(() => setClientPreferencePolicy(null));
  const normalized = normalizeClientPreferencePolicy({
    defaults: { 'settings.terminalTheme': 'ac_n_iron', 'settings.terminalVoice': false },
    userControls: { 'settings.terminalTheme': false },
  });
  assert.equal(normalized.error, undefined);
  assert.equal(normalized.config.defaults['settings.uiTheme'], 'ac_n_iron');
  const saved = createClientPreferenceStore({ prefix: 'settings', preference: 'theme-migration-fixture',
    initial: { terminalTheme: 'ac_s_closur', terminalVoice: true }, normalize: sanitizeSettings, migrate: migrateThemePreferences });
  setClientPreferencePolicy(normalized.config);
  assert.equal(saved.get().uiTheme, 'ac_n_iron');
  saved.set({ uiTheme: '' });
  assert.equal(saved.saved().uiTheme, 'ac_s_closur');
  setClientPreferencePolicy({ userControls: { 'settings.uiTheme': true } });
  assert.equal(saved.get().uiTheme, 'ac_s_closur');
});
