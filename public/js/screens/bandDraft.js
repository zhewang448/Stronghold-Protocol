import { MatchEnemies } from '../ui/matchEnemies.js';
import { cardOperators, cardContext, rosterOperators, seatOperator, seatCardSkin, seatArtSrc } from '../ui/seatArt.js';
import { chessPortraitUrl } from '../ui/assetUrls.js';
import { skinsStore } from '../ui/skins.js';
import { settingsStore } from '../ui/settingsStore.js';
// Band draft — BAND_DRAFT "2/2 选择策略" (research 06 §4.2, D1): left = draft order (avatar, name, state:
// … waiting / ⌛ 决策中 / chosen band ✓), each group's current picker highlighted; centre = grid of every band allowed
// for the mode type (icon, name, LP); a band a teammate already picked carries the picker's avatar and is marked
// 队友已选 — it cannot be chosen again within that fixed pool group. Other groups' picks only add A–E markers; right =
// detail pane opens on a portrait tap, then the chosen strategy gets the upstream confirmation view.
// The header hosts 跳过 (co-op, once while another manual player is waiting) and the turn status.
// Each fixed group has its own countdown; the step header follows the viewer's group. Legacy single-group frames
// still use m.public.deadline. Every turn has the same clock (Match BAND_TURN_SECONDS), the same number as the
// current picker's row. The highlighted band (the detail pane's) is what a turn that runs out takes: every change of it
// is reported (g.bandFocus) and the server assigns it while it is free, else 「华法琳」, else the first free strategy
// (timeoutBand). It starts on that default, so the tip under the order list always names what a timeout gives.
// Solo, and a co-op match with a single human (the server's soloUntimed: draft.untimed): no clock at all.
// A strategy built around a bond the mode switches off (bands.json bondIds ∩ the mode's inactive bonds — 标准: 潘格尼尼
// 拉特兰, 克莱门莎 阿戈尔, 玛恩纳 卡西米尔; the bot never picks one) reads 本局禁用 on its card and in the detail pane
// (BandOffTag / BandOffNote, DESIGN §21.26, §21.7's look); it stays selectable — information only.
// 本局信息 (GitHub issue #8 item 1, "选策略时没法返回查看禁用的干员和盟约"): the header's 本局信息 opens the
// briefing's bond rows, legend and 本局禁用干员 again, read-only (ui/matchInfo.js MatchInfoDialog — the very blocks of the
// briefing). The draft runs on underneath: its status line repeats the current turn and the countdown (draftInfoStatus),
// a turn change (a pick, a skip, a turn that runs out, an AI pick) closes it, the end of the draft unmounts it, and it
// never touches the highlighted band or the buttons.

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, useTicker, secondsLeft } from '../ui/components.js';
import { useGameData, BandIcon, BondGlyph, RichText, PlayerAvatar, Sprite } from '../ui/gameComponents.js';
import { StepHeader, ExitModal } from '../ui/matchChrome.js';
import { StageMiniMap, stagePreview } from '../ui/stageMiniMap.js';
import { MatchInfoDialog, matchInfoModel, MatchBondDialog, regulationCoreAbsent } from '../ui/matchInfo.js';
// package (对局动画): the 「请选择策略」 band each time a pick becomes the player's (ui/matchIntro.js TurnBanner)
import { actions, act, draftRequestScope } from '../ui/gameActions.js';
import { normalizeDraft, sortedPlayers, pregameStepCount, pregameStepIndex } from '../ui/gameLogic.js';
import { useStore, shallowEqual } from '../store.js';
import { BondPlanDialog, BondPlanBadge, bondPlanStore, loadBondPlanData } from '../ui/bondPlan.js';
import { data, useData } from '../data.js';
import { audio } from '../audio.js';
import { TURN_BANNER_LATE_MS, TurnBanner } from '../ui/turnBanner.js';
import { preloadBootArt, onBootArt } from '../ui/protocolBoot.js';
import { reducedMotion } from '../ui/device.js';
import { modeOffBonds, bandOffBonds, bandOffLine } from '../ui/gameLogic.js';
import { useRise } from '../ui/transitions.js';
import { t, tParts, tName, N_ } from '../../../shared/i18n.js';
import { RANDOM_BAND_ID } from '../../../shared/constants.js';
import { peekStatsRecords, strategyBadgeIds, selfRowOf, aggregateStats } from '../ui/stats.js';
import { useCustomIllust } from '../ui/customIllust.js';
import { CardArtImage } from '../ui/cardArt.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
function DraftPortrait({ player, players, myId }) {
  const customIllust = useCustomIllust(player?.isBot ? null : player?.playerId);
  const localSkins = useStore(s => s.skins || s, Object.is, skinsStore);
  const otherSkins = useStore(s => s.otherSkins !== false, Object.is, settingsStore);
  const [failed, setFailed] = useState([]);
  const list = cardOperators(data.list('chess'), data.get('seat-art'), data.get('assets'), data.get('skins'));
  useData('card-roster');
  const context = cardContext(list, rosterOperators(data.get('card-roster'), list, data.get('assets'), data.get('skins')));
  if (customIllust && !failed.includes(customIllust)) return html`<${CardArtImage} frameKey=${player.playerId === myId ? 'custom' : 'custom:' + player.playerId}
    src=${customIllust} custom=${true} class="dorder__art" onError=${() => setFailed(old => [...old, customIllust])} />`;
  const op = seatOperator(player, context, { myId, myCard: player.card });
  if (!op) return null;
  const skin = seatCardSkin(player, op.chess.charId, { myId, localSkins, players, otherSkins });
  const arts = [chessPortraitUrl(data.get('assets'), op.chess, { skin }), skin ? chessPortraitUrl(data.get('assets'), op.chess) : null];
  const art = seatArtSrc(arts, failed);
  return art ? html`<img class="dorder__art" src=${art} alt="" onError=${() => setFailed(old => [...old, art])} />` : null;
}

/** 规程's strategy sections (activity_table bandDataListDict bandType) in the draft grid, with the official captions. */
const BAND_SECTIONS = Object.freeze({
  GENERAL: Object.freeze({ id: 'general', name: N_('泛用型策略'), icon: 'crown' }),
  BONDRELEVANT: Object.freeze({ id: 'bond', name: N_('盟约型策略'), icon: 'link' }),
});


const NO_RECORDS = Object.freeze({ won: {}, badges: new Set(), trophies: 0 });

/** Local strategy progress; test matches, training and inherited AI seats never earn personal badges. */
export function draftRecords(records, bands) {
  const valid = (Array.isArray(records) ? records : []).filter(rec => rec && rec.end !== 'quit' && rec.test !== true && rec.difficulty !== 'TRAINING' && rec.modeId !== 'mode_training_1' && !Number.isInteger(selfRowOf(rec)?.aiTakeoverRound));
  const won = {};
  for (const rec of valid) { const self = selfRowOf(rec); if (self?.bandId && self.victory) won[self.bandId] = (won[self.bandId] || 0) + 1; }
  return { won, badges: new Set(strategyBadgeIds(valid, bands)), trophies: aggregateStats(valid).trophies };
}

/** 本局禁用 on a strategy card whose bonds `names` the mode switches off (bandOffBonds); nothing otherwise. */
export function BandOffTag({ names = [] }) {
  return names.length ? html`<span class="dband__off" title=${bandOffLine(names)}>${t('本局禁用')}</span>` : null;
}

/** The detail pane's note for such a strategy: "本局禁用【拉特兰】盟约，此策略效果可能无法发挥" (the bond names struck through). */
export function BandOffNote({ names = [] }) {
  if (!names.length) return null;
  return html`<p class="draft-detail__off" role="note" aria-label=${bandOffLine(names)}><${Icon} name="info" /><span>${tParts('本局禁用{names}盟约，此策略效果可能无法发挥', { names: names.map((n, i) => html`<span key=${i}>${tParts('【{name}】', { name: html`<s class="draft-detail__offname">${n}</s>` })}</span>`) })}</span></p>`;
}

/**
 * Bands selectable in a mode (modeTypeList contains the mode's type), sorted by sortId.
 * @param {any[]} bands
 * @param {string|null} modeType 'SINGLE'|'MULTI'
 * @param {string|null} [modeId] specific mode exclusions (regulation 极速模拟)
 */
export function allowedBands(bands, modeType, modeId = null) {
  const sid = (b) => (Number.isFinite(b.sortId) ? b.sortId : 99);
  return (Array.isArray(bands) ? bands : [])
    .filter((b) => b && (!modeType || !Array.isArray(b.modeTypeList) || b.modeTypeList.includes(modeType))
      && (!modeId || !Array.isArray(b.inactiveModeIds) || !b.inactiveModeIds.includes(modeId)))
    .sort((a, b) => sid(a) - sid(b) || (a.bandId < b.bandId ? -1 : a.bandId > b.bandId ? 1 : 0));
}

/** The official default strategy of an automatic assignment (data/config.json bandDraft.timeoutBandId). */
export const DEFAULT_TIMEOUT_BAND = 'band_bldsk';

export function randomBandCard(allowDuplicates = false) {
  return {
    bandId: RANDOM_BAND_ID,
    random: true,
    name: '?',
    effectName: t('随机策略'),
    desc: allowDuplicates ? t('随机抽取一个策略（可与队友重复），并额外获得 1 生命值和 1 资金。') : t('随机抽取一个未被队友选择的策略，并额外获得 1 生命值和 1 资金。'),
    totalHp: null,
  };
}

export function bandRecord(gd, bandId, allowDuplicates = false) {
  return bandId === RANDOM_BAND_ID ? randomBandCard(allowDuplicates) : gd.band(bandId);
}

/**
 * The strategy the server assigns me when my turn times out (server/match/match/phases.js defaultBand): the official default
 * 「华法琳」 while no teammate holds it, else the first free strategy in draft order (sortId) — never one a teammate
 * already picked (队友已选).
 * @param {any[]} bands allowedBands(...) (sortId order)
 * @param {Map<string, any>} taken teammateBands(...)
 * @param {string} [defaultId]
 * @returns {string|null}
 */
export function timeoutBand(bands, taken, defaultId = DEFAULT_TIMEOUT_BAND) {
  const list = (Array.isArray(bands) ? bands : []).filter((band) => band?.bandId !== RANDOM_BAND_ID);
  const has = (id) => !!(taken && typeof taken.has === 'function' && taken.has(id));
  if (defaultId && !has(defaultId) && (!list.length || list.some((b) => b.bandId === defaultId))) return defaultId;
  return list.find((b) => !has(b.bandId))?.bandId || defaultId || null;
}

/**
 * Bands taken by teammates (队友已选): bandId → the picking players (never the viewer).
 * @param {Map<string, string>} picks normalizeDraft(...).picks (playerId → bandId)
 * @param {string} myId
 */
export function teammateBands(picks, myId) {
  const out = new Map();
  for (const [pid, bid] of picks instanceof Map ? picks : []) {
    if (pid === myId || typeof bid !== 'string') continue;
    if (!out.has(bid)) out.set(bid, []);
    out.get(bid).push(pid);
  }
  return out;
}

/**
 * The band the detail pane shows (= the highlighted band a turn that runs out takes): the current one, else my pick,
 * else the band a timeout would give me (timeoutBand: 「华法琳」 while free, else the first free one). When it is my
 * turn and the shown band was taken meanwhile (队友已选), that default instead (confirm would be disabled).
 * @param {string|null} sel
 * @param {{ bands: any[], taken: Map<string, any>, myPick: string|null, myTurn: boolean, defaultId?: string }} o
 */
export function draftSelection(sel, { bands, taken, myPick, myTurn, defaultId = DEFAULT_TIMEOUT_BAND }) {
  if (sel === RANDOM_BAND_ID && myPick) return myPick;
  if (!Array.isArray(bands) || !bands.length) return sel;
  const free = timeoutBand(bands, taken, defaultId) || bands[0].bandId;
  if (!sel) return myPick || free;
  if (!myPick && myTurn && taken.has(sel)) return free;
  return sel;
}

/**
 * The strategy a turn that runs out assigns me (server Match.timeoutBand): the highlighted band while it is one of
 * the mode's and no teammate holds it, else timeoutBand. Null after my pick.
 * @param {string|null} sel the highlighted band
 * @param {{ bands: any[], taken: Map<string, any>, myPick?: string|null, defaultId?: string }} o
 */
export function autoPickBand(sel, { bands, taken, myPick = null, defaultId = DEFAULT_TIMEOUT_BAND }) {
  if (myPick) return null;
  if (sel === RANDOM_BAND_ID) return RANDOM_BAND_ID;
  const list = (Array.isArray(bands) ? bands : []).filter((band) => band?.bandId !== RANDOM_BAND_ID);
  const has = (id) => !!(taken && typeof taken.has === 'function' && taken.has(id));
  if (sel && !has(sel) && list.some((b) => b.bandId === sel)) return sel;
  return timeoutBand(list, taken, defaultId);
}

/**
 * The tip under the co-op draft order: the one skip, the turn clock and what a turn that runs out assigns me (the
 * highlighted band while free — autoPickBand). Untimed drafts (a single human) name no clock.
 * @param {{ timed: boolean, turnSeconds?: number|null, autoName?: string|null, selected?: boolean }} o
 *   selected: the auto pick is the highlighted band (not the default standing in for a band a teammate holds)
 */
export function draftTip({ timed, turnSeconds = null, autoName = null, selected = true, grouped = false }) {
  const skip = grouped ? t('联合模拟有其他手动玩家待选时可跳过一次') : t('联合模拟在选择策略时可以进行一次跳过');
  if (!timed) return t('{skip}；本局不限时', { skip });
  const clock = Number(turnSeconds) > 0 ? t('每位博士有 {n} 秒', { n: Math.round(turnSeconds) }) : t('每位博士限时决策');
  if (!autoName) return t('{skip}；{clock}', { skip, clock });
  return selected ? t('{skip}；{clock}，超时将自动选择当前选中的「{autoName}」', { skip, clock, autoName })
    : t('{skip}；{clock}，超时将自动选择「{autoName}」', { skip, clock, autoName });
}

/** A skip may only yield to another player who can still choose manually, before any automated seat. */
export function hasManualTeammateAfter(draft, players, myId) {
  if (!Array.isArray(draft?.order)) return false;
  const at = draft.order.indexOf(myId);
  if (at < 0) return false;
  const picks = draft.picks instanceof Map ? draft.picks : new Map(Object.entries(draft.picks || {}));
  return draft.order.slice(at + 1).some((pid) => {
    const p = players.find((row) => row.playerId === pid);
    return p && p.alive && p.connected && !p.isBot && !p.autoplay && !picks.has(pid);
  });
}

/**
 * The step header's countdown: the normalized own group when provided, otherwise the legacy public clock.
 * A completed or untimed group has no clock.
 * @param {any} pub m.public
 * @param {any} [group] normalized viewer's group
 * @returns {{ deadline: number, total: number|null } | null}
 */
export function draftClock(pub, group = null) {
  const d = group || (pub && typeof pub.draft === 'object' ? pub.draft : null);
  if (!d || d.untimed || (group && d.done)) return null;
  const deadline = group ? Number(d.turnDeadline) || 0 : Number(pub.deadline) > 0 ? Number(pub.deadline) : Number(d.turnDeadline) || 0;
  if (!(deadline > 0)) return null;
  return { deadline, total: Number(d.turnSeconds) > 0 ? Number(d.turnSeconds) : null };
}

/** Other fixed groups that have selected this strategy; they do not consume my group's copy. */
export function otherBandGroups(draft, bandId) {
  return (draft?.groups || []).filter((group) => group.id !== draft.groupId
    && [...group.picks.values()].includes(bandId));
}

/**
 * The status line of the 本局信息 dialog: what the draft does while the dialog covers it — my pick, else whose turn it is
 * with the turn's seconds left (the step header's number; none when untimed), warning at ≤ 10 s like the countdown.
 * @param {{ myPick?: string|null, pickName?: string|null, myTurn: boolean, turnName?: string|null, secs?: number|null,
 *   waiting?: boolean }} o waiting: teammates still have to pick after my pick
 * @returns {{ text: string, secs: number|null, tone: 'mint'|'gold'|'warn'|'dim' }}
 */
export function draftInfoStatus({ myPick = null, pickName = null, myTurn, turnName = null, secs = null, waiting = false }) {
  if (myPick) return { text: `${t('已选择「{name}」', { name: pickName || '' })}${waiting ? t('，等待其他博士') : ''}`, secs: null, tone: 'mint' };
  const s = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : null;
  const tone = s != null && s <= 10 ? 'warn' : 'gold';
  if (myTurn) return { text: t('轮到你决策'), secs: s, tone };
  return { text: turnName ? t('{turnName} 决策中', { turnName }) : t('等待轮到你'), secs: s, tone: s != null ? tone : 'dim' };
}

/** The upstream strategy description, with the effect heading written only once. */
function BandText({ band, class: cls }) {
  const text = band.descRaw || band.desc || '';
  const head = band.effectName && !String(text).includes(`【${band.effectName}】`) ? `【${band.effectName}】` : '';
  return html`<p class=${cls}>${head}<${RichText} text=${text} /></p>`;
}

/** Upstream name-card row, retaining this extension's portraits, group identity and independent clock. */
function OrderRow({ p, i, picked, cur, self, players, myId, gd, onPeek, group, secs }) {
  const flash = useRise(!!picked, 1100);
  const pband = picked ? gd.band(picked) : null;
  return html`<div class=${cx('dorder', cur && 'is-cur', picked && 'is-done', self && 'is-self', flash && 'is-flash')} style=${`--i:${Math.min(i, 3)}`}>
    <div class="dorder__card">
      <${DraftPortrait} player=${p} players=${players} myId=${myId} />
      <span class="dorder__face"><${PlayerAvatar} player=${p} self=${self} />
        ${self ? html`<span class="dorder__me" title=${t('你')}><${Icon} name="user" /></span>` : null}
        ${group ? html`<span class="dorder__group-badge" title=${t('{group}组 · 同组共享卡池', { group: group.label })}>${group.label}</span>` : null}
      </span>
      <div class="dorder__text">
        <b class="dorder__name"><span>${p.name || t('博士')}</span>${p.isBot ? html`<span class="dorder__ai">AI</span>` : null}</b>
        ${p.bondPlan ? html`<${BondPlanBadge} bondId=${p.bondPlan} class="dorder__plan" />` : null}
        <span class="dorder__state">${picked ? html`<span class="t-mint">${pband?.name || t('已选择')}</span>`
          : cur ? html`<span class="t-gold">${t('决策中')}${secs != null ? html`<b class="num dorder__secs">${secs}s</b>` : null}</span>`
          : html`<span class="t-dim">${t('等待中')}</span>`}</span>
      </div>
    </div>
    ${picked ? html`<button type="button" class="dorder__box is-band" onClick=${() => onPeek(picked)} title=${t('查看「{name}」', { name: pband?.name || '' })}>
      <${BandIcon} bandId=${picked} size="md" /><${Icon} name="search" class="dorder__zoom" /></button>`
      : cur ? html`<span class="dorder__box is-cur">${p.isBot ? null : html`<${Icon} name="hourglass" />`}<span>${t('决策中')}</span></span>`
      : html`<span class="dorder__box is-wait"><${Icon} name="dots" /></span>`}
    <span class="dorder__check" aria-hidden="true">${picked ? html`<${Icon} name="check" />` : null}</span>
  </div>`;
}

/** BAND_DRAFT screen. */
export function BandDraftScreen({ held = null } = {}) {
  const livePub = useStore((s) => s.match.public);
  const pub = held || livePub;
  const priv = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  // 预选盟约 BOND PLAN: this browser's own choice (the server echoes it back on every player, so the list below
  // reads it straight off the public view — mine included).
  const myPlan = useStore((v) => v.bondId, shallowEqual, bondPlanStore);
  const roomSolo = useStore((s) => s.room?.mode === 'solo');
  const gd = useGameData();
  const [sel, setSel] = useState(null);
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(null);
  const [busy, setBusy] = useState(null);
  const [exit, setExit] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [local, setLocal] = useState(NO_RECORDS);
  useEffect(() => {
    const id = setTimeout(() => setLocal(draftRecords(peekStatsRecords(), data.get('bands'))), 0);
    return () => clearTimeout(id);
  }, []);
  const orderRef = useRef(null);
  const [bondId, setBondId] = useState(null);
  useEffect(() => { setBondId(null); }, [infoOpen]);

  const mode = gd.config?.modes?.[pub?.modeId];
  const offBonds = modeOffBonds(mode); // the bonds this mode never activates (标准: 10 of 23)
  const solo = roomSolo || mode?.type === 'SINGLE' || String(pub?.modeId || '').includes('single');
  const allowDuplicates = pub.allowDuplicateBands === true;
  const bands = useMemo(() => [randomBandCard(allowDuplicates), ...allowedBands(gd.list('bands'), mode?.type || (solo ? 'SINGLE' : 'MULTI'), pub?.modeId)],
    [gd.ready, mode?.type, pub?.modeId, solo, allowDuplicates, data.locale()]);
  const players = sortedPlayers(pub);
  const draft = normalizeDraft(pub?.draft, players, myId, pub?.poolGroups);
  const grouped = draft.groups.length > 1;
  const myPick = draft.picks.get(myId) || priv?.bandId || null;
  const inOrder = draft.order.includes(myId);
  const myTurn = inOrder && !myPick && (solo || draft.turnPid === myId);
  const skipsLeft = draft.skipsLeft.has(myId) ? draft.skipsLeft.get(myId) : (skipped ? 0 : 1);
  const manualTeammateAfter = hasManualTeammateAfter(draft, players, myId);
  const canSkip = !solo && myTurn && skipsLeft > 0 && (grouped ? manualTeammateAfter : draft.order.filter((pid) => !draft.picks.has(pid)).length > 1);
  const taken = solo || allowDuplicates ? new Map() : teammateBands(draft.picks, myId);
  const pickers = new Map(); // bandId → players
  for (const [pid, bid] of draft.picks) {
    const p = players.find((x) => x.playerId === pid);
    if (!pickers.has(bid)) pickers.set(bid, []);
    pickers.get(bid).push(p || { playerId: pid, name: '?' });
  }

  // default selection: my pick, else what a timeout gives me (华法琳 while free); when my turn comes while the selected
  // band has been taken by a teammate meanwhile (队友已选), move the selection back to that default
  const defaultId = gd.config?.bandDraft?.timeoutBandId || DEFAULT_TIMEOUT_BAND;
  const takenKey = [...taken.keys()].sort().join(',');
  useEffect(() => {
    const next = draftSelection(sel, { bands, taken, myPick, myTurn, defaultId });
    if (next !== sel) setSel(next);
  }, [bands.length, myPick, myTurn, takenKey]);
  // "your turn" cue: the sound, and the event's 请选择策略 band (ui/turnBanner.js) once its art is in
  useEffect(() => { preloadBootArt(); }, []);
  const [turnBanner, setTurnBanner] = useState(0);
  useEffect(() => {
    if (!myTurn) return undefined;
    setInfoOpen(false);
    audio.sfx('yourTurn');
    if (reducedMotion()) return undefined;
    const since = Date.now();
    return onBootArt(() => { if (Date.now() - since <= TURN_BANNER_LATE_MS) setTurnBanner(n => n + 1); });
  }, [myTurn]);
  // The extension's core-bond preference is independent of the draft.
  useEffect(() => { loadBondPlanData(); }, []);

  // the 本局信息 dialog never outlives the turn it was opened in: a turn change (a pick, a skip, a turn that ran out, an
  // AI pick) or my pick closes it, so whoever's turn begins sees the draft
  const turnKey = `${draft.id || ''}|${draft.turnPid || ''}|${myPick || ''}`;
  useEffect(() => { setInfoOpen(false); }, [turnKey]);
  useEffect(() => {
    const selector = grouped ? `.draft-order__group[data-group="${draft.groupId}"] .dorder.is-cur` : '.dorder.is-cur';
    orderRef.current?.querySelector(selector)?.scrollIntoView({ block: 'nearest' });
  }, [draft.id, draft.groupId, draft.turnPid]);

  // The own group's countdown matches its current picker; parallel groups keep independent deadlines.
  const clock = solo ? null : draftClock(pub, draft.groups.length ? draft : null);
  // the highlighted band is what a turn that runs out takes (Match.timeoutBand): report every change before my pick
  const timed = !solo && !!pub?.draft && !draft.untimed;
  const focusSent = useRef(null);
  useEffect(() => {
    // (a spectator seat — community report #26 — is in no draft order: it never reports)
    const focusKey = `${draft.id || ''}:${draft.groupId || ''}:${sel}`;
    if (!timed || myPick || !sel || focusSent.current === focusKey || !draft.order.includes(myId)) return;
    focusSent.current = focusKey;
    act('g.bandFocus', { bandId: sel, ...draftRequestScope({ draftId: draft.id, groupId: draft.groupId }) }, { sfx: false, quiet: true });
  }, [sel, timed, myPick, draft.id, draft.groupId]);

  // what a timeout gives me: the highlighted band while free, else the default (never 队友已选 — match/phases.js timeoutBand)
  const autoId = autoPickBand(sel, { bands, taken, myPick, defaultId });
  const autoName = (autoId && bandRecord(gd, autoId, allowDuplicates)?.name) || bandRecord(gd, defaultId, allowDuplicates)?.name || tName('华法琳');

  const band = sel ? bandRecord(gd, sel, allowDuplicates) : null;
  const selTaken = !!band && band.bandId !== RANDOM_BAND_ID && taken.has(band.bandId);
  const confirm = async () => {
    if (!band || busy || !myTurn || selTaken) return;
    setBusy('pick');
    await actions.band(band.bandId, { draftId: draft.id, groupId: draft.groupId });
    setBusy(null);
  };
  const skip = async () => {
    if (busy || !canSkip) return;
    setBusy('skip');
    if (await actions.bandSkip({ draftId: draft.id, groupId: draft.groupId })) setSkipped(true);
    setBusy(null);
  };
  const pickTile = (id) => { setSel(id); setOpen(true); setPeek(null); audio.sfx('tab', { volume: 0.5 }); };
  const peekBand = (id) => { setPeek(id); setOpen(true); audio.sfx('tab', { volume: 0.5 }); };
  const turnName = players.find((p) => p.playerId === draft.turnPid)?.name;
  useTicker(clock || draft.groups.some((group) => !group.untimed && group.turnDeadline > 0) ? 250 : 0);
  // the picker's row shows the step header's number (both read the one turn deadline)
  const turnSecs = clock ? secondsLeft(clock.deadline) : null;
  const turnLen = Number(draft.turnSeconds) > 0 ? Math.round(draft.turnSeconds) : null;
  // 本局信息: the briefing's blocks (built only while the dialog is open) and the draft's state under it
  const info = infoOpen ? matchInfoModel(pub, { bonds: gd.list('bonds'), chess: gd.chess, mode, priv, diyData: { chess: data.get('chess'), backups: data.get('backups') } }) : null;
  const infoStatus = infoOpen ? draftInfoStatus({ myPick, pickName: myPick ? gd.band(myPick)?.name : null, myTurn, turnName, secs: turnSecs,
    waiting: !solo && !draft.allDone }) : null;
  const orderGroups = grouped ? draft.groups : [{ ...draft, id: null, order: solo ? [myId] : draft.order }];

  const allPicked = draft.allDone;
  const view = peek ? 'detail' : inOrder && myPick ? 'done' : open && band ? 'detail' : 'grid';
  const shownBand = peek ? bandRecord(gd, peek, allowDuplicates) : band;

  const head = allPicked ? html`<div class="dturn is-done"><span class="dturn__txt"><b>${t('策略选择完成')}</b><span>${t('正在进入模拟…')}</span></span><${Icon} name="hourglass" class="dturn__glass" /></div>`
    : myTurn ? html`<div class="dturn is-turn">
        <span class="dturn__go"><${Sprite} k="bandChoose/youturn_finger" class="dturn__finger" fallback=${html`<${Icon} name="chevronLeft" class="dturn__finger" />`} />
          <b>${t('请选择策略')}</b></span>
        ${!solo ? html`<button type="button" class="draft-skip" disabled=${!canSkip || !!busy} aria-busy=${busy === 'skip' ? 'true' : undefined} onClick=${skip}
            title=${skipsLeft > 0 ? t('跳过本轮，稍后再选') : t('跳过次数已用完')}>
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19v-5a7 7 0 0 1 7-7h7V3.5L22.5 9 17 14.5V11h-7a3 3 0 0 0-3 3v5z" /></svg>
          <span>${skipsLeft > 0 ? t('跳过选择') : t('无法跳过')}</span></button>` : null}
      </div>`
    : turnName ? html`<div class="dturn"><span class="dturn__txt"><b>${turnName}</b><span>${t('正在选择策略…')}</span></span><${Icon} name="hourglass" class="dturn__glass" /></div>`
    : null;

  // held after the draft (the server is already in BATTLE_CHECK): only to look at — 离开, 本局信息 and the 🔍 boxes would
  // open dialogs the match screen tears down a moment later
  return html`<div class=${cx('screen draft', `draft--${view}`, held && 'is-held', head && 'has-status')} inert=${held ? true : undefined} aria-busy=${held ? 'true' : undefined}>
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${pregameStepIndex(gd.config, 'BAND_CHECK')} of=${pregameStepCount(gd.config)} title=${t('选择策略')} micro="STRATEGY // BAND CHECK" pub=${clock ? { ...pub, deadline: clock.deadline } : { ...pub, deadline: 0 }}
      total=${clock ? clock.total : null} onExit=${() => setExit(true)}
      extra=${html`<button type="button" class="stephead__info" data-testid="match-info-open" aria-haspopup="dialog" onClick=${() => setInfoOpen(true)}
        title=${t('本局信息')}><${Icon} name="search" /><span>${t('本局信息')}</span></button>`}
      status=${head} />
    <main class="draft__main">
      <aside class="draft-order">
        <div class="draft-stage" data-testid="draft-stage"><span>${data.lookup('stages', pub.stageId)?.name || t('战场地图')}</span>
          ${stagePreview(data.lookup('stages', pub.stageId)) ? html`<${StageMiniMap} stage=${data.lookup('stages', pub.stageId)} />` : html`<small>${t('地图暂不可用')}</small>`}</div>
        <div class="draft-order__list draft-order__rows" ref=${orderRef}>
        ${orderGroups.map((group) => html`<div key=${group.id || 'all'} class=${cx('draft-order__group', grouped && 'draft-order__group--framed')}
          data-group=${group.id} style=${grouped ? `--pool-group-color:${group.color}` : undefined}
          role=${grouped ? 'group' : undefined} aria-label=${grouped ? t('{group}组 · 同组共享卡池', { group: group.label }) : undefined}>
        ${group.order.map((pid) => players.find((p) => p.playerId === pid)).filter(Boolean).map((p, i) => {
          const picked = group.picks.get(p.playerId) || (p.playerId === myId ? myPick : p.bandId) || null;
          const cur = !picked && (solo || group.turnPid === p.playerId);
          const secs = grouped ? (!group.untimed && group.turnDeadline > 0 ? secondsLeft(group.turnDeadline) : null) : turnSecs;
          return html`<${OrderRow} key=${p.playerId} p=${p} i=${i} picked=${picked} cur=${cur && !allPicked}
            self=${p.playerId === myId} players=${players} myId=${myId} gd=${gd} onPeek=${peekBand} group=${grouped ? group : null} secs=${secs} />`;
        })}</div>`)}
        </div>
        <${Button} variant="secondary" block=${true} class="draft-order__plan" data-testid="bond-plan-open"
          aria-haspopup="dialog" onClick=${() => setPlanOpen(true)}>
          ${myPlan ? html`<${BondGlyph} bondId=${myPlan} class="dorder__planglyph" />` : null}
          ${myPlan ? t('预选盟约：{name}', { name: gd.bond(myPlan)?.name || myPlan }) : t('预选盟约')}<//>
        ${!solo ? html`<p class="draft-order__tip" data-testid="draft-tip">${draftTip({ timed, turnSeconds: turnLen, autoName: myPick ? null : autoName, selected: open && autoId === sel, grouped: draft.groups.length > 1 })}</p>` : null}
      </aside>

      <i class="draft__link" aria-hidden="true"></i>

      ${view === 'done' ? html`<section class="draft-done" key=${myPick} aria-live="polite">
          <div class="draft-done__art"><${BandIcon} bandId=${myPick} size="xl" /></div>
          <div class="draft-done__head">
            <span class="draft-tag">STRATEGY</span>
            <h2 class="draft-done__title">${t('已选定策略')}</h2>
            <b class="draft-done__name">${gd.band(myPick)?.name || ''}</b>
          </div>
          <div class="draft-done__hp">${t('初始生命值')}<b class="num">${gd.band(myPick)?.totalHp ?? '--'}</b></div>
          ${gd.band(myPick) ? html`<${BandText} band=${gd.band(myPick)} class="draft-done__desc" />` : null}
          <p class="draft-detail__status t-mint"><${Icon} name="check" />${t('已选择「{name}」', { name: gd.band(myPick)?.name || '' })}${!solo && !allPicked ? t('，等待其他博士') : ''}</p>
        </section>` : html`
        <section class="draft-grid" role="listbox" aria-label=${t('策略')}>
          ${bands.flatMap((b, i) => {
            // 规程 sorts its strategies into 泛用型策略 (bandType GENERAL) and 盟约型策略 (BONDRELEVANT), each under a header,
            // as the official draft shows them (BV11NW869ELq part 4 0:28, BV13LWM6BEvY match 1 1:36); a version without
            // bandType has no header
            const sec = BAND_SECTIONS[b.bandType];
            const head = sec && bands[i - 1]?.bandType !== b.bandType
              ? [html`<div key=${`sec-${b.bandType}`} class="draft-grid__sec" role="presentation" data-testid=${`band-section-${sec.id}`}><${Icon} name=${sec.icon} /><span>${t(sec.name)}</span></div>`] : [];
            const isRandom = b.bandId === RANDOM_BAND_ID;
            const who = pickers.get(b.bandId) || [];
            const otherGroups = otherBandGroups(draft, b.bandId);
            const isTaken = !isRandom && taken.has(b.bandId);
            const offNames = bandOffBonds(b, offBonds).map((id) => gd.bond(id)?.name || id); // 本局禁用 (still selectable)
            const on = view === 'detail' && !peek && sel === b.bandId;
            const badged = local.badges.has(b.bandId); // (the count is the detail pane's 已通过模拟 N 次)
            return [...head, html`<button key=${b.bandId} type="button" role="option" aria-selected=${on ? 'true' : 'false'} data-band=${b.bandId}
                aria-disabled=${isTaken ? 'true' : 'false'} title=${isTaken ? t('已被选择') : offNames.length ? bandOffLine(offNames) : b.name}
                class=${cx('dband', on && 'is-sel', myPick === b.bandId && 'is-mine', isTaken && 'is-taken', offNames.length && 'is-off')} style=${`--n:${Math.min(i, 15)}`}
                onClick=${() => pickTile(b.bandId)}>
              <span class="dband__frame">${isRandom ? html`<span class="dband__random" aria-hidden="true">?</span>` : html`<${BandIcon} bandId=${b.bandId} size="lg" />`}</span>
              <span class="dband__name">${b.name}</span>
              ${badged ? html`<span class="dband__badge" data-testid="band-badge" aria-hidden="true">
                <${Sprite} k="statistics/strategyBadge" class="dband__badge-art" fallback=${html`<span class="dband__medal"><${Icon} name="rook" /></span>`} /></span>` : null}
              <${BandOffTag} names=${offNames} />
              ${who.length ? html`<span class="dband__who">${who.slice(0, 4).map((p) => html`<${PlayerAvatar} key=${p.playerId} player=${p} size="sm" />`)}</span>` : null}
              ${otherGroups.length ? html`<span class="dband__groups">${otherGroups.map((group) => html`<span key=${group.id} class="dband__group" style=${`--pool-group-color:${group.color}`} title=${t('{group}组已选择', { group: group.label })} aria-label=${t('{group}组已选择', { group: group.label })}>${group.label}</span>`)}</span>` : null}
              ${isTaken ? html`<span class="dband__taken">${t('已被选择')}</span>` : null}
              ${on ? html`<span class="dband__selmark" aria-hidden="true">SELECTED</span>` : null}
            </button>`];
          })}
        </section>
        ${view === 'detail' && shownBand ? html`<aside class="draft-detail" key="detail">
          <div class="draft-detail__body" key=${shownBand.bandId}>
            <div class="draft-detail__art">${shownBand.random ? html`<span class="draft-detail__random" aria-hidden="true">?</span>` : html`<${BandIcon} bandId=${shownBand.bandId} size="xl" />`}</div>
            ${local.won[shownBand.bandId] ? html`<span class="draft-detail__medal">${t('已通过模拟{n}次', { n: local.won[shownBand.bandId] })}</span>` : null}
            <div class="draft-detail__hp">${t('初始生命值')}<b class="num">${shownBand.totalHp ?? '--'}</b></div>
            <span class="draft-tag">STRATEGY</span>
            <h2 class="draft-detail__name">${shownBand.name}</h2>
            <${BandOffNote} names=${bandOffBonds(shownBand, offBonds).map((id) => gd.bond(id)?.name || id)} />
            <span class="draft-tag">INTRO</span>
            <div class="draft-detail__eff"><${BandText} band=${shownBand} class="draft-detail__desc" /></div>
          </div>
          <div class="draft-detail__actions">
            ${peek ? html`<p class="draft-detail__status"><${Icon} name="search" />${myPick === peek ? t('你选择的策略') : t('{names} 选择的策略', { names: (pickers.get(peek) || []).map((x) => x.name).join('、') || t('博士') })}</p>
              <div class="draft-detail__btns"><${Button} variant="secondary" size="lg" icon="chevronLeft" onClick=${() => setPeek(null)}>${t('返回')}<//></div>`
            : html`${selTaken ? html`<p class="draft-detail__status draft-detail__status--taken"><${Icon} name="close" />${t('队友已选，请选择其他策略')}</p>`
                : !myTurn ? html`<p class="draft-detail__status"><${Icon} name="hourglass" />${!inOrder ? t('观战中') : turnName ? t('{turnName} 正在决策…', { turnName }) : t('等待轮到你')}</p>` : null}
              <div class="draft-detail__btns">
                <${Button} variant="primary" size="lg" icon="check" class="draft-confirm" disabled=${!myTurn || !band || selTaken} loading=${busy === 'pick'} onClick=${confirm}>${selTaken ? t('已被选择') : t('确认选择')}<//>
              </div>`}
          </div>
        </aside>` : null}`}
    </main>
    <${BondPlanDialog} open=${planOpen} onClose=${() => setPlanOpen(false)} current=${myPlan} />
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${solo} />
    <${MatchInfoDialog} open=${infoOpen} onClose=${() => setInfoOpen(false)} model=${info} onBond=${setBondId}
      enemies=${infoOpen ? html`<${MatchEnemies} pub=${pub} gd=${gd} idScope="minfo" />` : null}
      status=${infoStatus ? html`<span class=${cx('minfo-dlg__turn', `is-${infoStatus.tone}`)}>
        <${Icon} name=${infoStatus.tone === 'mint' ? 'check' : 'hourglass'} />${infoStatus.text}${infoStatus.secs != null ? html`<b class="num">${infoStatus.secs}s</b>` : null}
      </span>` : null} />
    <${MatchBondDialog} bondId=${infoOpen ? bondId : null} onClose=${() => setBondId(null)} priv=${priv} banned=${info?.banned} off=${!!info?.sets.off.has(bondId)} coreAbsent=${regulationCoreAbsent(info, bondId)} />
    ${turnBanner ? html`<${TurnBanner} key=${turnBanner} onDone=${() => setTurnBanner(0)} />` : null}
  </div>`;
}
