import { html } from './components.js';
import { useStore } from '../store.js';
import { clientPreferencePolicy } from '../clientPreferences.js';
import { t } from '../../../shared/i18n.js';

/** A native disabled fieldset also protects range inputs, selects and keyboard
 * activation. The saved preference never changes while this boundary is locked. */
export function ClientPreference({ name, children, class: cls = '' }) {
  const controls = useStore(s => s.config.userControls, Object.is, clientPreferencePolicy);
  if (!name) return children;
  const names = Array.isArray(name) ? name : [name];
  const locked = names.some(key => controls[key] === false);
  return html`<div class=${`client-preference ${cls}`} data-client-preference=${names.join(' ')} data-locked=${String(locked)}>
    <fieldset class="client-preference__control" disabled=${locked} aria-label=${locked ? t('主机管理的设置') : undefined}>${children}</fieldset>
    ${locked ? html`<p class="set-hint client-preference__hint" role="note">${t('由主机控制，允许自行修改后恢复你的设置。')}</p>` : null}
  </div>`;
}
