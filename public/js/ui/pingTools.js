import { useRef } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { PingIcon, PING_LABELS } from './fieldPings.js';
import { PING_KINDS } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';
import { usePingDock } from './hudDock.js';
import { useHudPosition } from './chatPosition.js';
import { EmoteBarrageCells } from './emoteBarrage.js';

/**
 * The in-match signal bar. `signalBar` / `barrage` are the host console's switches (welcome + site.settings,
 * store.js): the 表情弹幕 cells are appended AFTER the original 标点 buttons, and with `signalBar` off the original
 * buttons are hidden while the two cells stay. A server that never set either keeps today's bar.
 */
export function PingTools({ collapsed, onCollapse, kind, armed, onSelect, onDrag, view, rect, prep,
  signalBar = true, barrage = false, barrageDisabled = false, onBarrage = null }) {
  const ref = useRef(null);
  usePingDock(ref, view, rect, prep, [collapsed]);
  const placement = useHudPosition({ preferenceKey: 'pingPosition', active: true, open: !collapsed, anchorRef: ref, automatic: true, onDrag });
  const signals = signalBar;
  const cells = barrage;
  return html`<div ref=${ref} class=${`gm__ping-tools${collapsed ? ' is-collapsed' : ''}`} role="group" aria-label=${t('战场标点')}>
    ${collapsed ? null : html`<div class="gm__ping-content" id="field-ping-palette">
      ${signals ? html`<span class="gm__ping-hint">${armed ? t('点击格子发送标点') : t('选择标记，或右键地面')}</span>` : null}
      <div class="gm__ping-buttons">
        ${signals ? PING_KINDS.map(k => html`<button key=${k} type="button" class=${`gm__ping-btn gm__ping-btn--${k}${kind === k ? ' is-on' : ''}`}
          aria-label=${t(PING_LABELS[k])} aria-pressed=${kind === k && armed} title=${t(PING_LABELS[k])}
          onKeyDown=${e => { if (e.key !== 'Escape') e.stopPropagation(); }} onClick=${() => onSelect(k)}><${PingIcon} kind=${k} /></button>`) : null}
      </div>
      ${signals ? html`<span class="gm__ping-scroll-hint">${t('左右滑动')}</span>` : null}
    </div>`}
    ${!collapsed && cells ? html`<${EmoteBarrageCells} disabled=${barrageDisabled} onSend=${onBarrage} />` : null}
    <button type="button" class="gm__ping-toggle" aria-expanded=${!collapsed} aria-controls="field-ping-palette"
      aria-label=${collapsed ? t('展开标点') : t('收起标点')} title=${t('点击收起或展开，拖动调整位置')}
      ...${placement.events}
      onKeyDown=${e => { placement.events.onKeyDown(e); e.stopPropagation(); }}
      onClick=${e => { if (!placement.draggedClick(e)) onCollapse(!collapsed); }}><${Icon} name=${collapsed ? 'chevronRight' : 'chevronLeft'} /></button>
    <button type="button" class="gm__ping-reset" title=${t('恢复标点位置')} aria-label=${t('恢复标点位置')}
      onClick=${placement.reset}><${Icon} name="refresh" /></button>
  </div>`;
}
