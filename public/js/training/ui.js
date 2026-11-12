import { html } from '../ui/components.js';
import { t, N_ } from '../../../shared/i18n.js';
import { data } from '../data.js';
import { avatarUrl } from '../assets.js';
import { metricDelta, trainingChanges } from '../../../shared/training.js';
import { changeLabels } from './model.js';

export const numeric = n => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Number(n) || 0);
export function Select({ label, value, options, onChange, disabled = false, testId }) {
  return html`<label class="tr-field">${label}<select data-testid=${testId} value=${value ?? ''} disabled=${disabled} onChange=${e => onChange(e.currentTarget.value)}>
    ${options.map(([id, name]) => html`<option key=${id} value=${id}>${name}</option>`)}</select></label>`;
}
export function Numeric({ label, value, onChange, min = 0, max = 999, step = 1, testId }) {
  return html`<label class="tr-field">${label}<input data-testid=${testId} type="number" value=${value} min=${min} max=${max} step=${step}
    onChange=${e => { const n = e.currentTarget.valueAsNumber; if (Number.isFinite(n) && n >= min && n <= max) onChange(n); else e.currentTarget.value = String(value); }} /></label>`;
}
export function Portrait({ record, className = '' }) {
  const url = record && avatarUrl(data.get('assets'), record.assets?.avatar || record.charId);
  return url ? html`<img class=${className} src=${url} alt="" loading="lazy" onError=${e => { e.currentTarget.style.visibility = 'hidden'; }} />` : null;
}
const TYPES = [['phys', N_('物理伤害')], ['arts', N_('法术伤害')], ['true', N_('真实伤害')], ['elemental', N_('元素伤害')]];
export function endReason(reason) {
  if (reason === 'cleared') return t('敌人已清除');
  if (reason === 'timeout') return t('达到测试时限');
  if (reason === 'boss' || reason === 'bossKilled') return t('领袖已击破');
  return t('战斗结束');
}
const CHANGES = { chessId: N_('干员'), skillIndex: N_('技能'), moduleId: N_('模组'), items: N_('装备'),
  potential: N_('潜能'), cultivate: N_('练度'), row: N_('行'), col: N_('列'), dir: N_('朝向'), layers: N_('层数'), tier: N_('阶数'),
  bandId: N_('策略'), tokenId: N_('召唤物'), ownerUid: N_('所属干员') };
function changeValue(value, raw, key) {
  if (value == null) return t('默认');
  if (key === 'chessId') return data.lookup('chess', value)?.name || raw.chess[value]?.name || value;
  if (key === 'items') return data.lookup('items', value)?.name || raw.items[value]?.name || value;
  if (key === 'tokenId') return raw.tokens[value]?.name || value;
  if (key === 'skillIndex') return `S${Number(value) + 1}`;
  if (typeof value === 'object') return t('部署已调整');
  if (key === 'moduleId') return Object.values(raw.chess).flatMap(r => r.modules || []).find(m => m.uniEquipId === value)?.name || t('无');
  if (key === 'dir') return ({ UP: t('上'), RIGHT: t('右'), DOWN: t('下'), LEFT: t('左') })[value] || value;
  return String(value);
}

export function Comparison({ results, current, doc, raw, heading = true }) {
  if (!results.A || !results.B) return html`<p class="tr-note">${t('复制方案后修改配置，再运行 A/B 对比。')}</p>`;
  if (!current.A || !current.B) return html`<p class="tr-note">${t('配置已变更，重新试算后可比较。')}</p>`;
  const a = results.A.value, b = results.B.value;
  const metrics = [[t('有效总伤害'), a.damage, b.damage], ['DPS', a.dps, b.dps], [t('有效治疗'), a.healing || 0, b.healing || 0],
    ['HPS', a.hps || 0, b.hps || 0], [t('总承伤'), a.taken || 0, b.taken || 0], [t('作战用时'), a.seconds, b.seconds],
    [t('击杀'), a.killed, b.killed], ...(doc.mode === 'team' ? [[t('漏怪数'), a.leaks, b.leaks]] : []),
    ...(a.bossHpMax || b.bossHpMax ? [[t('领袖剩余生命'), a.bossHpLeft, b.bossHpLeft]] : [])];
  const changes = trainingChanges(doc.plans.A, doc.plans.B);
  return html`<section class="tr-section">${heading ? html`<h3>${t('方案对比')}</h3>` : null}<div class="tr-table-wrap"><table class="tr-compare" data-testid="training-comparison">
    <thead><tr><th>${t('指标')}</th><th>A</th><th>B</th><th>${t('差值（B−A）')}</th></tr></thead><tbody>
    ${metrics.map(([label, av, bv]) => { const d = metricDelta(av, bv); return html`<tr><th scope="row">${label}</th><td>${numeric(av)}</td><td>${numeric(bv)}</td>
      <td>${d.delta > 0 ? '+' : ''}${numeric(d.delta)}<br /><small>${d.percent === null ? t('基准为零') : `${d.percent > 0 ? '+' : ''}${numeric(d.percent)}%`}</small></td></tr>`; })}
    </tbody></table></div>
    <h3>${t('修改项')}</h3>${changes.length ? html`<ul class="tr-changes">${changes.map(c => {
      const key = changeLabels(c.path); const label = CHANGES[key] ? t(CHANGES[key]) : t('部署');
      return html`<li>${label}: ${changeValue(c.before, raw, key)} → ${changeValue(c.after, raw, key)}</li>`;
    })}</ul>` : html`<p class="tr-note">${t('两个方案配置相同。')}</p>`}
    <p class="tr-note">${t('清场更快可能导致总伤更低，请结合漏怪和用时判断。')}</p></section>`;
}

export function Results({ doc, side, results, current, raw, busy, onReplay }) {
  const entry = results[side], value = entry?.value;
  const totals = Object.fromEntries(TYPES.map(([type]) => [type, value?.rows.reduce((n, row) => n + (row.types[type] || 0), 0) || 0]));
  return html`<aside class="tr-results" aria-label=${t('本次模拟结果')}>
    <div class="tr-result-heading"><h2>${t('本次模拟结果')}</h2><span class="tr-muted">${t('方案 {side}', { side })}</span></div>
    <span class="tr-status" role="status">${value ? current[side] ? value.bossHpLeft === 0 ? t('领袖已击破') : endReason(value.reason) : t('配置已变更，待重新试算') : t('等待试算')}</span>
    ${value ? html`<dl class="tr-metric-list" data-testid="training-result">
      <div><dt>${t('有效总伤害')}</dt><dd>${numeric(value.damage)}</dd></div>
      <div><dt>${t('平均 DPS')}</dt><dd>${numeric(value.dps)}</dd></div>
      <div><dt>${t('作战用时')}</dt><dd>${numeric(value.seconds)} ${t('秒')}</dd></div>
      ${doc.mode === 'team' ? html`<div><dt>${t('漏怪数')}</dt><dd>${value.leaks}</dd></div><div><dt>${t('击杀')}</dt><dd>${value.killed} / ${value.total}</dd></div>` : null}
      ${value.bossHpLeft !== null ? html`<div><dt>${t('领袖剩余生命')}</dt><dd>${numeric(value.bossHpLeft)}</dd></div>` : null}
    </dl><div class="tr-types" aria-hidden="true">${TYPES.map(([type]) => html`<span class=${`tr-type-${type}`} style=${{ width: `${value.damage ? totals[type] / value.damage * 100 : 0}%` }}></span>`)}</div>
    <div class="tr-type-legend">${TYPES.map(([type, label]) => html`<span><i class=${`tr-type-${type}`}></i>${t(label)} ${numeric(totals[type])}</span>`)}</div>
    <h3>${t('干员伤害排行')}</h3><ol class="tr-ranking">${value.rows.map(row => html`<li><span>${data.localeName(row.name)}${doc.plans[side].length > 1 ? ` · ${row.ownerId === 'console-2' ? '2' : '1'}` : ''}</span><b>${numeric(row.damage)}</b></li>`)}</ol>
    <button type="button" disabled=${busy || !current[side]} onClick=${onReplay} data-testid="training-replay">${t('查看战斗')}</button>`
      : html`<div class="tr-empty"><b>${t('看看这套搭配的表现')}</b>${t('选择干员后开始试算。结果包含初动、空转与技能回转。')}</div>`}
    <${Comparison} results=${results} current=${current} doc=${doc} raw=${raw} />
    <p class="tr-note">${t('按实际扣血统计，召唤物归所属干员；DPS 包含初动与空转。')}<br />${t('结果仅对应本次版本、配置和随机条件。')}</p>
  </aside>`;
}
