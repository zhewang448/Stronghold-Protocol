// Briefing selections: defaults stay authoritative until the player applies a local edit. The owner approved
// zero to two per tier (2026-11-06); [] means bring none, while an absent tier still uses the match's defaults.
// A compact footer summary shows only server-confirmed selections. The modal owns drafts and submits edited tiers
// together through g.diyApply. Older servers retain their exact-count rule and the existing single-tier command.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { render } from '../../vendor/preact.module.js';
import { html, TierChip, Icon, Modal, Button } from './components.js';
import { UnitThumb, BondGlyph } from './gameComponents.js';
import { slotRecord } from './diyModel.js';
import { diyTierSlotIds } from '../../../shared/diy.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const sameSelection = (a, b) => a.length === b.length && a.every(id => b.includes(id));

/** The well-formed editable tiers of the private briefing view. @param {any} priv */
export function diyChoiceTiers(priv) {
  const tiers = isObj(priv?.diyChoice) && Array.isArray(priv.diyChoice.tiers) ? priv.diyChoice.tiers : [];
  return tiers.filter(x => isObj(x) && (x.tier === 5 || x.tier === 6) && Number.isInteger(x.slots) && x.slots > 0
    && Array.isArray(x.candidates) && x.candidates.length > 0 && Array.isArray(x.chosen));
}

/** Toggle only the local draft; applying is a separate, explicit action. */
export function toggleDiyDraft(tier, current, charId) {
  const cur = Array.isArray(current) ? current : tier.chosen;
  if (cur.includes(charId)) return cur.filter(id => id !== charId);
  return cur.length < tier.slots ? [...cur, charId] : cur;
}

/** Whether an edited tier can be applied. Empty is valid only when the server advertises allowFewer. */
export function diyDraftReady(tier, draft, allowFewer = true) {
  const max = Math.min(tier.slots, tier.candidates.length);
  return Array.isArray(draft) && draft.length <= max && (allowFewer || draft.length === max)
    && new Set(draft).size === draft.length && draft.every(id => tier.candidates.some(c => c.charId === id))
    && !sameSelection(draft, tier.chosen);
}

/** Only edited tiers are submitted, preserving automatic defaults in untouched tiers. */
export function diyDraftChanges(priv, drafts) {
  const changes = {};
  for (const tier of diyChoiceTiers(priv)) {
    const draft = drafts[tier.tier];
    if (diyDraftReady(tier, draft, priv.diyChoice.allowFewer === true)) changes[tier.tier] = [...draft];
  }
  return changes;
}

const bondName = id => data.lookup('bonds', id)?.name || id;

// Escape the briefing footer's stacking context, as the existing skin-preview modal does.
function ChoiceModal(props) {
  const host = useRef(null);
  const clear = () => { if (host.current) { render(null, host.current); host.current.remove(); host.current = null; } };
  useLayoutEffect(() => {
    if (!props.open) { clear(); return; }
    if (!host.current) {
      host.current = document.createElement('div'); host.current.className = 'diy-choice-portal';
      (document.querySelector('.app-root') || document.body).appendChild(host.current);
    }
    render(html`<${Modal} ...${props} />`, host.current);
  });
  useEffect(() => () => clear(), []);
  return null;
}

/** Shared with the out-of-match DIY picker. */
export function BanLine({ ban, compact = false, class: cls = 'diy-ban' }) {
  if (!ban || !Array.isArray(ban.bonds) || !ban.bonds.length) return null;
  const bonds = ban.bonds.map(bondName);
  const text = ban.all && !compact ? t('盟约全部禁用，本局不会出现在商店') : t('本局禁用：{bonds}', { bonds });
  return html`<span class=${cx(cls, ban.all ? 'is-all' : 'is-some')} data-ban=${ban.all ? 'all' : 'some'}><${Icon} name="warn" />${text}</span>`;
}

function Candidate({ tier, c, on, onTap, disabled }) {
  const D = { chess: data.get('chess'), backups: data.get('backups') };
  const slot = diyTierSlotIds(tier, D)[0];
  const rec = slot ? slotRecord(slot, c, D) : null;
  const name = rec?.name || c.charId;
  const banned = Array.isArray(c.banned) ? c.banned.filter(b => typeof b === 'string') : [];
  const ban = banned.length ? { bonds: banned, all: !!c.off } : null;
  const label = [name, on && t('已选'), ban && (ban.all ? t('盟约全部禁用') : t('本局禁用：{bonds}', { bonds: banned.map(bondName) }))].filter(Boolean).join(' · ');
  return html`<button type="button" class=${cx('diychoice__c', on && 'is-on', ban && (ban.all ? 'is-off' : 'is-part'))} data-char=${c.charId}
      aria-pressed=${on ? 'true' : 'false'} aria-label=${label} title=${label} disabled=${disabled} onClick=${() => onTap(c.charId)}>
    <${UnitThumb} kind="chess" rec=${rec} id=${slot} size="sm" showTier=${false} dim=${!!ban?.all} />
    <span class="diychoice__name">${name}</span>
    <span class="diychoice__bonds">${(rec?.bonds || []).map(b => html`<span key=${b} class=${cx('diychoice__bond', banned.includes(b) && 'is-off')}><${BondGlyph} bondId=${b} /></span>`)}</span>
    ${ban ? html`<b class=${cx('diychoice__flag', ban.all ? 'is-all' : 'is-some')}>${ban.all ? t('盟约全部禁用') : t('部分盟约禁用')}</b>` : null}
    <${BanLine} ban=${ban} compact=${true} class="diychoice__ban" />
    ${on ? html`<b class="diychoice__tag">${t('已选')}</b>` : null}
  </button>`;
}

/** Hookless editor view; the drafts shown here are never labelled as already fielded. */
export function DiyChoiceView({ priv, drafts = {}, onTap, onClear, disabled = false }) {
  const allowFewer = priv?.diyChoice?.allowFewer === true;
  return html`<div class="diychoice diychoice--editor" data-testid="diy-choice-editor">
    <p class="diychoice__lead">${allowFewer ? t('每阶最多选择 2 名，也可以不带。点击应用名单后生效；未修改的阶级保留原名单。')
      : t('当前服务器仅支持选满本阶人数；未应用的修改不会生效。')}</p>
    ${diyChoiceTiers(priv).map(tier => {
      const selected = Array.isArray(drafts[tier.tier]) ? drafts[tier.tier] : tier.chosen;
      const max = Math.min(tier.slots, tier.candidates.length);
      return html`<section key=${tier.tier} class="diychoice__tier" data-tier=${tier.tier}>
        <div class="diychoice__head"><${TierChip} tier=${tier.tier} size="sm" /><b>${t('{tier}阶', { tier: tier.tier })}</b>
          <span class="num diychoice__n">${t('已选 {n}/{k}', { n: selected.length, k: max })}</span>
          ${allowFewer && !selected.length ? html`<span class="diychoice__none">${t('本阶不带自选')}</span>` : null}
          ${allowFewer ? html`<${Button} size="sm" variant="secondary" disabled=${disabled || !selected.length} data-testid=${'diy-clear-' + tier.tier}
            onClick=${() => onClear(tier.tier)}>${t('本阶不带自选')}<//>` : null}
        </div>
        <div class="diychoice__row">${tier.candidates.map(c => html`<${Candidate} key=${c.charId} tier=${tier.tier} c=${c}
          on=${selected.includes(c.charId)} disabled=${disabled} onTap=${id => onTap(tier.tier, id)} />`)}</div>
      </section>`;
    })}
  </div>`;
}

/** Confirmed summary and a discardable local editor. */
export function DiyChoice({ priv, onApply, onEditingChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const close = useCallback(() => { if (!busy) { setOpen(false); setDrafts({}); setNotice(''); } }, [busy]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onEditingChange?.(open); return () => onEditingChange?.(false); }, [open, onEditingChange]);
  const tiers = diyChoiceTiers(priv);
  if (!tiers.length) return null;
  const changes = diyDraftChanges(priv, drafts);
  const valid = tiers.every(tier => !Array.isArray(drafts[tier.tier]) || sameSelection(drafts[tier.tier], tier.chosen)
    || diyDraftReady(tier, drafts[tier.tier], priv.diyChoice.allowFewer === true));
  const begin = () => { setDrafts({}); setNotice(''); setOpen(true); };
  const tap = (tierId, charId) => {
    const tier = tiers.find(x => x.tier === tierId);
    if (!tier || busy || disabled) return;
    const current = drafts[tierId] || tier.chosen;
    const next = toggleDiyDraft(tier, current, charId);
    if (next === current) { setNotice(t('最多选择 {n} 名，请先取消一名。', { n: tier.slots })); return; }
    setDrafts({ ...drafts, [tierId]: next }); setNotice('');
  };
  const apply = async () => {
    if (busy || disabled || !valid || !Object.keys(changes).length) return;
    setBusy(true); setNotice('');
    try {
      const ok = await onApply(changes);
      if (alive.current) {
        if (ok) { setOpen(false); setDrafts({}); }
        else setNotice(t('名单未应用，请检查提示后重试。'));
      }
    } finally { if (alive.current) setBusy(false); }
  };
  return html`<div class="diy-summary" data-testid="diy-choice">
    <${Button} variant="secondary" class="diy-summary__open" disabled=${disabled} onClick=${begin} data-testid="diy-choice-open" aria-haspopup="dialog">
      <span class="diy-summary__label">${t('本局自选')}</span>
      ${tiers.map(tier => html`<span key=${tier.tier} class="diy-summary__tier" data-summary-tier=${tier.tier}>
        <b>${t('{tier}阶', { tier: tier.tier })}</b><span>${tier.chosen.length ? t('{n}名', { n: tier.chosen.length }) : t('不带')}</span>
      </span>`)}
      <span class="diy-summary__edit">${t('调整')}</span>
    <//>
    <${ChoiceModal} open=${open} title=${t('调整本局自选')} class="diy-choice-modal" width="min(12rem, calc(100vw - .32rem))" onClose=${close}
      actions=${html`<span class="diychoice__status" role="status">${notice || (Object.keys(changes).length ? t('修改待应用') : t('当前显示已确认名单'))}</span>
        <${Button} variant="secondary" disabled=${busy} onClick=${close} data-testid="diy-discard">${t('放弃更改')}<//>
        <${Button} variant="primary" icon="check" loading=${busy} disabled=${disabled || busy || !valid || !Object.keys(changes).length}
          onClick=${apply} data-testid="diy-apply">${t('应用名单')}<//>`}>
      <${DiyChoiceView} priv=${priv} drafts=${drafts} onTap=${tap} onClear=${tier => { setDrafts({ ...drafts, [tier]: [] }); setNotice(''); }} disabled=${disabled || busy} />
    <//>
  </div>`;
}
