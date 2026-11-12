import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from '../ui/components.js';
import { UnitThumb } from '../ui/gameComponents.js';
import { niceScale, roundChartLayout } from '../ui/roundChart.js';
import { playerSeatColor } from '../ui/playerSeries.js';
import { t, N_ } from '../../../shared/i18n.js';
import { data } from '../data.js';
import { Comparison } from './ui.js';
import { damageComposition, formatResultNumber as number, rankedResultRows, resultCurve } from './resultModel.js';

const TYPES = { phys: N_('物理'), arts: N_('法术'), true: N_('真实'), elemental: N_('元素') };
const METRICS = [['damage', N_('伤害')], ['healing', N_('治疗')], ['taken', N_('承伤')], ['kills', N_('击杀')]];
function Amount({ value, suffix = '' }) {
  return html`<span class="trp-number" title=${number(value, { compact: false })}>${number(value)}${suffix}</span>`;
}
export function reportStatus(value, doc, live = false) {
  if (live) return t('演练进行中');
  if (value.bossHpLeft === 0 && value.bossHpMax) return t('领袖已击破');
  if (value.reason === 'timeout') return t('达到测试时限');
  if (doc.mode === 'unit' && value.killed === value.total && value.total > 0) return t('木桩已击破');
  if (value.leaks > 0) return t('波次结束，有漏怪');
  if (value.reason === 'cleared') return t('敌人已清除');
  return t('战斗结束');
}
function Composition({ value }) {
  const rows = damageComposition(value);
  return html`<section class="trp-composition" data-testid="training-damage-composition"><h3>${t('伤害构成')}</h3>
    <div class="trp-type-bar" role="img" aria-label=${rows.map(r => `${t(TYPES[r.type])} ${number(r.value, { compact: false })} (${number(r.share, { percent: true })})`).join('，')}>
      ${rows.map(r => html`<span key=${r.type} class=${`combat-metrics__segment--${r.type}`} style=${{ width: `${r.share}%` }}></span>`)}</div>
    <dl>${rows.map(r => html`<div key=${r.type}><dt><i class=${`combat-metrics__type--${r.type}`}></i>${t(TYPES[r.type])}</dt><dd><${Amount} value=${r.value} /><small>${number(r.share, { percent: true })}</small></dd></div>`)}</dl>
  </section>`;
}
function Ranking({ value, metric, setMetric, onSelect }) {
  const rows = rankedResultRows(value, metric);
  return html`<section class="trp-ranking"><div class="trp-section-head"><h3>${t('干员贡献')}</h3><select aria-label=${t('排行指标')} value=${metric} onChange=${e => setMetric(e.currentTarget.value)}>
    ${METRICS.map(([key, label]) => html`<option key=${key} value=${key}>${t(label)}</option>`)}</select></div>
    <ol>${rows.map(row => html`<li key=${row.key}><button type="button" data-testid="training-ranking-row" onClick=${() => onSelect(row)}>
      <${UnitThumb} kind=${row.kind === 'token' ? 'token' : 'chess'} id=${row.defId} ownerId=${row.ownerId} rec=${row.picture?.charId ? { ...row.picture, name: row.name } : null} showTier=${false} size="sm" />
      <div class="trp-row-body"><div class="trp-row-name"><span>${data.localeName(row.name)}<small>${row.ownerId === 'console-2' ? t('阵地 {n}', { n: 2 }) : ''}</small></span><b><${Amount} value=${row[metric] || 0} /></b></div>
        <div class="trp-unit-bar" aria-hidden="true">${metric === 'damage' ? damageComposition({ damage: value.damage, rows: [row] }).map(r => html`<i key=${r.type} class=${`combat-metrics__segment--${r.type}`} style=${{ width: `${(row[metric] > 0 ? r.value / row[metric] : 0) * row.width}%` }}></i>`)
          : html`<i class=${`trp-metric-${metric}`} style=${{ width: `${row.width}%` }}></i>`}</div>
        <div class="trp-row-extra"><span>${t('占比')} ${number(row.share, { percent: true })}</span><span>${metric === 'healing' ? 'HPS' : 'DPS'} <${Amount} value=${metric === 'healing' ? row.hps : row.dps} /></span></div>
      </div></button></li>`)}</ol>
  </section>`;
}
function UnitTable({ value, metric, setMetric, onSelect }) {
  const rows = rankedResultRows(value, metric);
  return html`<section class="trp-unit-detail"><div class="trp-section-head"><h3>${t('单位明细')}</h3><select aria-label=${t('明细排序')} value=${metric} onChange=${e => setMetric(e.currentTarget.value)}>
    ${METRICS.map(([key, label]) => html`<option key=${key} value=${key}>${t(label)}</option>`)}</select></div>
    <div class="trp-table-scroll"><table class="trp-unit-table" data-testid="training-unit-table"><thead><tr><th>${t('干员')}</th><th>${t('总伤害')}</th><th>DPS</th><th>${t('有效治疗')}</th><th>HPS</th><th>${t('承伤')}</th><th>${t('击杀')}</th><th>${t('攻击次数')}</th></tr></thead>
      <tbody>${rows.map(row => html`<tr key=${row.key}><th scope="row"><button type="button" onClick=${() => onSelect(row)}>${data.localeName(row.name)}${value.rows.some(r => r.ownerId !== row.ownerId) ? ` · ${row.ownerId === 'console-2' ? '2' : '1'}` : ''}</button></th>
        ${[row.damage, row.dps, row.healing, row.hps, row.taken || 0, row.kills || 0, row.attacks || 0].map((n, i) => html`<td key=${i}>${number(n, { compact: false })}</td>`)}</tr>`)}</tbody>
    </table></div><p class="trp-footnote">${t('召唤物计入所属干员；承伤包含生命流失，攻击次数为引擎记录的攻击动作数。')}</p>
  </section>`;
}
function ResultCurve({ values, onSeek }) {
  const [metric, setMetric] = useState('damage'), [cursor, setCursor] = useState(null);
  const host = useRef(null), [plotWidth, setPlotWidth] = useState(760);
  useEffect(() => {
    const measure = () => setPlotWidth(host.current?.clientWidth || 760);
    const observer = new ResizeObserver(measure); observer.observe(host.current); measure();
    return () => observer.disconnect();
  }, []);
  const lines = Object.entries(values).filter(([, value]) => value?.series?.length).map(([side, value]) => ({ side, color: playerSeatColor(side === 'A' ? 0 : 1), points: resultCurve(value.series, metric) }));
  const maxTime = Math.max(1, ...lines.flatMap(line => line.points.map(p => p.seconds))), scale = niceScale(Math.max(0, ...lines.flatMap(line => line.points.map(p => p.value))));
  const { width, height, left, right, top, bottom } = roundChartLayout(plotWidth, 5, 12);
  const x = seconds => left + seconds / maxTime * (width - left - right), y = n => height - bottom - n / scale.top * (height - top - bottom);
  const selectedTime = cursor === null ? maxTime : Math.min(cursor, maxTime);
  return html`<section ref=${host} class="trp-curve"><div class="trp-section-head"><h3>${t('输出时间曲线')}</h3><select aria-label=${t('曲线指标')} value=${metric} onChange=${e => setMetric(e.currentTarget.value)}>
      ${[['damage', t('累计伤害')], ['dps', t('区间 DPS')], ['healing', t('累计治疗')], ['hps', t('区间 HPS')], ['taken', t('累计承伤')]].map(([key, label]) => html`<option key=${key} value=${key}>${label}</option>`)}</select></div>
    <svg viewBox=${`0 0 ${width} ${height}`} role="img" aria-label=${t('随战斗时间变化的统计曲线')} data-testid="training-result-curve"
      onPointerMove=${e => { const rect = e.currentTarget.getBoundingClientRect(); setCursor(Math.max(0, Math.min(maxTime, ((e.clientX - rect.left) / rect.width * width - left) / (width - left - right) * maxTime))); }}>
      ${Array.from({ length: 5 }, (_, i) => scale.top * i / 4).map(n => html`<g key=${n}><line x1=${left} x2=${width - right} y1=${y(n)} y2=${y(n)} class="trp-chart-grid" /><text x=${left - 9} y=${y(n) + 4} text-anchor="end">${number(n)}</text></g>`)}
      ${Array.from({ length: 5 }, (_, i) => maxTime * i / 4).map(seconds => html`<text key=${seconds} x=${x(seconds)} y=${height - 10} text-anchor="middle">${number(seconds)}s</text>`)}
      ${lines.map(line => html`<path key=${line.side} d=${line.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.seconds)},${y(p.value)}`).join(' ')} fill="none" stroke=${line.color} stroke-width="2.5" />`)}
      <line x1=${x(selectedTime)} x2=${x(selectedTime)} y1=${top} y2=${height - bottom} class="trp-chart-cursor" />
    </svg>
    <div class="trp-curve-readout"><span>${number(selectedTime)}s</span>${lines.map(line => {
      const point = [...line.points].reverse().find(p => p.seconds <= selectedTime) || line.points[0];
      return html`<span key=${line.side} style=${{ color: line.color }}>${line.side} <b>${number(point?.value || 0, { compact: false })}</b></span>`;
    })}</div>
    <label class="trp-curve-time">${t('查看时刻')}<input type="range" min="0" max=${maxTime} step="0.1" value=${selectedTime} aria-label=${t('曲线时间')} onInput=${e => setCursor(+e.currentTarget.value)} /></label>
    ${onSeek ? html`<button type="button" onClick=${() => onSeek(selectedTime)}>${t('在战场定位此刻')}</button>` : null}
    <p class="trp-footnote">${t('按游戏秒采样；区间 DPS/HPS 为相邻采样点之间的平均值，包含未攻击的时间。')}</p>
  </section>`;
}
function Summary({ value, doc, live, stale }) {
  const remain = value.bossHpLeft ?? value.targetHpLeft, maximum = value.bossHpMax ?? value.targetHpMax;
  return html`<div class="trp-summary"><div class="trp-state" role="status"><span class=${`trp-state-dot${live ? ' is-live' : ''}`}></span>${stale ? t('配置已变更，待重新试算') : reportStatus(value, doc, live)}</div>
    <dl class="trp-primary-metrics" data-testid="training-result"><div><dt>${t('有效总伤害')}</dt><dd><${Amount} value=${value.damage} /></dd></div><div><dt>${t('全程平均 DPS')}</dt><dd><${Amount} value=${value.dps} /></dd></div></dl>
    <dl class="trp-secondary-metrics"><div><dt>${t('有效治疗')}</dt><dd><${Amount} value=${value.healing} /></dd></div><div><dt>HPS</dt><dd><${Amount} value=${value.hps || 0} /></dd></div>
      <div><dt>${t('总承伤')}</dt><dd><${Amount} value=${value.taken || 0} /></dd></div><div><dt>${t('作战用时')}</dt><dd>${number(value.seconds)} <small>/ ${number(value.testSeconds || doc.environment.seconds)}s</small></dd></div>
      <div><dt>${t('击杀 / 目标')}</dt><dd>${value.killed} / ${value.total}</dd></div><div><dt>${t('漏怪数')}</dt><dd>${doc.mode === 'team' ? value.leaks : '—'}</dd></div></dl>
    ${maximum > 0 ? html`<div class="trp-target"><div><span>${value.bossHpMax ? t('领袖剩余生命') : t('木桩剩余生命')}</span><b>${number(Math.max(0, remain) / maximum * 100, { percent: true })}</b></div>
      <progress max=${maximum} value=${Math.max(0, remain)} aria-label=${value.bossHpMax ? t('领袖剩余生命') : t('木桩剩余生命')}></progress><small>${number(remain, { compact: false })} / ${number(maximum, { compact: false })}</small></div>` : null}
  </div>`;
}
export function TrainingResults({ doc, side, raw, results, current, packet, packets = {}, onSelect, onSeek }) {
  const [metric, setMetric] = useState('damage'), [expanded, setExpanded] = useState(false), [reportTab, setReportTab] = useState('curve');
  const closeRef = useRef(null);
  useEffect(() => { setExpanded(false); }, [doc.version, doc.cs]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement; closeRef.current?.focus();
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); setExpanded(false); } };
    window.addEventListener('keydown', key); return () => { window.removeEventListener('keydown', key); previous?.focus?.(); };
  }, [expanded]);
  const value = packet?.metrics || results[side]?.value, live = !!packet && !packet.finished, stale = !packet && !!value && !current[side];
  const values = Object.fromEntries(['A', 'B'].map(s => [s, packets?.[s]?.metrics || (current[s] ? results[s]?.value : null)]));
  const pick = row => { onSelect(row); setExpanded(false); };
  return html`<section class="tf-results trp-results" data-testid="training-results"><header><h2>${live ? t('实时统计') : t('本次模拟结果')}</h2><span>${t('方案 {side}', { side })}</span></header>
    ${value ? html`<${Summary} value=${value} doc=${doc} live=${live} stale=${stale} /><${Composition} value=${value} />
      <${Ranking} value=${value} metric=${metric} setMetric=${setMetric} onSelect=${onSelect} />
      <button type="button" class="trp-open-report" data-testid="training-open-report" onClick=${() => setExpanded(true)}><${Icon} name="chart" />${t('详细战报与曲线')}</button>`
      : html`<p class="tf-note">${t('开始演练，观察技能、伤害与站位效果。')}</p>`}
    <details open=${!!results.A && !!results.B}><summary>${t('方案对比')}</summary><${Comparison} doc=${doc} raw=${raw} results=${results} current=${current} heading=${false} /></details>
    <p class="trp-footnote">${t('有效伤害排除溢出；DPS/HPS 按本场实际战斗秒数计算。')}</p>
    ${expanded && value ? html`<section class="trp-report" role="dialog" aria-label=${t('详细战报')} data-testid="training-full-report"><header><div><h2>${t('详细战报')} · ${side}</h2><p>${reportStatus(value, doc, live)} · ${number(value.seconds)}s</p></div>
      <button type="button" ref=${closeRef} aria-label=${t('关闭战报')} onClick=${() => setExpanded(false)}><${Icon} name="close" /></button></header>
      <div class="trp-report-tabs">${[['curve', t('输出曲线')], ['units', t('单位明细')], ['compare', t('方案对比')]].map(([key, label]) => html`<button key=${key} type="button" aria-pressed=${reportTab === key} onClick=${() => setReportTab(key)}>${label}</button>`)}</div>
      <div class="trp-report-body">${reportTab === 'curve' ? html`<${ResultCurve} values=${values} onSeek=${packet ? onSeek : null} /><${Composition} value=${value} />`
        : reportTab === 'units' ? html`<${UnitTable} value=${value} metric=${metric} setMetric=${setMetric} onSelect=${pick} />`
        : html`<${Comparison} doc=${doc} raw=${raw} results=${results} current=${current} heading=${false} />`}</div>
    </section>` : null}
  </section>`;
}
