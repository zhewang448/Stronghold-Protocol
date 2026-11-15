// The lobby shares the installed theme character and playback lifecycle with the in-match funds card.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon } from './components.js';
import { settingsStore } from './settingsStore.js';
import { useStore } from '../store.js';
import { themePack, previewThemeVoice } from '../uiTheme.js';
import { mountThemeCharacter } from './themeCharacter.js';
import { data, useData } from '../data.js';
import { regulationCharacter } from './regHud.js';
import { themeCharacterKey } from '../../../shared/uiTheme.js';
import { t, N_ } from '../../../shared/i18n.js';

const ACTIONS = [['Idle', N_('待机')], ['Default', N_('初始姿态')], ['Happy', N_('高兴')], ['Interact', N_('互动')],
  ['Sad_Begin', N_('失落')], ['Sad_Idle', N_('低落')], ['Special_A', N_('庆祝')], ['Special_B', N_('得意')], ['Talk', N_('说话')]];

export function ThemeCompanion({ fallback = null, preview = false }) {
  const host = useRef(null);
  const controller = useRef(null);
  const [animations, setAnimations] = useState([]);
  const [clip, setClip] = useState('Idle');
  const settings = useStore(s => s, Object.is, settingsStore);
  useData('local');
  const character = themePack(settings.uiTheme)?.character || null;
  const shown = character ? regulationCharacter(data.get('local')?.groups, character) : null;
  const characterKey = themeCharacterKey(shown);
  useEffect(() => {
    controller.current = null;
    setAnimations([]);
    if (!shown || !host.current) return undefined;
    const dispose = mountThemeCharacter(host.current, shown, { onReady: value => { controller.current = value; setAnimations(value.animations); } });
    return () => { controller.current = null; dispose(); };
  }, [characterKey, settings.dynamicIllustrations, settings.themeMotion]);
  if (!shown) return fallback;
  return html`<div class=${preview ? 'theme-preview' : 'theme-lobby-character'}>
    <button type="button" class="theme-companion" ref=${host} onClick=${() => previewThemeVoice()} aria-label=${t('试听主题语音')}></button>
    ${preview ? html`<div class="theme-preview__controls">
      ${animations.length ? html`<label>${t('角色动作')}<select value=${clip} onChange=${event => { const value = event.currentTarget.value; setClip(value); controller.current?.play(value); }}>
        ${ACTIONS.filter(([id]) => animations.includes(id)).map(([id, label]) => html`<option value=${id}>${t(label)}</option>`)}</select></label>` : null}
      <${Button} variant="secondary" size="sm" onClick=${() => previewThemeVoice()}><${Icon} name="volume" />${t('试听主题语音')}<//>
    </div>` : null}
  </div>`;
}
