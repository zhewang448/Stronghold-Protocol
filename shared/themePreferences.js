// Presentation-only migration. Explicit current values win over the retired terminal theme keys.
export function normalizeUiTheme(value) {
  if (value === '' || value === 'terminal' || value === 'default' || value == null) return '';
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(value) ? value : '';
}

export function migrateThemePreferences(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  if (!Object.hasOwn(value, 'uiTheme') && Object.hasOwn(value, 'terminalTheme')) value.uiTheme = normalizeUiTheme(value.terminalTheme);
  if (!Object.hasOwn(value, 'themeVoice') && typeof value.terminalVoice === 'boolean') value.themeVoice = value.terminalVoice;
  delete value.terminalTheme;
  delete value.terminalVoice;
  return value;
}
