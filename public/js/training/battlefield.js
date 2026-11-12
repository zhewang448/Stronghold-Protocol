import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from '../ui/components.js';
import { t } from '../../../shared/i18n.js';
import { data } from '../data.js';
import { assets } from '../assets.js';
import { createFieldView } from '../render/app.js';
import { createFallbackView } from '../ui/fallbackField.js';
import { FacingWheel } from '../ui/facingWheel.js';
import { prepTrainingState, rangeAt, trainingRange, legalTrainingTile } from './placement.js';

export function tileAtClient(view, entries, x, y) {
  for (const [key] of entries) {
    const [row, col] = key.split(',').map(Number), tile = view?.tileScreen?.(row, col);
    const poly = tile?.poly; if (!poly?.length) continue;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    if (inside) return { row, col };
  }
  return null;
}

/** Native game view in both editing and battle phases; this component never advances a simulation. */
export function TrainingBattlefield(props) {
  const live = useRef(props); live.current = props;
  const host = useRef(null), viewRef = useRef(null), lastFeed = useRef(null);
  const [view, setView] = useState(null), [status, setStatus] = useState('loading');
  const [facing, setFacing] = useState(null);
  const key = `${props.doc.version}:${props.doc.cs}:${props.side}:${props.viewEpoch || 0}`;
  useEffect(() => {
    let alive = true, owned, timer;
    const controller = new AbortController();
    setStatus('loading'); setView(null); lastFeed.current = null;
    const renderData = {
      get: file => data.get(file),
      lookup: (file, id) => live.current.compiled?.extraData?.[file]?.[id]
        || (file === 'stages' && id === 'training_lane' ? live.current.options.trainingStage : null)
        || data.lookup(file, id),
      subscribe: callback => data.subscribe(callback),
    };
    const prefs = live.current.prefs;
    assets.seed(data.getRaw('assets')); if (data.getRaw('local')) assets.seedLocal(data.getRaw('local'));
    const options = { data: renderData, assets, signal: controller.signal, board: prefs.board,
      settings: { quality: prefs.quality, officialFx: prefs.fx, damageNumbers: true, officialBattleHud: true },
      playbackTime: () => live.current.editable ? performance.now() / 1000 : live.current.packet?.snap?.t ?? 0,
      padding: { top: 20, bottom: 12, left: 16, right: 16 }, hud: () => ({ top: 10, bottom: 10 }) };
    (async () => {
      try {
        if (new URLSearchParams(location.search).get('render') === 'fallback') throw new Error('explicit fallback');
        timer = setTimeout(() => controller.abort(), 18000);
        owned = await createFieldView(host.current, options);
        clearTimeout(timer);
      } catch (_error) {
        if (!alive) return;
        owned?.destroy();
        owned = createFallbackView(host.current, { data: renderData, assets: data.get('assets'), settings: options.settings });
        setStatus('fallback');
      }
      if (!alive) { owned?.destroy(); return; }
      viewRef.current = owned; setView(owned); setStatus(owned.debug ? 'ready' : 'fallback');
      live.current.onView?.(props.side, owned);
      live.current.onFacingSetter?.(props.side, setFacing);
      owned.on('tileClick', tile => { if (live.current.editable) live.current.onTile?.(tile, owned); });
      owned.on('pieceClick', hit => live.current.onPiece?.(hit, owned));
      owned.on('pieceDrop', hit => {
        if (!live.current.editable) return;
        if (hit.target?.area === 'board') live.current.onMove?.(hit.uid, hit.target, owned, setFacing);
      });
    })();
    return () => {
      alive = false; clearTimeout(timer); controller.abort(); owned?.destroy();
      viewRef.current = null; live.current.onView?.(props.side, null);
    };
  }, [key]);

  useEffect(() => {
    if (!view) return;
    const p = live.current;
    const stage = p.doc.mode === 'unit' ? p.options.trainingStage : p.raw.stages[p.doc.environment.stageId];
    view.setStage(stage);
    if (p.editable) {
      view.setCamera(p.doc.environment.kind === 'normal' ? 'prep' : 'bossPrep', { side: p.field ? 'R' : 'L', instant: true,
        ...(p.doc.mode === 'unit' ? { rect: { r0: 8, r1: 12, c0: 2, c1: 10 } } : {}) });
      const state = prepTrainingState({ ...p.doc, _compiled: p.compiled }, p.side, p.field, p.raw);
      if (facing?.newUnit) state.board.push({ ...facing.unit, uid: facing.uid, id: facing.unit.chessId || facing.unit.tokenId,
        row: facing.row, col: facing.col, items: (facing.unit.items || []).map(id => ({ id })) });
      view.setPrep(state, { editable: true, canPlace: (uid, target) => {
        const units = p.doc.plans[p.side][p.field].units, u = units.find(u => u.uid === uid);
        const occupied = units.some(u => u.uid !== uid && u.row === target.row && u.col === target.col);
        return target.area === 'board' && !occupied && legalTrainingTile(p.raw.chess[u?.chessId] || p.raw.tokens[u?.tokenId], new Map(p.mapEntries).get(`${target.row},${target.col}`));
      } });
      lastFeed.current = null;
    }
  }, [view, props.doc, props.field, props.editable, props.compiled, facing]);

  useEffect(() => {
    if (!view || props.editable || !props.packet) return;
    const packet = props.packet;
    if (lastFeed.current === packet) return;
    if (packet.reset || !lastFeed.current) {
      view.enterBattle(packet.meta);
      view.setCamera(props.doc.environment.kind, { rect: props.compiled?.spec.rect, instant: true });
      view.setLocalFeed?.({ on: true, speed: props.speed });
    }
    for (const frame of packet.frames || []) {
      if (frame.ev.length) view.pushEvents({ ev: frame.ev, gt: frame.snap.t });
      view.pushSnapshot({ ...frame.snap, gt: frame.snap.t });
    }
    if (packet.ev?.length) view.pushEvents({ ev: packet.ev, gt: packet.snap.t });
    view.pushSnapshot({ ...packet.snap, gt: packet.snap.t });
    if (packet.finished) view.finishBattle?.();
    lastFeed.current = packet;
  }, [view, props.packet, props.editable]);
  useEffect(() => { view?.setLocalFeed?.({ on: true, speed: props.playing ? props.speed : 0 }); }, [view, props.speed, props.playing]);
  useEffect(() => {
    view?.setSettings?.({ quality: props.prefs.quality, officialFx: props.prefs.fx, damageNumbers: true });
    view?.setBoardMode?.(props.prefs.board)?.catch?.(() => {});
  }, [view, props.prefs]);
  useEffect(() => {
    if (!view || facing) return;
    const p = live.current;
    view.highlightTiles(p.editable && p.armed ? p.legalEntries.map(([key]) => key.split(',').map(Number)) : [], { group: 'legal', color: 0x4ed8af, fill: .18 });
    const unit = p.doc.plans[p.side][p.field]?.units.find(u => u.uid === p.selected);
    const range = p.editable && unit ? rangeAt(p.raw.chess[unit.chessId], unit) : p.packet?.stats.find(u => u.uid === p.selected)?.range || [];
    view.highlightTiles(range, 'range');
  }, [view, props.selected, props.doc, props.armed, props.packet, props.field, facing]);
  const onDrop = e => {
    if (!props.editable || !view) return;
    e.preventDefault();
    let payload;
    try { payload = JSON.parse(e.dataTransfer.getData('application/x-training')); } catch { return; }
    const entries = props.mapEntries;
    const tile = tileAtClient(view, entries, e.clientX, e.clientY);
    if (tile) props.onLibraryDrop?.(payload, tile, view, setFacing);
  };
  const chosen = facing && props.doc.plans[props.side][props.field]?.units.find(u => u.uid === facing.uid);
  const facedRecord = props.raw.chess[chosen?.chessId || facing?.unit?.chessId];
  return html`<section class="tf-field" data-side=${props.side} aria-label=${t('方案 {side} 的战场', { side: props.side })}>
    <span class="tf-field-label">${props.side}${props.dual ? ` · ${t('方案 {side}', { side: props.side })}` : ''}</span>
    <div class="tf-canvas" ref=${host} data-testid="training-canvas" data-ready=${!!view} data-render=${status}
      onDragOver=${e => { if (props.editable) e.preventDefault(); }} onDrop=${onDrop}></div>
    ${status === 'loading' ? html`<div class="tf-field-loading" role="status">${t('正在载入游戏画面…')}</div>` : null}
    ${status === 'fallback' ? html`<span class="tf-render-note">${t('已使用简化战场，仍可部署与演练')}</span>` : null}
    ${facing && view ? html`<${FacingWheel} view=${view} row=${facing.row} col=${facing.col} grid=${trainingRange(facedRecord, chosen || facing.unit)}
      name=${data.localeName(facedRecord?.name || '')} onPreview=${dir => { if (dir && facing.uid) view.setPieceDir?.(facing.uid, dir); }}
      onCommit=${dir => { props.onFacing?.({ ...facing, dir }); setFacing(null); }}
      onCancel=${() => { props.onFacingCancel?.(facing); setFacing(null); }} />` : null}
  </section>`;
}
