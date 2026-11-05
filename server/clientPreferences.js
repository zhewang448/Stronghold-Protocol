import { CLIENT_PREFERENCE_FIELDS, defaultClientPreferencePolicy, normalizeClientPreferencePolicy } from '../shared/clientPreferences.js';
export { CLIENT_PREFERENCE_FIELDS };
let config = defaultClientPreferencePolicy();
export const getClientPreferencePolicy = () => structuredClone(config);
export const validateClientPreferencePolicy = value => normalizeClientPreferencePolicy(value, config);
export function setClientPreferencePolicy(value) {
  const result = validateClientPreferencePolicy(value);
  if (result.error) return result;
  config = result.config; return { ok: true };
}
export function clientPreferenceFrame() {
  return JSON.stringify(config) === JSON.stringify(defaultClientPreferencePolicy()) ? null : getClientPreferencePolicy();
}
export function resetClientPreferencePolicy() { config = defaultClientPreferencePolicy(); }
