// Shared preference state without loading the settings modal / audio just to read image visibility.
// The preference store owns the saved layer; settings.js applies audio / document effects.
import { createClientPreferenceStore } from '../clientPreferences.js';
import { migrateClientSettings } from '../../../shared/clientPreferences.js';
import { sanitizeSettings } from './gameLogic/settings.js';

/** Settings store: { bgm, sfx, voice, voiceLang, voiceNative, voiceOverrides, muted, damageNumbers, officialDamageNumbers, ammoEnergyCount, fullscreenWakeLock, bondTimers, combatMetrics, prepDeployFold, quality, officialFx, otherSkins, upstreamReleaseNotes, extensionReleaseNotes, textSize, keys }. */
export const settingsStore = createClientPreferenceStore({ prefix: 'settings', preference: 'settings', normalize: sanitizeSettings, migrate: migrateClientSettings });
