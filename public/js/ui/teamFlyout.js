// Upstream #922, aligned to the fork's grouped and scrollable 4–20-seat roster.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { UnitThumb, BandIcon } from './gameComponents.js';
import { BondStrip } from './bondStrip.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

export function flyOpRec(unit, lookup = (id) => data.lookup('chess', id)) {
  if (!unit || typeof unit.id !== 'string' || lookup(unit.id)) return null;
  return { charId: unit.id, assets: { avatar: unit.id }, isGolden: !!unit.golden };
}

export function TeamFlyout({ panelRef, players, onBond = null }) {
  const [open, setOpen] = useState(false), [layout, setLayout] = useState(null);
  const toggle = useRef(null), scroll = useRef(null), bands = useRef(null);
  const ids = players.map((p) => p.playerId).join(':');
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current, list = panel?.querySelector('.team__list');
    if (!list) return;
    let frame = 0;
    const sync = () => {
      if (scroll.current) scroll.current.scrollTop = list.scrollTop;
      if (bands.current) bands.current.scrollTop = list.scrollTop;
    };
    const measure = () => {
      frame = 0;
      const base = panel.getBoundingClientRect(), box = list.getBoundingClientRect();
      let end = 0;
      const rows = [...list.querySelectorAll('.team__row[data-player-id]')].map((row) => {
        const rect = row.getBoundingClientRect(), top = rect.top - box.top + list.scrollTop;
        const item = { id: row.dataset.playerId, height: rect.height, gap: Math.max(0, top - end) };
        end = top + rect.height;
        return item;
      });
      const next = { rows, bottom: Math.max(0, list.scrollHeight - end), top: box.top - base.top, height: list.clientHeight,
        maxWidth: Math.max(0, innerWidth - base.right - (toggle.current?.offsetWidth || 24) - 8) };
      setLayout((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
      sync();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(list);
    for (const row of list.querySelectorAll('.team__row')) resize.observe(row);
    list.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', schedule);
    measure();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); list.removeEventListener('scroll', sync); window.removeEventListener('resize', schedule); };
  }, [open, ids, panelRef]);
  useEffect(() => {
    const top = panelRef.current?.querySelector('.team__list')?.scrollTop || 0;
    if (scroll.current) scroll.current.scrollTop = top;
    if (bands.current) bands.current.scrollTop = top;
  }, [layout, panelRef]);
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const rows = (layout?.rows || []).filter((row) => byId.has(row.id));
  const rowStyle = (row) => ({ height: `${row.height}px`, marginTop: `${row.gap}px` });
  const label = open ? t('收起队友速查') : t('展开队友速查');
  return html`<div class=${`team__fly${open ? ' is-open' : ''}`} onKeyDown=${(event) => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); toggle.current?.focus(); }
  }}>
    <button ref=${toggle} type="button" class="team__bonds-toggle" aria-expanded=${String(open)} aria-controls="team-bonds"
      aria-label=${label} title=${label} onClick=${() => setOpen(!open)}><${Icon} name=${open ? 'chevronLeft' : 'chevronRight'} /></button>
    ${open && layout ? html`<div id="team-bonds" class="team__fly-window" role="region" aria-label=${t('队友速查')}
      style=${{ top: `${layout.top}px`, height: `${layout.height}px`, maxWidth: `${layout.maxWidth}px` }}>
      <div class="team__fly-scroll" ref=${scroll} tabindex="0" aria-label=${t('盟约')}>
        ${rows.map((row) => {
          const p = byId.get(row.id), bonds = !p.hidden && Array.isArray(p.bonds) ? p.bonds : [];
          const ops = Array.isArray(p.boardOps) ? p.boardOps.filter((u) => u && typeof u.id === 'string') : [];
          return html`<section key=${row.id} class="team__fly-row" data-player-id=${row.id}>
            <div class="team__fly-bonds" style=${rowStyle(row)}>${bonds.length ? html`<${BondStrip} bonds=${bonds} max=${32} names=${false}
              onOpen=${(id) => onBond?.(id, p.playerId)} />` : html`<span class="team__fly-empty">—</span>`}</div>
            <div class="team__fly-ops" style=${rowStyle(row)} aria-label=${t('在场')}>
              ${ops.length ? ops.map((u, i) => html`<${UnitThumb} key=${`${u.id}:${i}`} id=${u.id} rec=${flyOpRec(u)}
                golden=${!!u.golden} ownerId=${p.playerId} size="xs" showTier=${false} />`) : html`<span class="team__fly-empty">—</span>`}
            </div>
          </section>`;
        })}
        <span class="team__fly-spacer" style=${{ height: `${layout.bottom}px`, gridColumn: '1 / -1' }} aria-hidden="true"></span>
      </div>
      <div class="team__fly-bands" ref=${bands} aria-label=${t('策略')}>${rows.map((row) => html`<div key=${row.id} class="team__fly-band" style=${rowStyle(row)}>
        ${byId.get(row.id).bandId ? html`<${BandIcon} bandId=${byId.get(row.id).bandId} />` : html`<span class="team__fly-empty">—</span>`}
      </div>`)}<span class="team__fly-spacer" style=${{ height: `${layout.bottom}px` }} aria-hidden="true"></span></div>
    </div>` : null}
  </div>`;
}
