import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { ClientPreference } from './clientPreference.js';
import { RadioGroup } from './radioGroup.js';
import { useStore } from '../store.js';
import { settingsStore } from './settingsStore.js';
import { audio } from '../audio.js';
import { terminalThemeState, selectTerminalTheme, animateTerminal, playTerminalVoice } from './terminalTheme.js';
import { TERMINAL_THEME, terminalAsset, terminalSprite } from '../../../shared/terminalTheme.js';
import { t, N_ } from '../../../shared/i18n.js';

const ACTIONS = [
  ['Idle', N_('待机')], ['Default', N_('初始姿态')], ['Happy', N_('高兴')], ['Interact', N_('互动')],
  ['Sad_Begin', N_('失落')], ['Sad_Idle', N_('低落')], ['Special_A', N_('庆祝')], ['Special_B', N_('得意')], ['Talk', N_('说话')],
];

export function TerminalCompanion({ fallback = null, class: cls = '' }) {
  const state = useStore(s => s, Object.is, terminalThemeState);
  const [Cover, setCover] = useState(null);
  useEffect(() => {
    if (state.active !== TERMINAL_THEME) return;
    let dead = false;
    import('./dynamicIllustration.js').then(module => { if (!dead) setCover(() => module.CoverIllustration); }).catch(() => {});
    return () => { dead = true; };
  }, [state.active]);
  if (state.active !== TERMINAL_THEME || !state.manifest) return fallback;
  const manifest = state.manifest;
  const entry = { skel: terminalAsset(manifest, manifest.spine.skel), atlas: terminalAsset(manifest, manifest.spine.atlas),
    bounds: manifest.spine.bounds, pma: manifest.spine.pma === true, anims: { idle: 'Idle' } };
  return html`<button type="button" class=${`terminal-companion ${cls}`} data-testid="terminal-companion" title=${t('试听主题语音')}
      aria-label=${t('试听主题语音')} onClick=${() => { audio._unlock(); animateTerminal('Interact'); playTerminalVoice('CN_003', true); }}>
    <img src=${terminalSprite(manifest, 'img_char_spine_outer')} width="113" height="96" alt=${t('“全能的”可露希尔')} />
    ${Cover ? html`<${Cover} entry=${entry} framing=${{ fit: 'contain' }} clip=${state.clip} />` : null}
  </button>`;
}

export function TerminalThemeSection() {
  const state = useStore(s => s, Object.is, terminalThemeState);
  const settings = useStore(s => s, Object.is, settingsStore);
  return html`<div class="terminal-settings" aria-busy=${state.status === 'loading' ? 'true' : 'false'}>
    <${ClientPreference} name="settings.terminalTheme"><div class="set-row terminal-settings__row">
      <span class="set-row__label">${t('终端主题')}</span>
      <${RadioGroup} label=${t('终端主题')} class="set-seg terminal-settings__choices" value=${state.status === 'loading' ? settings.terminalTheme : state.active}
        options=${[{ value: 'default', label: t('默认') }, { value: TERMINAL_THEME, label: t('“全能的”可露希尔') }]} onChange=${selectTerminalTheme} />
    </div><//>
    <p class="set-hint" role="status">${state.status === 'loading' ? t('正在载入主题…') : state.status === 'error'
      ? t('终端主题素材不可用，请重新安装后重试。') : t('主题保存在本机，可随时切回默认。')}</p>
    ${state.active === TERMINAL_THEME ? html`<div class="terminal-settings__preview">
      <${TerminalCompanion} />
      <div class="terminal-settings__actions">
        <label>${t('角色动作')}<select value=${state.clip} onChange=${event => animateTerminal(event.currentTarget.value)}>
          ${ACTIONS.map(([id, label]) => html`<option key=${id} value=${id}>${t(label)}</option>`)}
        </select></label>
        <button class="btn btn--secondary btn--sm" type="button" onClick=${() => { audio._unlock(); animateTerminal('Happy'); playTerminalVoice('CN_001', true); }}>
          <${Icon} name="volume" />${t('试听主题语音')}</button>
        <${ClientPreference} name="settings.terminalVoice"><label class="terminal-settings__voice">
          <input type="checkbox" checked=${settings.terminalVoice} onChange=${event => settingsStore.set({ terminalVoice: event.currentTarget.checked })} />${t('对局主题语音')}
        </label><//>
      </div>
    </div>` : null}
  </div>`;
}
