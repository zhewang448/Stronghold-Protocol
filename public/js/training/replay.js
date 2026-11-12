import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from '../ui/components.js';
import { t } from '../../../shared/i18n.js';
import { numeric, Select } from './ui.js';
import { data } from '../data.js';

/** Lightweight replay of engine positions and HP. No 3D assets or second simulation on the UI thread. */
export function TrainingReplay({ replay, onClose }) {
  const [index, setIndex] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  useEffect(() => { setIndex(0); setPlaying(false); }, [replay]);
  useEffect(() => {
    if (!playing || !replay.frames.length) return;
    let raf, previous = 0, time = replay.frames[index]?.time || 0;
    const frame = now => {
      if (previous) time += Math.min((now - previous) / 1000, .2) * speed;
      previous = now;
      let next = index;
      while (next < replay.frames.length - 1 && replay.frames[next + 1].time <= time) next++;
      setIndex(next);
      if (next >= replay.frames.length - 1) setPlaying(false); else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, replay, speed]);
  const frame = replay.frames[index];
  return html`<section class="tr-replay" aria-label=${t('战斗演示')} data-testid="training-playback">
    <div class="tr-result-heading"><h2>${t('战斗演示')} · ${t('方案 {side}', { side: replay.side })}</h2>
      <button type="button" onClick=${onClose}>${t('关闭')}</button></div>
    <p class="tr-muted">${t('显示同配置、同随机条件下的单位位置和生命变化。')}</p>
    <div class="tr-actions"><button type="button" onClick=${() => { if (index === replay.frames.length - 1) setIndex(0); setPlaying(!playing); }}>${playing ? t('暂停') : t('播放')}</button>
      <button type="button" onClick=${() => { setPlaying(false); setIndex(0); }}>${t('重播')}</button>
      <${Select} label=${t('播放速度')} value=${speed} options=${[.5, 1, 2, 4, 8].map(n => [n, `${n}×`])} onChange=${n => setSpeed(+n)} />
      <span>${numeric(frame?.time || 0)} / ${numeric(replay.seconds)} ${t('秒')}</span></div>
    <label class="tr-field">${t('播放进度')}<input aria-label=${t('播放进度')} type="range" min="0" max=${Math.max(0, replay.frames.length - 1)} value=${index}
      onInput=${e => { setPlaying(false); setIndex(+e.currentTarget.value); }} /></label>
    <div class="tr-replay-board" data-testid="training-replay-board">${frame?.units.map(u => html`<span key=${u.id} class=${`tr-replay-unit ${u.side === 'enemy' ? 'enemy' : ''}`}
      title=${`${u.name === 'training_dummy' ? t('木桩') : data.localeName(u.name)} · ${numeric(u.hp)} / ${numeric(u.maxHp)}`}
      style=${{ left: `${Math.min(98, Math.max(2, (u.x + .5) / 21 * 100))}%`, top: `${Math.min(96, Math.max(4, (u.y + .5) / 19 * 100))}%` }}>
      ${u.name === 'training_dummy' ? t('木桩') : data.localeName(u.name)}<i class="tr-hp" style=${{ width: `${Math.max(0, u.hp / u.maxHp * 100)}%` }}></i></span>`)}</div>
  </section>`;
}
