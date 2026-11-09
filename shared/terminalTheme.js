// Optional presentation only. Official ac_s_closur metadata: activity_table at
// closure-studio/ArknightsGamedataPure 080bc918; art: official Android 2026-11-06.
export const TERMINAL_THEME = 'ac_s_closur';
export const TERMINAL_THEME_BASE = '/assets/terminal-themes/ac_s_closur/';
export const normalizeTerminalTheme = value => value === TERMINAL_THEME ? value : 'default';

const relativeFile = value => typeof value === 'string' && value.length <= 180
  && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(value)
  && value.split('/').every(part => part !== '.' && part !== '..');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function terminalAsset(manifest, relative) {
  if (!relativeFile(relative)) return null;
  const file = manifest?.files?.[relative];
  if (!file || !/^[a-f0-9]{64}$/.test(file.sha256)) return null;
  return TERMINAL_THEME_BASE + relative + '?v=' + file.sha256.slice(0, 16);
}
export const terminalSprite = (manifest, name) => terminalAsset(manifest, manifest?.sprites?.[name]);

/** Reject paths/URLs and incomplete installs before their values reach CSS or Pixi. */
export function validTerminalManifest(manifest) {
  if (!record(manifest) || manifest.version !== 1 || manifest.id !== TERMINAL_THEME
      || !record(manifest.files) || Object.keys(manifest.files).length > 1024 || !record(manifest.sprites)) return false;
  if (!Object.entries(manifest.files).every(([path, file]) => relativeFile(path) && record(file)
      && Number.isInteger(file.bytes) && file.bytes > 0 && file.bytes <= 32 * 1024 * 1024
      && /^[a-f0-9]{64}$/.test(file.sha256))) return false;
  if (!['img_char_spine_outer', 'rest_window_back', 'battle_window_back', 'boss_window_back_begin', 'bg_open', 'img_closure']
    .every(name => terminalSprite(manifest, name))) return false;
  const spine = manifest.spine;
  if (!spine || !terminalAsset(manifest, spine.skel) || !terminalAsset(manifest, spine.atlas)
      || !terminalAsset(manifest, 'spine/mascot.png') || !Array.isArray(manifest.animations)
      || !manifest.animations.includes('Idle') || manifest.animations.length > 32) return false;
  const bounds = spine.bounds;
  if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) || bounds.width <= 0 || bounds.height <= 0) return false;
  return ['cn', 'jp'].every(lang => record(manifest.voices?.[lang]) && Object.keys(manifest.voices[lang]).length === 19
    && Object.entries(manifest.voices[lang]).every(([id, path]) => /^CN_\d{3}$/.test(id) && terminalAsset(manifest, path)));
}
