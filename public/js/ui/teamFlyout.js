// MovCloud PR #922 b3a9a994 (GPL-3.0-or-later), adapted to this fork's grouped 4–20-seat roster.
// Local interaction [ASSUMED]: hover previews, avatar clicks pin, and battlefield navigation dismisses the preview.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, BondDisc } from './components.js';
import { UnitThumb, BandIcon, RichText } from './gameComponents.js';
import { sortBonds, nextThreshold } from './gameLogic.js';
import { bondDisplay } from './bondStrip.js';
import { bondIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

export function flyOpChessId(unit, lookup = (id) => data.lookup('chess', id), records = () => data.list('chess')) {
  if (!unit || typeof unit.id !== 'string') return null;
  const known = lookup(unit.id);
  if (known) return unit.golden && known.goldenId ? known.goldenId : unit.id;
  const candidates = records().filter((rec) => rec.charId === unit.id);
  return (candidates.find((rec) => !!rec.isGolden === !!unit.golden) || candidates[0])?.chessId || null;
}

export function flyOpRec(unit, lookup = (id) => data.lookup('chess', id)) {
  if (!unit || typeof unit.id !== 'string' || lookup(unit.id)) return null;
  const rec = data.list('chess').find((c) => c.charId === unit.id);
  return { charId: unit.id, name: rec?.name || unit.id, assets: { avatar: unit.id }, isGolden: !!unit.golden };
}

/** A narrow row needs icon-only discs; the main BondStrip includes names, counts and its own scroller. */
function FlyBonds({ bonds, ownerId, onBond, layersDisabled }) {
  const manifest = data.get('assets');
  return sortBonds(bonds, (id) => data.lookup('bonds', id))
    .filter((bond) => !bond.off && (bond.active || bond.count > 0 || bond.layers > 0 || bond.tempLayers > 0))
    .map((bond) => {
      const { record: rec, thresholds, tier, total, tempLayers } = bondDisplay(bond.bondId, bond);
      const next = nextThreshold(bond.count ?? 0, thresholds);
      const name = rec?.name || bond.bondId;
      const title = `${name} ${bond.count ?? 0}/${next ?? thresholds.at(-1) ?? '-'}${bond.harmony > 0 ? t('（含调和 +{harmony}）', { harmony: bond.harmony }) : ''}`;
      return html`<${BondDisc} key=${bond.bondId} name=${name} icon=${bondIconUrl(manifest, bond.bondId)}
        layers=${rec?.noStack ? undefined : total} tier=${tier} class=${tempLayers > 0 ? 'team__fly-temp-bond' : undefined}
        maxTier=${Math.max(1, thresholds.length)} active=${!!bond.active} size="sm" showName=${false}
        layersDisabled=${layersDisabled} title=${title} onClick=${onBond ? () => onBond(bond.bondId, ownerId) : undefined} />`;
    });
}

function FlyOps({ ops, player, onOp }) {
  return ops.map((unit, index) => {
    const id = flyOpChessId(unit), rec = flyOpRec(unit);
    const thumb = html`<${UnitThumb} id=${unit.id} rec=${rec} golden=${!!unit.golden} ownerId=${player.playerId} size="xs" showTier=${false} />`;
    return onOp && id ? html`<button type="button" key=${`${unit.id}:${index}`} class="team__fly-opbtn"
      aria-label=${data.lookup('chess', id)?.name || rec?.name || unit.id} title=${data.lookup('chess', id)?.name || rec?.name || unit.id}
      onClick=${() => onOp({ ...unit, id }, player)}>${thumb}</button>` : html`<span key=${`${unit.id}:${index}`}>${thumb}</span>`;
  });
}

function BandPopup({ band, onClose }) {
  const rec = data.lookup('bands', band.id);
  if (!rec) return null;
  return html`<div class="team__fly-bandpop" role="dialog" aria-label=${t('策略')}
    style=${{ left: `${band.left}px`, top: `${band.top}px` }}>
    <header class="team__fly-bandpop-head">
      <${BandIcon} bandId=${band.id} />
      <div><small>${band.owner ? t('{bandOwner} 的策略', { bandOwner: band.owner }) : t('我的策略')}</small>
        <b>${rec.name}${rec.effectName ? html` <small>${rec.effectName}</small>` : null}</b></div>
      <button type="button" class="team__fly-close" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
    </header>
    <${RichText} as="p" text=${rec.descRaw || rec.desc} />
  </div>`;
}

export function TeamFlyout({ panelRef, players, myId = null, phaseKey = null, viewKey = null, openRequest = 0, layersDisabled = false, bondsForPlayer = null, onBond = null, onOp = null }) {
  const [open, setOpen] = useState(false), [present, setPresent] = useState(false), [layout, setLayout] = useState(null), [band, setBand] = useState(null);
  const toggle = useRef(null), scroll = useRef(null), drag = useRef(null), dragged = useRef(false);
  const hoverTimer = useRef(0), hover = useRef({ inside: false, pinned: false, blocked: false });
  const ids = players.map((p) => p.playerId).join(':');
  const close = () => {
    clearTimeout(hoverTimer.current);
    hover.current.pinned = false;
    hover.current.blocked = hover.current.inside;
    setOpen(false);
  };
  useEffect(() => {
    if (!openRequest) return;
    clearTimeout(hoverTimer.current);
    hover.current.pinned = true;
    hover.current.blocked = false;
    setOpen(true);
  }, [openRequest]);
  // A navigation takes priority over an avatar request from the same event.
  useEffect(() => { close(); setBand(null); }, [phaseKey, viewKey]);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const enter = (event) => {
      if (event.pointerType === 'touch' || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      hover.current.inside = true;
      clearTimeout(hoverTimer.current);
      if (hover.current.blocked || hover.current.pinned) return;
      hoverTimer.current = setTimeout(() => setOpen(true), 100);
    };
    const leave = () => {
      hover.current.inside = false;
      hover.current.blocked = false;
      clearTimeout(hoverTimer.current);
      if (!hover.current.pinned) hoverTimer.current = setTimeout(() => {
        if (!hover.current.inside && !hover.current.pinned) setOpen(false);
      }, 90);
    };
    panel.addEventListener('pointerenter', enter);
    panel.addEventListener('pointerleave', leave);
    return () => { clearTimeout(hoverTimer.current); panel.removeEventListener('pointerenter', enter); panel.removeEventListener('pointerleave', leave); };
  }, [panelRef]);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    if (!present) return;
    const timer = setTimeout(() => setPresent(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 120);
    return () => clearTimeout(timer);
  }, [open, present]);
  useEffect(() => {
    if (open) return;
    setBand(null);
    drag.current = null;
    dragged.current = false;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current, list = panel?.querySelector('.team__list');
    if (!list) return;
    let frame = 0;
    const sync = () => { if (scroll.current) scroll.current.scrollTop = list.scrollTop; };
    const measure = () => {
      frame = 0;
      const base = panel.getBoundingClientRect(), box = list.getBoundingClientRect();
      const effects = panel.closest('.gm')?.querySelector('.gm__effects');
      const edge = effects?.getBoundingClientRect();
      const right = edge?.width > 0 && edge.left > base.right ? Math.min(innerWidth - 8, edge.left - 8) : innerWidth - 8;
      const minSquare = matchMedia('(pointer: coarse)').matches ? 44 : 0;
      let end = 0;
      const rows = [...list.querySelectorAll('.team__row[data-player-id]')].map((row) => {
        const rect = row.getBoundingClientRect(), top = rect.top - box.top + list.scrollTop;
        const square = Math.min(rect.height, Math.max(minSquare, row.querySelector('.pavatar')?.getBoundingClientRect().height || rect.height));
        const item = { id: row.dataset.playerId, height: rect.height, square, gap: Math.max(0, top - end) };
        end = top + rect.height;
        return item;
      });
      const next = { rows, bottom: Math.max(0, list.scrollHeight - end), top: box.top - base.top, height: list.clientHeight,
        width: Math.max(0, right - base.right - (toggle.current?.offsetWidth || 44)) };
      setLayout((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
      sync();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(panel);
    resize.observe(list);
    const effects = panel.closest('.gm')?.querySelector('.gm__effects');
    if (effects) resize.observe(effects);
    for (const row of list.querySelectorAll('.team__row')) resize.observe(row);
    list.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', schedule);
    measure();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); list.removeEventListener('scroll', sync); window.removeEventListener('resize', schedule); };
  }, [open, ids, panelRef]);
  useEffect(() => {
    if (!open || !scroll.current) return;
    scroll.current.scrollTop = panelRef.current?.querySelector('.team__list')?.scrollTop || 0;
  }, [open, layout, panelRef]);
  useEffect(() => {
    if (!open) return;
    const away = (event) => {
      if (!(event.target instanceof Element) || panelRef.current?.contains(event.target)) return;
      if (event.target.closest('button, a, input, select, textarea, [role="button"]')) close();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open, panelRef]);
  const down = (event) => {
    dragged.current = false;
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const cell = event.target instanceof Element ? event.target.closest('.team__fly-cell') : null;
    if (!cell || cell.scrollWidth <= cell.clientWidth + 1) return;
    drag.current = { cell, id: event.pointerId, x: event.clientX, left: cell.scrollLeft, moved: false };
  };
  const move = (event) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    if (!current.moved && Math.abs(dx) > 4) {
      current.moved = true;
      dragged.current = true;
      current.cell.classList.add('is-dragging');
      current.cell.setPointerCapture(event.pointerId);
    }
    if (current.moved) { event.preventDefault(); current.cell.scrollLeft = current.left - dx; }
  };
  const up = (event) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    current.cell.classList.remove('is-dragging');
    if (current.cell.hasPointerCapture(event.pointerId)) current.cell.releasePointerCapture(event.pointerId);
  };
  const openBand = (player, element) => {
    const rect = element.getBoundingClientRect();
    const width = Math.min(360, innerWidth - 16);
    setBand({ id: player.bandId, owner: player.playerId === myId ? null : player.name,
      left: Math.max(8, Math.min(rect.left - width - 8, innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.top, innerHeight - Math.min(280, innerHeight - 16))) });
  };
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const label = open ? t('收起队友速查') : t('展开队友速查');
  return html`<div class=${`team__fly${open ? ' is-open' : present ? ' is-closing' : ''}`} onKeyDown=${(event) => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); close(); toggle.current?.focus(); }
  }}>
    <button ref=${toggle} type="button" class="team__bonds-toggle" aria-expanded=${String(open)} aria-controls="team-bonds"
      aria-label=${label} title=${label} onKeyDown=${(event) => { if (event.key === ' ') event.stopPropagation(); }}
      onClick=${() => {
        if (open) close();
        else { clearTimeout(hoverTimer.current); hover.current.pinned = true; hover.current.blocked = false; setOpen(true); }
      }}><${Icon} name="chevronRight" /></button>
    ${(open || present) && layout ? html`<div id="team-bonds" class="team__fly-window" role="region" aria-label=${t('队友速查')}
      aria-hidden=${String(!open)} inert=${!open}
      style=${{ top: `${layout.top}px`, height: `${layout.height}px`, width: `${layout.width}px` }}>
      <div class="team__fly-scroll" ref=${scroll} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}
        onClickCapture=${(event) => { if (dragged.current) { dragged.current = false; event.preventDefault(); event.stopPropagation(); } }}>
        ${(layout.rows || []).filter((row) => byId.has(row.id)).map((row) => {
          const player = byId.get(row.id), empty = player.hidden || player.alive === false;
          const bonds = empty ? [] : bondsForPlayer?.(player.playerId) ?? player.bonds ?? [];
          const ops = !empty && Array.isArray(player.boardOps) ? player.boardOps.filter((unit) => unit && typeof unit.id === 'string') : [];
          const strategy = !empty && player.bandId ? data.lookup('bands', player.bandId) : null;
          return html`<section key=${row.id} class="team__fly-row" data-player-id=${row.id} aria-label=${player.name}
            style=${{ height: `${row.height}px`, marginTop: `${row.gap}px`, '--fly-square': `${row.square}px` }}>
            <div class="team__fly-cell team__fly-bonds" tabindex="0" aria-label=${t('盟约')}>
              <div class="team__fly-track"><${FlyBonds} bonds=${bonds} ownerId=${player.playerId} onBond=${onBond} layersDisabled=${layersDisabled} /></div>
            </div>
            <div class="team__fly-cell team__fly-ops" tabindex="0" aria-label=${t('在场')}>
              <div class="team__fly-track"><${FlyOps} ops=${ops} player=${player} onOp=${onOp} /></div>
            </div>
            ${strategy ? html`<button type="button" class="team__fly-band" aria-label=${t('策略')} title=${strategy.name || ''}
              onClick=${(event) => openBand(player, event.currentTarget)}><${BandIcon} bandId=${player.bandId} /></button>`
              : html`<div class="team__fly-band is-empty" aria-label=${t('策略')}></div>`}
          </section>`;
        })}
        <span class="team__fly-spacer" style=${{ height: `${layout.bottom}px` }} aria-hidden="true"></span>
      </div>
    </div>` : null}
    ${open && band ? html`<${BandPopup} band=${band} onClose=${() => setBand(null)} />` : null}
  </div>`;
}
