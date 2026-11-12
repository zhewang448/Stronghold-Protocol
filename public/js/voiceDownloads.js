// Download choices are independent of playback preferences and interface locale.
import { createStore, loadPref, savePref } from './store.js';
import { VOICE_PICKS, VOICE_TREES } from './voicePrefs.js';
import { normalizePreloadVoiceLang } from './resources/common.js';

export const DOWNLOAD_VOICE_TREES = Object.freeze({ cn: 'voice', ...VOICE_TREES });
const cleanLanguages = (value) => VOICE_PICKS.filter((lang) => Array.isArray(value) && value.includes(lang));

export function sanitizeVoiceDownloads(raw) {
  const operators = {};
  for (const [id, langs] of Object.entries(raw?.operators || {}).slice(0, 512)) {
    if (/^char_[0-9]+_[a-z0-9]+$/.test(id) && Array.isArray(langs)) operators[id] = cleanLanguages(langs);
  }
  return { languages: Array.isArray(raw?.languages) ? cleanLanguages(raw.languages) : ['cn'], operators };
}

/** Effective choices always include one available dub for a voiced operator, repairing older empty/stale choices. */
export function downloadVoiceLanguages(selection, charId, audio) {
  const requested = Object.hasOwn(selection.operators, charId) ? selection.operators[charId] : selection.languages;
  const available = audio == null ? VOICE_PICKS : VOICE_PICKS.filter((lang) => {
    const slots = audio[DOWNLOAD_VOICE_TREES[lang]]?.[charId];
    return slots && typeof slots === 'object' && !Array.isArray(slots) && Object.keys(slots).length > 0;
  });
  const selected = available.filter((lang) => requested.includes(lang));
  if (selected.length || !available.length) return selected;
  return [available.includes('cn') ? 'cn' : available[0]];
}

export function setDownloadVoice(selection, charId, lang, checked, audio) {
  const current = downloadVoiceLanguages(selection, charId, audio);
  const langs = VOICE_PICKS.filter((id) => id === lang ? checked : current.includes(id));
  // Keep the operator's last selected available language, rather than substituting another language.
  const retained = langs.length ? langs : current;
  return { ...selection, operators: { ...selection.operators, [charId]: retained } };
}

/** Apply to the entire server roster, including operators hidden by the search field. */
export function setDownloadVoiceLanguage(selection, audio, lang, checked) {
  const languages = VOICE_PICKS.filter((id) => id === lang ? checked : selection.languages.includes(id));
  let result = selection;
  for (const charId of Object.keys(audio?.[DOWNLOAD_VOICE_TREES[lang]] || {})) {
    result = setDownloadVoice(result, charId, lang, checked, audio);
  }
  return { ...result, languages };
}

export const voiceDownloadStore = createStore(sanitizeVoiceDownloads(loadPref('voiceDownloads', {
  languages: normalizePreloadVoiceLang(loadPref('settings', null)?.preloadVoiceLang ?? 'all'), operators: {},
})));
voiceDownloadStore.subscribe((selection) => savePref('voiceDownloads', sanitizeVoiceDownloads(selection)));

/** Resolve per-operator choices against the languages present in the preload manifest. */
export function preloadVoiceSelector(files, selection, languages) {
  const parts = file => /\/(?:audio\/)?voice\/(cn|jp|en|kr|native)\/(char_[0-9]+_[a-z0-9]+)(?:\/|_)/.exec(file.url);
  const audio = {};
  for (const file of files) {
    const match = parts(file);
    if (!match) continue;
    const tree = DOWNLOAD_VOICE_TREES[match[1]];
    audio[tree] ||= {};
    audio[tree][match[2]] = { available: true };
  }
  const settings = { ...selection, languages };
  const chosen = new Map();
  for (const bank of Object.values(audio)) for (const id of Object.keys(bank)) {
    chosen.set(id, !languages.length && !Object.hasOwn(selection.operators, id) ? [] : downloadVoiceLanguages(settings, id, audio));
  }
  return file => {
    const match = parts(file);
    return match ? chosen.get(match[2])?.includes(match[1]) === true : null;
  };
}
