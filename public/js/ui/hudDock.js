import { useLayoutEffect, useRef } from '../../vendor/hooks.module.js';
import { GEO } from '../../../shared/constants.js';
import { visibleHudFrame, fitHudPanel } from './hudLayout.js';

export function hudFrame(element) {
  const viewport = globalThis.visualViewport;
  const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
  const visible = { left, top, right: left + (viewport?.width || innerWidth), bottom: top + (viewport?.height || innerHeight) };
  const host = element?.closest('.gm__hud') || document.querySelector('.app-root');
  return visibleHudFrame(host?.getBoundingClientRect() || visible, visible);
}

/** One resize lifecycle for HUD docks; observe the actual controls, not only the window. */
export function useHudMeasure(ref, measure, deps) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const viewport = globalThis.visualViewport;
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(update);
    const hud = el.closest('.gm__hud');
    for (const node of new Set([el, hud, el.parentElement, ...(hud?.querySelectorAll('.gm__corner, .shopbar, .shopbar-tab, .team, .gtop, .gm__bonds') || [])])) {
      if (node) observer.observe(node);
    }
    measure();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update);
    };
  }, deps);
}

/** Message geometry belongs to the avatar, outside the member list's scrolling clip. */
export function useAvatarMessageDock(ref, playerId, messageKey) {
  useHudMeasure(ref, () => {
    const el = ref.current, team = el?.closest('.team');
    if (!el || !team) return;
    const row = [...team.querySelectorAll('.team__row')].find(node => node.dataset.playerId === playerId);
    const avatar = row?.querySelector('.team__btn');
    if (!avatar) return;
    const frame = hudFrame(el), origin = team.getBoundingClientRect();
    const a = avatar.getBoundingClientRect(), card = row.getBoundingClientRect();
    const list = team.querySelector('.team__list').getBoundingClientRect();
    const offscreen = a.bottom <= list.top || a.top >= list.bottom;
    el.toggleAttribute('data-offscreen', offscreen);
    const shop = team.closest('.gm__hud').querySelector('.shopbar, .shopbar-tab');
    const upperEdge = Math.max(frame.top, list.top);
    const lowerEdge = Math.min(frame.bottom, list.bottom, shop?.getBoundingClientRect().top || frame.bottom);
    const box = el.getBoundingClientRect();
    const top = Math.max(upperEdge, Math.min(a.top + a.height / 2 - box.height / 2, lowerEdge - box.height - 8));
    // The whole player card includes the name and LP tower to the avatar's right.
    // Anchor outside that card, not inside its information column.
    const left = Math.max(frame.left, Math.min(card.right + 8, frame.right - box.width));
    el.style.left = String(left - origin.left) + 'px';
    el.style.top = String(top - origin.top) + 'px';
  }, [playerId, messageKey]);
}

const BLOCKERS = '.gtop__left, .gtop__center, .gtop__right, .readywrap, .team__row, .bslot, .bonds-toggle, .effect, .shopbar__row, .shopbar__tools, .shopbar-tab, .gm__corner, .chud, .gm__watching';

export function usePingDock(ref, view, rect, prep, deps) {
  const expandedSlot = useRef(null);
  useHudMeasure(ref, () => {
    const el = ref.current, corner = el?.parentElement;
    if (!el || !corner) return;
    // Desktop keeps its original dock and scaling. Only constrained HUDs need slot selection.
    const compact = innerWidth < 768 || document.documentElement.classList.contains('sp-coarse') && (innerWidth <= 1100 || innerHeight <= 600);
    el.toggleAttribute('data-compact', compact);
    const positioned = el.hasAttribute('data-positioned');
    if (!compact && !positioned) { el.style.removeProperty('left'); el.style.removeProperty('top'); el.style.removeProperty('width'); return; }
    const c = corner.getBoundingClientRect(), frame = hudFrame(el);
    const buttons = el.querySelector('.gm__ping-buttons');
    const style = getComputedStyle(el), number = value => parseFloat(value) || 0;
    const padding = number(style.paddingLeft) + number(style.paddingRight) + number(style.borderLeftWidth) + number(style.borderRightWidth);
    const toggle = el.querySelector('.gm__ping-toggle').getBoundingClientRect().width;
    const fixed = padding + toggle + (buttons ? number(style.columnGap) : 0);
    const buttonWidth = buttons?.firstElementChild?.getBoundingClientRect().width || 0;
    const gap = buttons ? number(getComputedStyle(buttons).columnGap) : 0;
    const width = fixed + (buttons ? buttonWidth * buttons.children.length + gap * (buttons.children.length - 1) : 0);
    const widths = buttons ? Array.from(buttons.children, (_, i) => fixed + buttonWidth * (i + 1) + gap * i) : [];
    const height = el.offsetHeight;
    if (positioned) {
      el.style.width = `${Math.min(width, frame.right - frame.left - 12)}px`;
      el.toggleAttribute('data-scrollable', !!buttons && buttons.scrollWidth > buttons.clientWidth);
      return;
    }
    const obstacles = [...el.closest('.gm__hud').querySelectorAll(BLOCKERS)]
      .filter(node => !el.contains(node) && node.getBoundingClientRect().width > 0)
      .map(node => node.getBoundingClientRect());
    const points = [];
    // The bench and temporary row are interactive too; avoiding only the battle rect hides held operators.
    const rows = prep ? [GEO.HAND_ROW, GEO.TEMP_ROW, rect.r0, rect.r1] : [rect.r0, rect.r1];
    for (const row of rows) for (const col of [rect.c0, rect.c1]) {
      points.push(...(view?.tileScreen(row, col)?.poly || []));
    }
    const board = points.length ? { left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])),
      top: Math.min(...points.map(p => p[1])), bottom: Math.max(...points.map(p => p[1])) } : null;
    const anchor = !buttons && expandedSlot.current ? expandedSlot.current : { left: c.left, top: c.top - height - 8 };
    const slot = fitHudPanel({ frame, anchor, width, height,
      minWidth: fixed + buttonWidth, widths, obstacles, board });
    if (buttons) expandedSlot.current = { left: slot.left, top: slot.top };
    el.style.left = `${slot.left - c.left}px`; el.style.top = `${slot.top - c.top}px`; el.style.width = `${slot.width}px`;
    el.toggleAttribute('data-scrollable', !!buttons && buttons.scrollWidth > buttons.clientWidth);
  }, [view, rect, prep, ...deps]);
}

/** Bound a temporary panel above the entire corner, including wrapped rows, not only its own entry button. */
export function useCommunicationDock(ref, open) {
  useHudMeasure(ref, () => {
    const panel = ref.current;
    if (!panel) return;
    const corner = panel.closest('.gm__corner');
    const compact = innerWidth < 768 || document.documentElement.classList.contains('sp-coarse') && innerHeight <= 600;
    if (!corner || !compact) { panel.removeAttribute('data-hud-docked'); panel.style.cssText = ''; return; }
    const frame = hudFrame(panel), anchor = corner.getBoundingClientRect();
    panel.setAttribute('data-hud-docked', '');
    panel.style.maxWidth = `${frame.right - frame.left}px`;
    panel.style.maxHeight = `${Math.max(44, anchor.top - frame.top - 8)}px`;
    const rect = panel.getBoundingClientRect();
    const obstacles = [...corner.closest('.gm__hud').querySelectorAll(BLOCKERS)]
      .filter(node => !panel.contains(node) && node !== corner && node.getBoundingClientRect().width > 0)
      .map(node => node.getBoundingClientRect());
    const slot = fitHudPanel({ frame: { ...frame, bottom: Math.min(frame.bottom, anchor.top - 8) },
      anchor: { left: anchor.left, top: anchor.top - rect.height - 8 }, width: rect.width, height: rect.height, obstacles });
    panel.style.left = `${slot.left}px`; panel.style.top = `${slot.top}px`;
  }, [open]);
}
