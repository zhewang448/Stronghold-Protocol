import '../ui/compat.js';
import { render } from '../../vendor/preact.module.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from '../ui/components.js';
import { initLang, useLang, LangToggle } from '../ui/lang.js';
import { data, useData } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { emptyPlayer, cloneScenario } from '../../../shared/studio/scenario.js';
import { trainingFingerprint, copyTrainingPlan, parseTraining } from '../../../shared/training.js';
import { SIM_DATA_FILES } from '../battle/simLoader.js';
import { TrainingClient, trainingRequest } from './client.js';
import { personalUnit, readLibrary, writeLibrary, storedTraining } from './model.js';
import { Select, numeric } from './ui.js';
import { TrainingPlayback } from './playback.js';
import { TrainingBattlefield } from './battlefield.js';
import { TrainingLibrary, TrainingInspector, TrainingResults, TrainingConditions, TrainingBondStrip } from './panels.js';
import { autoTrainingPlacement, legalTrainingTile } from './placement.js';
import { settingsStore } from '../ui/settingsStore.js';
import { Icon } from '../ui/components.js';
const debug = { views: {}, facingSetters: {}, packets: {} };
globalThis.__TRAINING__ = debug;

const FILES = [...new Set([...SIM_DATA_FILES, 'config', 'choices', 'bosses', 'backups'])];
function describe(error) {
  if (error.path === 'cs') return t('游戏数据已更新，请重新选择版本后试算。');
  if (error.path === 'version') return t('该版本当前不可用，请选择其他版本或重试。');
  if (error.path?.includes('units') || error.path === 'players') return t('请先选择干员并完成部署。');
  if (error.path?.includes('unit')) return t('部署或配置不符合规则，请检查地格、装备与召唤物位置。');
  if (error.path) return t('场景配置无效，请检查相关选项。');
  return t('试算未完成，配置已保留，请重试。');
}
async function fetchData(options) {
  const entries = await Promise.all(FILES.map(async file => {
    const response = await fetch(`${options.dataBase}${file}.json`, { cache: 'no-cache' });
    if (!response.ok) throw new Error('TRAINING_DATA');
    return [file, await response.json()];
  }));
  return Object.fromEntries(entries);
}
function readPreference() { try { return JSON.parse(localStorage.getItem('sp.pref.loadout') || '{}'); } catch { return {}; } }
function App() {
  const lang = useLang();
  useData('assets');
  const [options, setOptions] = useState(null), [raw, setRaw] = useState(null), [doc, setDoc] = useState(null);
  const [side, setSide] = useState('A'), [field, setField] = useState(0), [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null), [palette, setPalette] = useState(null), [compiled, setCompiled] = useState(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [results, setResults] = useState({}), [mobileTab, setMobileTab] = useState('config');
  const [library, setLibrary] = useState(readLibrary), [savedIndex, setSavedIndex] = useState('');
  const [phase, setPhase] = useState('prep'), [packets, setPackets] = useState({});
  const [playState, setPlayState] = useState({ playing: false, seconds: 0, speed: 1, finished: false });
  const [dual, setDual] = useState(false), [desktop, setDesktop] = useState(innerWidth >= 1200);
  const [conditions, setConditions] = useState(false), [display, setDisplay] = useState(false), [activeBond, setActiveBond] = useState(null);
  const [tab, setTab] = useState('chess'), [armedItem, setArmedItem] = useState(null), [equipSlot, setEquipSlot] = useState(null);
  const [notice, setNotice] = useState(''), [compiledBoth, setCompiledBoth] = useState({});
  const [prefs, setPrefs] = useState(() => { let saved = {}; try { saved = JSON.parse(localStorage.getItem('sp.training.view.v1') || '{}'); } catch {} return { board: saved.board || '3d', fx: saved.fx || 'lite', quality: saved.quality || settingsStore.get().quality || 'medium' }; });
  const playback = useRef(null), fingerprints = useRef({}), currentDoc = useRef(null);
  currentDoc.current = doc;
  if (!playback.current) playback.current = new TrainingPlayback({ onState: setPlayState, onError: e => setError(describe(e)), onPacket: (s, packet) => {
    debug.packets[s] = packet; setPackets(previous => ({ ...previous, [s]: packet }));
    if (packet.finished && fingerprints.current[s] === trainingFingerprint(currentDoc.current, s)) setResults(previous => ({ ...previous, [s]: { fingerprint: fingerprints.current[s], value: packet.metrics } }));
  } });
  const [loading, setLoading] = useState(true), [validationError, setValidationError] = useState('');
  const [, refreshText] = useState(0);
  const client = useRef(null), revision = useRef(0), bootRevision = useRef(0), file = useRef(null), latest = useRef(null);
  const legacyRaw = useRef(null), compileRevision = useRef(0), libraryRef = useRef(library);
  if (!client.current) client.current = new TrainingClient();
  libraryRef.current = library;
  latest.current = doc;
  const cancel = () => { revision.current++; client.current.cancel(); playback.current.stop(); debug.packets = {}; setBusy(false);  };
  const update = next => { cancel(); setPhase('prep'); setPackets({}); setCompiledBoth({}); setDoc(next); setCompiled(null);  setError(''); };
  const boot = async (version, incoming = null) => {
    cancel(); const id = ++bootRevision.current; setLoading(true); setConditions(false); setActiveBond(null); setArmedItem(null); setError('');
    try {
      const o = await trainingRequest(`options${version ? `?version=${encodeURIComponent(version)}` : ''}`);
      const nextRaw = await fetchData(o);
      if (id !== bootRevision.current) return;
      let next = incoming || o.document;
      if (!incoming) {
        try { const saved = libraryRef.current.drafts[o.version]; if (saved) next = storedTraining(saved); } catch { /* keep the empty version's document */ }
      }
      if (next.version !== o.version) throw new Error('TRAINING_VERSION');
      if (next.cs !== o.cs) { next = { ...next, cs: o.cs }; setError(t('已加载新版本数据，请检查方案后重新试算。')); }
      if (incoming) {
        for (const activeSide of ['A', 'B']) if (next.plans[activeSide].some(p => p.units.some(u => u.kind === 'chess'))) {
          await trainingRequest('build', { body: { document: next, side: activeSide } });
        }
        if (id !== bootRevision.current) return;
      }
      data.setContent({ id: o.cs, values: nextRaw, langs: ['en', 'ja', 'ko', 'zh-TW'], overlay: async code => {
        try { const r = await fetch(`${o.dataBase}i18n/${code}.json`); return r.ok ? r.json() : null; } catch { return null; }
      } });
      await data.loadAll('assets');
      if (id !== bootRevision.current) return;
      setPhase('prep'); setPackets({}); setCompiledBoth({}); setOptions(o); setRaw(nextRaw); setDoc(next); setResults({}); setCompiled(null);
      setField(0); setSide('A'); setQuery(''); setMobileTab('config'); setSelected(next.plans.A[0].units.find(u => u.kind === 'chess')?.uid ?? null); setPalette(null);
    } catch (e) { if (id === bootRevision.current) setError(describe(e)); }
    finally { if (id === bootRevision.current) setLoading(false); }
  };
  useEffect(() => {
    const version = new URLSearchParams(location.search).get('version');
    boot(version);
    return () => { playback.current.stop(); client.current.cancel(); revision.current++; bootRevision.current++; };
  }, []);
  useEffect(() => { document.title = t('作战试算'); }, [lang]);
  useEffect(() => data.subscribe(name => { if (FILES.includes(name)) refreshText(n => n + 1); }), []);
  useEffect(() => {
    if (!doc) return;
    const next = { ...libraryRef.current, drafts: { ...libraryRef.current.drafts, [doc.version]: doc } };
    setLibrary(next); if (!writeLibrary(next)) setNotice(t('浏览器无法保存，请导出方案文件。'));
  }, [doc]);
  useEffect(() => {
    const id = ++compileRevision.current;
    setCompiled(null); setValidationError('');
    if (phase !== 'prep' || !doc || !raw || loading || !doc.plans[side].some(p => p.units.some(u => u.kind === 'chess'))) return;
    const controller = new AbortController();
    const timer = setTimeout(() => trainingRequest('build', { body: { document: doc, side }, signal: controller.signal })
      .then(value => { if (id === compileRevision.current) { setCompiled(value); setCompiledBoth(previous => ({ ...previous, [side]: value })); } })
      .catch(e => { if (e.name !== 'AbortError' && id === compileRevision.current) setValidationError(describe(e)); }), 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [doc, raw, side, loading, phase]);

  useEffect(() => {
    const resize = () => { setDesktop(innerWidth >= 1200); if (innerWidth < 1200) setDual(false); };
    const hide = () => { if (document.hidden) playback.current.pause(); };
    window.addEventListener('resize', resize); document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', hide); };
  }, []);
  useEffect(() => { try { localStorage.setItem('sp.training.view.v1', JSON.stringify(prefs)); } catch {} }, [prefs]);
  const chooseSide = value => { setArmedItem(null); setActiveBond(null); setSide(value); setField(0); setPalette(null); setSelected(doc.plans[value][0].units[0]?.uid ?? null); };
  const writePlayer = patch => update({ ...doc, plans: { ...doc.plans, [side]: doc.plans[side].map((p, i) => i === field ? { ...p, ...patch } : p) } });
  const writeEnvironment = patch => update({ ...doc, environment: { ...doc.environment, ...patch } });
  const clearBoards = patch => {
    const plans = patch.plans || Object.fromEntries(['A', 'B'].map(id => [id, doc.plans[id].map(p => ({ ...p, units: [], deviceOverrides: {} }))]));
    update({ ...doc, ...patch, plans }); setSelected(null); setPalette(null);
  };
  const pick = async rec => {
    if (!legacyRaw.current && readPreference().v !== 2) {
      try { legacyRaw.current = { chess: await (await fetch('/data/chess.json')).json() }; } catch { /* current defaults remain usable */ }
    }
    if (latest.current !== doc) return;
    const unit = personalUnit(rec, raw, readPreference(), legacyRaw.current);
    if (phase !== 'prep') return;
    if (doc.mode === 'unit') {
      const placed = autoTrainingPlacement(rec, unit, options.deployMaps.training_lane.normal); if (!placed) return; writePlayer({ units: [{ ...placed, uid: 1 }] }); setSelected(1); setPalette(null);
      if (rec.dmgType === 'heal' || rec.profession === 'MEDIC' || rec.profession === 'SUPPORT') setNotice(t('治疗或特殊触发技能需要相应目标，可改用阵容模拟。'));
    } else { setPalette(unit); setSelected(null); }
  };
  const modifyUnit = patch => {
    const p = doc.plans[side][field];
    if (p.units.some(u => u.uid === selected)) writePlayer({ units: p.units.map(u => u.uid === selected ? { ...u, ...patch } : u) });
    else if (palette) setPalette({ ...palette, ...patch });
  };
  const changeForm = value => {
    const rec = raw.chess[value]; if (!rec) return;
    const p = doc.plans[side][field], old = p.units.find(u => u.uid === selected) || palette;
    const unit = personalUnit(rec, raw, readPreference(), legacyRaw.current);
    if (old) modifyUnit({ ...unit,
      skillIndex: rec.skills?.some(sk => sk.index === old.skillIndex) ? old.skillIndex : unit.skillIndex ?? rec.skill?.index ?? 0,
      moduleId: rec.modules?.some(m => m.uniEquipId === old.moduleId) ? old.moduleId : unit.moduleId ?? rec.modules?.find(m => m.isDefault)?.uniEquipId ?? 'none',
      potential: old.potential ?? unit.potential ?? 6, cultivate: old.cultivate ?? unit.cultivate ?? 3, items: old.items || [] });
  };
  const run = async sides => {
    cancel(); const id = revision.current, snapshot = cloneScenario(doc); setBusy(true); setError('');
    try {
      for (let i = 0; i < sides.length; i++) {
        const activeSide = sides[i], fingerprint = trainingFingerprint(snapshot, activeSide);
        const built = await trainingRequest('build', { body: { document: snapshot, side: activeSide } });
        if (id !== revision.current) return;
        const value = await client.current.run(built, raw);
        if (id !== revision.current || trainingFingerprint(latest.current, activeSide) !== fingerprint) return;
        setResults(prev => ({ ...prev, [activeSide]: { fingerprint, value } }));
      }
      setMobileTab('results');
    } catch (e) { if (id === revision.current && e.name !== 'AbortError') setError(describe(e)); }
    finally { if (id === revision.current) { setBusy(false);  } }
  };
  const save = () => {
    const name = doc.name.trim() || t('未命名试算');
    const saved = cloneScenario({ ...doc, name });
    const next = { ...library, saved: [saved, ...library.saved.filter(s => s.name !== name || s.version !== doc.version)].slice(0, 20) };
    setLibrary(next); if (!writeLibrary(next)) setNotice(t('浏览器无法保存，请导出方案文件。')); setSavedIndex('0');
  };
  const exportDoc = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'stronghold-training.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importFile = async e => {
    const chosen = e.currentTarget.files?.[0]; e.currentTarget.value = '';
    if (!chosen) return;
    try { if (chosen.size > 512 * 1024) throw new Error('size'); const incoming = parseTraining(await chosen.text()); await boot(incoming.version, incoming); }
    catch { setError(t('无法导入该方案，请检查文件格式和大小。')); }
  };
  if (!doc || !raw || !options) return html`<main class="tf-boot"><h1>${t('作战试算')}</h1><p class="tr-note">${loading ? t('正在加载游戏数据…') : error}</p>
    ${!loading ? html`<button type="button" onClick=${() => boot()}>${t('重试')}</button>` : null}<p class="tr-note"><a href="/">${t('返回大厅')}</a></p></main>`;
  const player = doc.plans[side][field] || doc.plans[side][0];
  const unit = player.units.find(u => u.uid === selected) || palette;
  const rec = raw.chess[unit?.chessId];
  const isUnit = doc.mode === 'unit';
  const stageId = isUnit ? 'training_lane' : doc.environment.stageId;
  const map = new Map(options.deployMaps[stageId]?.[doc.environment.kind === 'normal' ? 'normal' : field ? 'bossR' : 'bossL'] || []);
  const current = Object.fromEntries(['A', 'B'].map(id => [id, results[id]?.fingerprint === trainingFingerprint(doc, id)]));
  const editable = phase === 'prep' && !busy && !loading;
  const activePacket = phase !== 'prep' ? packets[side] : null;
  const nativeCompiled = compiledBoth[side] || (compiled?.side === side ? compiled : null);
  const legalEntries = map.size ? [...map].filter(([, type]) => legalTrainingTile(raw.chess[palette?.chessId || unit?.chessId] || raw.tokens[palette?.tokenId || unit?.tokenId], type)) : [];
  const tokens = (nativeCompiled?.tokens[field] || []).map(slot => ({ ...slot, remaining: slot.count - player.units.filter(u => u.tokenId === slot.tokenId && u.ownerUid === slot.ownerUid).length }));
  debug.doc = doc; debug.raw = raw; debug.phase = phase; debug.palette = palette; debug.compiled = compiledBoth; debug.playback = playback.current;
  const returnToPrep = () => { cancel(); setPackets({}); setPhase('prep'); setNotice(''); };
  const startRehearsal = async () => {
    cancel(); const id = revision.current, snapshot = cloneScenario(doc);
    const sides = ['A', 'B'].filter(s => snapshot.plans[s].some(p => p.units.some(u => u.kind === 'chess')));
    if (!sides.length) { setError(t('请先选择干员并完成部署。')); return; }
    setBusy(true); setError(''); setPackets({});
    try {
      const builds = {};
      for (const s of sides) {
        builds[s] = await trainingRequest('build', { body: { document: snapshot, side: s } });
        if (id !== revision.current) return;
        fingerprints.current[s] = trainingFingerprint(snapshot, s);
      }
      setCompiledBoth(builds); setPhase('battle'); setPalette(null); setConditions(false); setArmedItem(null);
      await playback.current.start(builds, raw);
    } catch (e) { if (id === revision.current && e.name !== 'AbortError') { setError(describe(e)); setPhase('prep'); } }
    finally { if (id === revision.current) setBusy(false); }
  };
  const equipItem = (id, uid = selected) => {
    const u = player.units.find(u => u.uid === uid);
    if (!u?.chessId) { setArmedItem(id); setNotice(t('点击场上干员配发装备')); return; }
    const items = [...u.items], index = equipSlot ?? (items.length < 2 ? items.length : 1); items[index] = id;
    writePlayer({ units: player.units.map(v => v.uid === uid ? { ...v, items: items.filter(Boolean) } : v) });
    setArmedItem(null); setEquipSlot(null); setSelected(uid); setMobileTab('detail');
  };
  const requestFacing = (uid, tile, view, setter, newUnit = null) => {
    const chosen = newUnit || player.units.find(u => u.uid === uid); if (!chosen) return;
    view?.holdPiece?.(uid, tile); setter?.({ ...tile, uid, unit: chosen, newUnit: !!newUnit });
  };
  const commitFacing = (action, which) => {
    const p = doc.plans[which][field];
    const next = { ...action.unit, uid: action.uid, row: action.row, col: action.col, dir: action.dir };
    update({ ...doc, plans: { ...doc.plans, [which]: doc.plans[which].map((v, i) => i === field ? { ...v, units: action.newUnit ? [...p.units, next] : p.units.map(u => u.uid === action.uid ? next : u) } : v) } });
    debug.views[which]?.holdPiece?.(action.uid, null); setSelected(action.uid); setPalette(null); setNotice('');
  };
  const nativePlace = (tile, view, setter, payload = null) => {
    const occupied = player.units.find(u => u.row === tile.row && u.col === tile.col);
    if (payload?.kind === 'item') { if (occupied) equipItem(payload.id, occupied.uid); return; }
    if (occupied) { setSelected(occupied.uid); setMobileTab('detail'); return; }
    let choice = payload?.kind === 'chess' ? personalUnit(raw.chess[payload.id], raw, readPreference(), legacyRaw.current)
      : payload?.kind === 'token' ? { kind: 'token', tokenId: payload.id, ownerUid: payload.ownerUid, dir: 'RIGHT' }
      : palette || player.units.find(u => u.uid === selected);
    if (!choice) return;
    if (!legalTrainingTile(raw.chess[choice.chessId] || raw.tokens[choice.tokenId], map.get(`${tile.row},${tile.col}`))) { setNotice(t('该单位不能部署在此地格')); return; }
    if (isUnit && choice.kind === 'chess' && choice.uid == null) {
      writePlayer({ units: [{ ...choice, uid: 1, ...tile }] }); setSelected(1); setPalette(null); return;
    }
    const uid = choice.uid ?? Math.max(0, ...doc.plans[side].flatMap(p => p.units.map(u => u.uid))) + 1;
    requestFacing(uid, tile, view, setter, choice.uid == null ? choice : null);
  };
  const inspectPiece = (hit, which) => {
    if (which !== side) { setSide(which); setField(0); }
    const uid = hit.uid ?? packets[which]?.meta.units.find(u => u.id === hit.unitId)?.uid;
    if (uid) { if (armedItem && editable) equipItem(armedItem, uid); else { setSelected(uid); setMobileTab('detail'); } }
  };
  const sameFields = action => {
    const plans = action.resetFields ? { A: [emptyPlayer()], B: [emptyPlayer()] } : undefined;
    const { resetFields: _reset, ...patch } = action; clearBoards({ ...patch, ...(plans ? { plans } : {}) });
  };
  const shownSides = dual && desktop ? ['A', 'B'] : [side];
  return html`<main class="tf-app" data-phase=${phase} data-panel=${mobileTab} aria-busy=${loading}>
    <header class="tf-header"><a href="/" class="tf-back" aria-label=${t('返回大厅')}><${Icon} name="chevronLeft" /></a><h1>${t('作战试算')}</h1>
      <select aria-label=${t('版本')} data-testid="training-version" value=${doc.version} disabled=${busy || loading} onChange=${e => boot(e.currentTarget.value)}>${options.versions.map(v => html`<option key=${v.id} value=${v.id}>${t(v.label)}</option>`)}</select>
      <div class="tf-mode-switch"><button type="button" disabled=${!editable} aria-pressed=${isUnit} data-testid="training-unit" onClick=${() => sameFields({ mode: 'unit', environment: { ...doc.environment, kind: 'normal', fields: 1, round: 1, seconds: 60, bossId: null }, resetFields: true })}>${t('单干员')}</button>
        <button type="button" disabled=${!editable} aria-pressed=${!isUnit} data-testid="training-team" onClick=${() => sameFields({ mode: 'team', environment: { ...doc.environment, kind: 'normal', fields: 1, seconds: 240, bossId: null }, resetFields: true })}>${t('阵容')}</button></div>
      <button type="button" class="tf-condition-button" data-testid="training-conditions-open" disabled=${!editable} onClick=${() => setConditions(!conditions)}><${Icon} name="settings" /><span>${isUnit ? `${t('木桩')} · ${doc.environment.seconds}s` : `${data.localeName(raw.stages[doc.environment.stageId]?.name)} · R${doc.environment.round}`}</span></button>
      <div class="tf-header-end"><button type="button" aria-label=${t('画面设置')} onClick=${() => setDisplay(!display)}><${Icon} name="eye" /></button><${LangToggle} /></div>
    </header>
    <div class="tf-workbar"><div class="tf-tabs" aria-label=${t('方案')}><button type="button" aria-pressed=${side === 'A'} onClick=${() => chooseSide('A')}>A</button><button type="button" data-testid="training-side-b" aria-pressed=${side === 'B'} onClick=${() => chooseSide('B')}>B</button></div>
      <button type="button" disabled=${!editable} data-testid="training-copy" onClick=${() => { const to = side === 'A' ? 'B' : 'A'; update(copyTrainingPlan(doc, side, to)); setSide(to); setField(0); setSelected(doc.plans[side][0].units[0]?.uid || null); }}><${Icon} name="copy" />${side === 'A' ? t('复制 A → B') : t('复制 B → A')}</button>
      ${desktop ? html`<button type="button" data-testid="training-dual" aria-pressed=${dual} onClick=${() => setDual(!dual)}>${t('同步双屏')}</button>` : null}
      ${doc.environment.kind !== 'normal' ? html`<select aria-label=${t('玩家阵地')} value=${field} onChange=${e => { setField(+e.currentTarget.value); setSelected(null); }}>${doc.plans[side].map((_, i) => html`<option key=${i} value=${i}>${t('阵地 {n}', { n: i + 1 })}</option>`)}</select>
        <button type="button" disabled=${!editable} onClick=${() => { const n = doc.environment.fields === 1 ? 2 : 1; update({ ...doc, environment: { ...doc.environment, fields: n }, plans: Object.fromEntries(['A', 'B'].map(s => [s, n === 2 ? [...doc.plans[s], emptyPlayer()] : doc.plans[s].slice(0, 1)])) }); setField(0); }}>${doc.environment.fields === 1 ? t('添加第二阵地') : t('移除第二阵地')}</button>` : null}
      <span class="tf-mode-status">${phase === 'prep' ? t('备战') : t('演练')}</span></div>
    ${error || validationError ? html`<div class="tf-error" role="alert">${error || validationError}<button type="button" onClick=${() => boot(doc.version, doc)}>${t('重试')}</button><button type="button" onClick=${() => { setError(''); setValidationError(''); }}>${t('关闭')}</button></div>` : null}
    <div class="tf-main"><section class="tf-arena"><${TrainingBondStrip} raw=${raw} player=${player} compiled=${nativeCompiled} field=${field} mode=${doc.mode} activeBond=${activeBond} setActiveBond=${setActiveBond} updatePlayer=${writePlayer} editable=${editable} />
      <div class=${`tf-battlefields${dual && desktop ? ' is-dual' : ''}`}>${shownSides.map(s => html`<${TrainingBattlefield} key=${s} side=${s} doc=${doc} field=${field} raw=${raw} options=${options} compiled=${compiledBoth[s] || (s === side ? compiled : null)}
        packet=${phase !== 'prep' ? packets[s] : null} editable=${editable} selected=${s === side ? selected : null} armed=${!!palette || !!armedItem} mapEntries=${[...map]} legalEntries=${legalEntries}
        prefs=${prefs} speed=${playState.speed} playing=${playState.playing} dual=${dual && desktop}
        onView=${(s, v) => { debug.views[s] = v; }} onFacingSetter=${(s, setter) => { debug.facingSetters[s] = setter; }}
        onPiece=${hit => inspectPiece(hit, s)} onTile=${(tile, view) => { if (s === side) nativePlace(tile, view, debug.facingSetters[s]); }}
        onMove=${(uid, tile, view, setter) => { if (s === side) requestFacing(uid, tile, view, setter); }}
        onLibraryDrop=${(payload, tile, view, setter) => { if (s === side) nativePlace(tile, view, setter, payload); }}
        onFacing=${action => commitFacing(action, s)} onFacingCancel=${action => debug.views[s]?.holdPiece?.(action.uid, null)} />`)}</div>
      <p class="tf-context-hint" role="status">${notice || (phase === 'prep' ? palette ? t('点击亮起地格部署，再选择朝向。') : t('选干员即可开始；点击场上单位调整搭配。') : t('点击单位查看状态；返回备战后可修改。'))}</p>
      <nav class="tf-mobile-nav">${[['config', t('单位库')], ['detail', t('单位详情')], ['results', t('统计')]].map(([id, label]) => html`<button type="button" key=${id} aria-pressed=${mobileTab === id} onClick=${() => setMobileTab(id)}>${label}</button>`)}</nav>
      <${TrainingLibrary} raw=${raw} tab=${tab} setTab=${setTab} query=${query} setQuery=${setQuery} palette=${palette} armedItem=${armedItem} tokens=${tokens} editable=${editable}
        onPick=${r => { pick(r); setArmedItem(null); }} onItem=${id => { if (selected) equipItem(id); else { setArmedItem(id); setNotice(t('点击场上干员配发装备')); } }}
        onToken=${slot => { setPalette({ kind: 'token', tokenId: slot.tokenId, ownerUid: slot.ownerUid, dir: 'RIGHT' }); setSelected(null); }} />
    </section><aside class="tf-sidebar"><${TrainingInspector} raw=${raw} unit=${player.units.find(u => u.uid === selected)} editable=${editable} live=${activePacket?.stats.find(u => u.uid === selected && u.ownerId === `console-${field + 1}`)} onChange=${modifyUnit}
      onForm=${() => { if (!rec) return; const id = rec.isGolden ? rec.baseId : rec.goldenId; changeForm(id); }}
      onEquip=${i => { setTab('items'); setQuery(''); setEquipSlot(i); setMobileTab('config'); setNotice(t('从下方装备库选择装备')); }}
      onUnequip=${i => modifyUnit({ items: unit.items.filter((_, n) => n !== i) })}
      onRotate=${() => { const view = debug.views[side]; if (unit && view) requestFacing(unit.uid, { row: unit.row, col: unit.col }, view, debug.facingSetters[side]); }}
      onClose=${() => { setSelected(null); setMobileTab('config'); }} onRemove=${() => { writePlayer({ units: player.units.filter(u => u.uid !== selected && u.ownerUid !== selected) }); setSelected(null); }} />
      <${TrainingResults} doc=${doc} side=${side} raw=${raw} results=${results} current=${current} packet=${activePacket} packets=${phase !== 'prep' ? packets : {}}
        onSeek=${seconds => playback.current.seek(seconds).catch(e => setError(describe(e)))}
        onSelect=${row => { const n = Number(row.ownerId?.split('-').at(-1)) - 1; if (n >= 0) setField(n); setSelected(row.uid); setMobileTab('detail'); }} />
    </aside></div>
    <footer class="tf-controls"><div class="tf-play-controls">${phase === 'prep' ? html`<button type="button" class="tf-primary" disabled=${busy || loading} data-testid="training-run" onClick=${startRehearsal}><${Icon} name="play" />${t('开始演练')}</button>
      <button type="button" disabled=${busy || loading} data-testid="training-run-both" onClick=${() => run(['A', 'B'])}>${t('快速对比 A/B')}</button>`
      : html`<button type="button" class="tf-primary" disabled=${busy || playState.busy} data-testid="training-play" onClick=${async () => { if (playState.playing) playback.current.pause(); else { if (playState.finished) await playback.current.seek(0); playback.current.play(); } }}>${playState.playing ? t('暂停') : t('播放')}</button>
        <button type="button" disabled=${playState.busy} onClick=${() => playback.current.seek(0)}>${t('重播')}</button><button type="button" onClick=${returnToPrep} data-testid="training-edit">${t('返回备战调整')}</button>`}</div>
      ${phase !== 'prep' ? html`<label class="tf-timeline">${numeric(playState.seconds)}s<input aria-label=${t('播放进度')} type="range" min="0" max=${doc.environment.seconds} step="0.1" value=${playState.seconds} disabled=${busy || playState.busy} onChange=${e => playback.current.seek(+e.currentTarget.value).catch(e => setError(describe(e)))} /></label>
        <select aria-label=${t('播放速度')} value=${playState.speed} onChange=${e => playback.current.speedTo(+e.currentTarget.value)}>${[.5, 1, 2, 4, 8].map(n => html`<option key=${n} value=${n}>${n}×</option>`)}</select>`
        : html`<span class="tf-footer-note">${t('本机演练 · 不计入战绩')}</span>`}
      ${busy ? html`<button type="button" onClick=${returnToPrep}>${t('取消试算')}</button>` : null}
      ${phase === 'prep' && current[side] ? html`<button type="button" data-testid="training-replay" onClick=${startRehearsal}>${t('查看战斗')}</button>` : null}
    </footer>
    ${conditions ? html`<${TrainingConditions} doc=${doc} raw=${raw} options=${options} player=${player} updatePlayer=${writePlayer} update=${update} onEnvironment=${writeEnvironment} onClear=${sameFields} onClose=${() => setConditions(false)} library=${library} save=${save}
      savedIndex=${savedIndex} setSavedIndex=${setSavedIndex} load=${() => { try { const next = storedTraining(library.saved[+savedIndex]); boot(next.version, next); } catch { setError(t('无法导入该方案，请检查文件格式和大小。')); } }} exportDoc=${exportDoc} importDoc=${() => file.current.click()} />` : null}
    ${display ? html`<aside class="tf-display"><header><h2>${t('画面设置')}</h2><button type="button" onClick=${() => setDisplay(false)}>${t('关闭')}</button></header><${Select} label=${t('棋盘')} value=${prefs.board} options=${[['3d', '3D'], ['2d', '2D']]} onChange=${board => setPrefs({ ...prefs, board })} />
      <${Select} label=${t('官方特效')} value=${prefs.fx} options=${[['off', t('关闭')], ['lite', t('精简')], ['full', t('完整')]]} onChange=${fx => setPrefs({ ...prefs, fx })} /></aside>` : null}
    <input type="file" ref=${file} accept="application/json,.json" hidden onChange=${importFile} />
  </main>`;


}
await initLang().catch(() => {});
render(html`<${App} />`, document.getElementById('app'));
