import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { getBond, useData } from '../data.js';
import { t, tName } from '../../../shared/i18n.js';
import { drawRoundChart, drawUnitRounds } from './roundChart.js';
import { useLang } from './lang.js';
import { hudFrame, useHudMeasure } from './hudDock.js';

/** One modeless view for live, settled and locally stored round history. */
export function RoundHistoryPanel({ history = [], players = [], poolGroups = [], viewerId = '', onClose, initialTab = 'chart' }) {
  const ready = useData('bonds');
  const lang = useLang();
  const snapshot = JSON.stringify([history, players.map((p) => [p.playerId, p.name, p.seat]), poolGroups, viewerId]);
  const host = useRef(null), close = useRef(null);
  const panel = useRef(null);
  const [chartSize, setChartSize] = useState({ width: 0, fontSize: 12 });
  const measure = () => {
    const element = panel.current, frame = hudFrame(element);
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 40;
    const liveBar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--live-bar-height')) || 0;
    const top = Math.max(frame.top, 60, rem * .9, liveBar);
    const left = Math.max(frame.left, 12);
    element.style.setProperty('--round-history-top', `${top}px`);
    element.style.left = `${left}px`;
    element.style.maxWidth = `${Math.max(0, frame.right - left)}px`;
    element.style.maxHeight = `${Math.max(0, frame.bottom - top)}px`;
    const body = host.current;
    if (body) {
      const style = getComputedStyle(body), compact = getComputedStyle(element).getPropertyValue('--round-history-compact').trim() === '1';
      const width = compact ? Math.floor(body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) : 0;
      const fontSize = compact ? Math.max(12, parseFloat(style.fontSize)) : 12;
      setChartSize(previous => previous.width === width && previous.fontSize === fontSize ? previous : { width, fontSize });
    }
  };
  useHudMeasure(panel, measure, []);
  // Font/language changes may leave an already height-constrained panel's outer box unchanged.
  useLayoutEffect(measure);
  const chartState = useRef({ metric: 'lp', table: false, round: null, player: '', all: false, cumulative: false });
  const rankState = chartState;
  const [tab, setTab] = useState(initialTab);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    const escape = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.modal, .guide')) onClose();
    };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('keydown', escape); previous?.focus?.(); };
  }, []);
  useEffect(() => {
    const names = new Map(players.map((p) => [p.playerId, p.name]));
    const nameOf = (id) => names.get(id) || id;
    const options = { name: tName, players, poolGroups, viewerId };
    if (tab === 'units') drawUnitRounds(host.current, history, nameOf, rankState.current, options);
    else drawRoundChart(host.current, history, nameOf, chartState.current, { ...options, bondRecord: getBond, ...chartSize });
  }, [snapshot, ready, lang, tab, chartSize]);
  return html`<section ref=${panel} id="round-history-panel" class="round-history brackets" role="dialog" aria-label=${t('每回合统计')}
    onKeyDown=${(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
    <header class="round-history__head"><h2>${t('每回合统计')}</h2>
      <button ref=${close} type="button" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
    </header>
    <div class="round-history__tabs" role="group" aria-label=${t('统计内容')}>
      <button type="button" aria-pressed=${tab === 'chart'} onClick=${() => setTab('chart')}>${t('每回合曲线')}</button>
      <button type="button" aria-pressed=${tab === 'units'} onClick=${() => setTab('units')}>${t('干员伤害排行')}</button>
    </div>
    ${history.some((h) => h.live) ? html`<p class="round-history__live" role="status">${t('当前回合实时更新，结算前仅供参考。')}</p>` : null}
    <div ref=${host} class="round-history__body"></div>
    ${tab === 'units' ? html`<p class="round-history__note">${t('伤害是实际扣掉的敌人血量（不算溢出），只算各自战场；召唤物不单列。')}</p>` : null}
  </section>`;
}
