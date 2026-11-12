import { DAMAGE_TYPES } from '../battle/metrics.js';
import { getLang } from '../../../shared/i18n.js';

export function formatResultNumber(value, { compact = true, percent = false } = {}) {
  if (!Number.isFinite(value)) return '—';
  const locale = getLang() === 'zh' ? 'zh-CN' : getLang();
  if (percent) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`;
  if (compact && Math.abs(value) >= 10000) return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 }).format(value);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}
export function damageComposition(value) {
  return DAMAGE_TYPES.map(type => ({ type, value: value?.types?.[type] ?? value?.rows?.reduce((n, row) => n + (row.types[type] || 0), 0) ?? 0 }))
    .map(row => ({ ...row, share: value?.damage > 0 ? row.value / value.damage * 100 : 0 }));
}
export function rankedResultRows(value, metric) {
  const total = (value?.rows || []).reduce((n, row) => n + (row[metric] || 0), 0);
  const maximum = Math.max(1, ...(value?.rows || []).map(row => row[metric] || 0));
  return [...(value?.rows || [])].sort((a, b) => (b[metric] || 0) - (a[metric] || 0) || a.key.localeCompare(b.key))
    .map(row => ({ ...row, share: total > 0 ? (row[metric] || 0) / total * 100 : 0, width: (row[metric] || 0) / maximum * 100 }));
}
/** Rates use the sample's actual interval, including an early final interval shorter than one second. */
export function resultCurve(series, metric) {
  return (series || []).map((point, i, rows) => {
    const previous = rows[Math.max(0, i - 1)], elapsed = point.seconds - previous.seconds;
    const key = metric === 'hps' ? 'healing' : 'damage';
    return { seconds: point.seconds, value: metric === 'dps' || metric === 'hps'
      ? elapsed > 0 ? Math.max(0, point[key] - previous[key]) / elapsed : 0 : point[metric] || 0 };
  });
}
