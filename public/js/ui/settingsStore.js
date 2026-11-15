// Shared preference state without loading the settings modal / audio just to read image visibility.
// The preference store owns the saved layer; settings.js applies audio / document effects.
import { createClientPreferenceStore } from '../clientPreferences.js';
import { migrateClientSettings } from '../../../shared/clientPreferences.js';
import { sanitizeSettings } from './gameLogic/settings.js';

/** The saved preference layer includes uiTheme, themeVoice and themeMotion; host policy never erases personal choices. */
export const settingsStore = createClientPreferenceStore({ prefix: 'settings', preference: 'settings', normalize: sanitizeSettings, migrate: migrateClientSettings });
