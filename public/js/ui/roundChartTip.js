// A fixed overlay cannot add scrollbars to the chart that supplies its pointer coordinates.
import { t } from '../../../shared/i18n.js';
import { h, render } from '../../vendor/preact.module.js';
import { Icon } from './components.js';

export function createRoundChartTip(host, state) {
  const element = document.createElement('div');
  element.className = 'tip round-chart-tip'; element.style.position = 'fixed'; element.style.display = 'none';
  const head = document.createElement('header'), title = document.createElement('b'), close = document.createElement('button');
  head.className = 'tip-head'; close.type = 'button'; close.className = 'tip-close'; close.setAttribute('aria-label', t('关闭回合详情'));
  render(h(Icon, { name: 'close' }), close);
  const list = document.createElement('div'), hint = document.createElement('p');
  list.className = 'tip-rows'; list.tabIndex = -1; hint.className = 'tip-hint'; head.append(title, close); element.append(head, list, hint); host.append(element);
  let model, round = null, listeners = null, observer = null;

  const position = () => {
    if (!model || element.style.display === 'none') return;
    const panel = host.closest('.round-history'), box = panel?.getBoundingClientRect();
    const tabsBottom = panel?.querySelector('.round-history__tabs')?.getBoundingClientRect().bottom;
    const left = Math.max(8, (box?.left || 0) + 8), right = Math.min(innerWidth - 8, box ? box.right - 8 : innerWidth - 8);
    const top = Math.max(8, tabsBottom ? tabsBottom + 8 : box ? box.top + 8 : 8);
    const bottom = Math.min(innerHeight - 8, box ? box.bottom - 8 : innerHeight - 8);
    element.style.width = Math.max(0, Math.min(340, right - left)) + 'px';
    const limit = Math.max(0, Math.min(420, bottom - top));
    element.style.maxHeight = limit + 'px';
    const style = getComputedStyle(element);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2;
    list.style.maxHeight = Math.max(0, limit - head.offsetHeight - (hint.hidden ? 0 : hint.offsetHeight + 8) - padding - 8) + 'px';
    const anchor = model.anchor(round), w = element.offsetWidth, height = element.offsetHeight;
    const x = anchor.x + 12 + w <= right ? anchor.x + 12 : anchor.x - w - 12;
    element.style.left = Math.max(left, Math.min(x, right - w)) + 'px';
    element.style.top = Math.max(top, Math.min(anchor.y + 8, bottom - height)) + 'px';
  };
  const dismiss = () => {
    state.pinnedRound = null; round = null; element.style.display = 'none';
    listeners?.abort(); listeners = null; observer?.disconnect(); observer = null;
    model?.cross(null);
  };
  close.onclick = () => { dismiss(); model?.focus(); };
  const listen = () => {
    if (listeners) return;
    listeners = new AbortController(); const { signal } = listeners;
    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const restore = element.contains(document.activeElement); dismiss(); if (restore) model?.focus();
    }, { capture: true, signal });
    document.addEventListener('pointerdown', e => {
      if (!element.contains(e.target) && !model?.hit.contains(e.target)) dismiss();
    }, { capture: true, signal });
    window.addEventListener('resize', position, { signal });
    window.addEventListener('scroll', e => { if (!(e.target instanceof Node && element.contains(e.target))) position(); }, { capture: true, signal });
    observer = new MutationObserver(() => { if (!element.isConnected) dismiss(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };
  const show = (r, pinned) => {
    if (!model?.rounds.includes(r)) { dismiss(); return; }
    const sameRound = round === r, scroll = sameRound ? list.scrollTop : 0;
    round = r; state.pinnedRound = pinned ? r : null;
    element.dataset.pinned = String(pinned); element.setAttribute('role', pinned ? 'dialog' : 'tooltip');
    title.textContent = t('第 {round} 回合 · {label}', { round: r, label: model.label });
    element.setAttribute('aria-label', title.textContent); close.hidden = !pinned;
    list.setAttribute('aria-label', title.textContent); list.tabIndex = pinned ? 0 : -1;
    const rows = model.rows(r), shown = pinned ? rows : rows.slice(0, 4);
    list.replaceChildren();
    for (const row of shown) {
      const line = document.createElement('div'); line.className = 'tip-row';
      const sw = document.createElement('span'); sw.className = 'k'; sw.style.setProperty('--c', row.color);
      const value = document.createElement('span'); value.className = 'v'; value.textContent = row.value;
      const name = document.createElement('span'); name.textContent = row.name;
      line.append(sw, value, name); list.append(line);
    }
    hint.hidden = pinned;
    hint.textContent = rows.length > shown.length ? t('点击查看全部 {n} 名玩家', { n: rows.length }) : t('点击固定详情');
    element.style.display = 'block'; model.cross(r); position(); list.scrollTop = scroll; listen();
  };
  return {
    element, dismiss,
    preview(r) { if (state.pinnedRound == null) show(r, false); },
    pin(r) { show(r, true); },
    leave() { if (state.pinnedRound == null) dismiss(); },
    update(next) {
      model = next;
      if (state.pinnedRound != null) show(state.pinnedRound, true);
      else if (round != null) show(round, false);
    },
  };
}
