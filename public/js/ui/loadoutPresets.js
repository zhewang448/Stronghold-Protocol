// Shared local preset controls. Dialogs mount outside the loadout header.
import { useEffect, useState } from "../../vendor/hooks.module.js";
import { html, Button, Modal, Icon } from "./components.js";
import { useStore } from "../store.js";
import { pageVersion } from "../content.js";
import { VERSIONS } from "../../../shared/versions.js";
import { t, N_ } from "../../../shared/i18n.js";
import { loadoutStore } from "./loadoutSync.js";
import { skinsStore, skinRandomStore } from "./skins.js";
import { DEFAULT_PARTS, PRESETS_LIMIT, putPreset, renamePreset, deletePreset, readLibrary, snapshotOf, mergeSnapshot, operatorScope, presetError } from "./loadoutPresetsModel.js";
import { presetsStore, saveLibrary, capturePreset, presetDirty, presetPermissions, applyPreset, currentPresetState, loadPresetRosters } from "./loadoutPresetsState.js";
import { toast } from "./toasts.js";

const PARTS = [["skills", N_("技能选择")], ["modules", N_("模组选择")], ["potential", N_("潜能设置")], ["cultivate", N_("练度设置")],
  ["skins", N_("皮肤装扮")], ["skinRandom", N_("皮肤随机设置")], ["skinLocks", N_("皮肤锁定")]];
const gameplay = ["skills", "modules", "potential", "cultivate"];
function errorText(code) {
  switch (code) {
    case "name": return t("预设名称须为 1–24 个字符，不能包含换行。");
    case "duplicate": return t("已有同名预设，请改名或选择覆盖同名预设。");
    case "limit": return t("最多保存 20 个预设，请更新或删除已有预设。");
    case "empty": return t("请至少选择一项保存内容或一个自选编队版本。");
    case "newer": return t("预设库来自更新的版本，请更新游戏后重试。");
    case "loading": return t("调配数据尚未就绪，请稍后重试。");
    case "scope": return t("请至少选择一个干员名单版本。");
    case "scopeEmpty": return t("所选版本没有符合范围的干员，请更换版本或保存范围。");
    case "locked": return t("当前阶段已锁定所选配置，请取消锁定部分后重试。");
    case "data": return t("无法读取所选版本的数据，请检查网络后重试。");
    case "stale": return t("预设已在其他窗口改变，请重新选择。");
    case "rollback": return t("存储恢复失败，请勿关闭页面，先导出个人数据备份。");
    case "storage": return t("保存失败，请释放浏览器存储空间或允许本地存储后重试；当前配置未改变。");
    default: return t("预设数据损坏，未覆盖原数据。请从个人数据备份恢复。");
  }
}
const versionsOf = p => Object.keys(p.snapshot.diy);
const partsOf = p => p.snapshot.loadout.extension.sections;
function moveFocus(e) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const choices = [...e.currentTarget.querySelectorAll("button:not(:disabled)")];
  const index = choices.indexOf(document.activeElement);
  const next = e.key === "Home" ? 0 : e.key === "End" ? choices.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
  e.preventDefault(); choices[next]?.focus();
}
function summary(p) {
  const labels = PARTS.filter(([k]) => partsOf(p)[k]).map(([, name]) => t(name));
  if (p.snapshot.scope) labels.unshift(t(p.snapshot.scope.mode === "exclusive" ? "版本独有干员" : "版本全部干员") + " · " + t("{n} 名干员", { n: p.snapshot.scope.charIds.length }));
  if (versionsOf(p).length) labels.push(t("自选编队 · {n} 个版本", { n: versionsOf(p).length }));
  return labels.join(" · ");
}

export function useLoadoutPresets(ready) {
  const libraryState = useStore(s => s, undefined, presetsStore);
  useStore(s => s, undefined, loadoutStore);
  useStore(s => s.skins, undefined, skinsStore);
  useStore(s => s, undefined, skinRandomStore);
  useStore(s => s.match);
  const [dialog, setDialog] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rosters, setRosters] = useState(null);
  const [rosterError, setRosterError] = useState(false);
  const library = libraryState.library;
  const active = library?.items.find(p => p.id === library.activeId);
  const dirty = active ? presetDirty(active) : true;
  const show = value => { setMessage(null); setDialog(value); };
  const close = () => { if (!busy) show(null); };
  useEffect(() => { if (!loadoutStore.get().open) show(null); }, [loadoutStore.get().open]);
  const failure = e => setMessage(errorText(e.code));
  const list = [...(library?.items || [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const editor = (p = null, after = null, source = null) => show({ mode: "save", id: p?.id || null, name: p?.name || "", source,
    parts: { ...(p ? partsOf(p) : DEFAULT_PARTS) }, versions: p ? versionsOf(p) : [],
    scopeMode: source?.scope?.mode || "all", scopeVersions: source?.scope?.versions || [pageVersion()],
    includeDiy: p ? !!versionsOf(p).length : false, overwrite: false, after });
  useEffect(() => {
    if (dialog?.mode !== "save" || dialog.scopeMode === "all" || dialog.source || rosters || rosterError) return;
    let live = true;
    loadPresetRosters().then(value => { if (live) setRosters(value); }, () => { if (live) setRosterError(true); });
    return () => { live = false; };
  }, [dialog?.mode, dialog?.scopeMode, dialog?.source, rosters, rosterError]);
  const application = p => show({ mode: "apply", item: p, parts: { ...partsOf(p) }, versions: versionsOf(p), dropped: null, skip: false });
  const update = () => {
    if (!active) { editor(); return; }
    try {
      saveLibrary(putPreset(readLibrary(), { id: active.id, name: active.name, snapshot: capturePreset(partsOf(active), versionsOf(active), active.snapshot.scope || null) }));
      toast(t("预设已保存"), "success");
    } catch (e) { failure(e); }
  };
  const choose = p => {
    if (!p) return;
    if (dirty) show({ mode: "guard", target: p }); else application(p);
  };
  const save = () => {
    try {
      const versions = dialog.includeDiy ? dialog.versions : [];
      const scope = dialog.source?.scope || operatorScope(dialog.scopeMode, dialog.scopeVersions, rosters || {});
      if (scope && !scope.charIds.length && Object.entries(dialog.parts).some(([key, on]) => on && key !== "skinRandom")) throw presetError("scopeEmpty");
      const snapshot = dialog.source ? snapshotOf({ ...mergeSnapshot({ byChar: {}, ops: {}, skins: {}, random: {} }, dialog.source, dialog.parts), diy: dialog.source.diy }, dialog.parts, versions, scope)
        : capturePreset(dialog.parts, versions, scope);
      const next = putPreset(readLibrary(), { id: dialog.id, name: dialog.name, overwrite: dialog.overwrite,
        snapshot });
      if (dialog.source) next.activeId = readLibrary().activeId;
      saveLibrary(next);
      const after = dialog.after;
      toast(t("预设已保存"), "success");
      if (after) application(next.items.find(p => p.id === after.id)); else close();
    } catch (e) { failure(e); }
  };
  const apply = async () => {
    setBusy(true); setMessage(null);
    try {
      const result = await applyPreset(dialog.item, dialog.parts, dialog.versions, { skipInvalid: dialog.skip });
      if (result.needsConfirmation) setDialog({ ...dialog, dropped: result.needsConfirmation });
      else { setDialog(null); toast(t("预设已应用"), "success"); }
    } catch (e) { failure(e); } finally { setBusy(false); }
  };
  const guardSave = () => {
    const target = dialog.target;
    if (!active) { editor(null, target); return; }
    try {
      saveLibrary(putPreset(readLibrary(), { id: active.id, name: active.name, snapshot: capturePreset(partsOf(active), versionsOf(active), active.snapshot.scope || null) }));
      application(readLibrary().items.find(p => p.id === target.id));
    } catch (e) { failure(e); }
  };
  const toggleVersion = id => {
    setMessage(null);
    setDialog({ ...dialog, versions: dialog.versions.includes(id) ? dialog.versions.filter(v => v !== id) : [...dialog.versions, id], dropped: null, skip: false });
  };
  const permissions = presetPermissions();
  const partChoices = (values, onChange, applying = false) => html`<fieldset class="lp-parts"><legend>${t(applying ? "应用内容" : "保存内容")}</legend>
    ${PARTS.filter(([k]) => applying ? partsOf(dialog.item)[k] : !dialog.source || dialog.source.loadout.extension.sections[k]).map(([key, label]) => {
      const locked = applying && gameplay.includes(key) && !permissions.loadout;
      return html`<label key=${key}><input type="checkbox" data-preset-part=${key} checked=${!!values[key]}
        onChange=${e => onChange(key, e.currentTarget.checked)} /><span>${t(label)}${locked ? html` · ${t("本局已锁定")}` : ""}</span></label>`;
    })}</fieldset>`;
  const versionChoices = (ids, applying = false) => html`<fieldset class="lp-versions"><legend>${t("自选编队版本")}</legend>
    ${VERSIONS.filter(v => applying ? versionsOf(dialog.item).includes(v.id) : !dialog.source || Object.hasOwn(dialog.source.diy, v.id)).map(v => {
      let count = 0;
      try { count = Object.keys(applying ? dialog.item.snapshot.diy[v.id] : (dialog.source?.diy || currentPresetState().diy)[v.id] || {}).length; } catch { /* validated at save */ }
      return html`<label key=${v.id}><input type="checkbox" data-preset-version=${v.id} checked=${ids.includes(v.id)}
        onChange=${() => toggleVersion(v.id)} /><span>${t(v.label)}<small>${count ? t("已选 {n} 个名额", { n: count }) : t("空编队")}${applying && !permissions.diy ? html` · ${t("本局已锁定")}` : ""}</small></span></label>`;
    })}</fieldset>`;
  let body = null, actions = null, title = "";
  const cancel = html`<${Button} variant="ghost" disabled=${busy} onClick=${close}>${t("取消")}<//>`;
  if (dialog?.mode === "select") {
    title = t("选择调配预设");
    body = html`<div class="lp-picker" onKeyDown=${moveFocus}>${list.map(p => html`<button key=${p.id} type="button" class="lp-choice" data-preset-id=${p.id}
      onClick=${() => choose(p)}><strong>${p.name}${p.id === active?.id ? html` · ${t("当前")}` : ""}</strong><small>${summary(p)}</small></button>`)}
      ${!list.length ? html`<p>${t("还没有预设")}</p>` : null}</div>`;
    actions = html`<${Button} variant="ghost" onClick=${close}>${t("关闭")}<//>
      <${Button} variant="secondary" data-testid="preset-manage" disabled=${!library} onClick=${() => show({ mode: "manage", id: active?.id || list[0]?.id })}>${t("管理预设")}<//>
      <${Button} variant="primary" data-testid="preset-save-as" disabled=${!ready || !library || library.items.length >= PRESETS_LIMIT} onClick=${() => editor()}>${t("另存为新预设")}<//>`;
  } else if (dialog?.mode === "save") {
    title = t("保存调配预设");
    body = html`<label class="lp-name">${t("预设名称")}<input data-testid="preset-name" data-autofocus value=${dialog.name} maxLength="48"
      onInput=${e => { setMessage(null); setDialog({ ...dialog, name: e.currentTarget.value, overwrite: false }); }} /></label>
      <fieldset class="lp-scope"><legend>${t("干员保存范围")}</legend>
        ${[["all", N_("全部已保存配置")], ["roster", N_("所选版本的全部干员")], ["exclusive", N_("所选版本的独有干员")]].map(([mode, label]) => html`<label class="lp-check"><input type="radio" name="preset-scope" data-preset-scope=${mode}
          checked=${dialog.scopeMode === mode} disabled=${!!dialog.source} onChange=${() => { setMessage(null); setDialog({ ...dialog, scopeMode: mode }); }} />${t(label)}</label>`)}
        ${dialog.scopeMode !== "all" ? html`<div class="lp-scope-versions">${VERSIONS.map(v => {
          let count = null;
          if (rosters) count = operatorScope(dialog.scopeMode, [v.id], rosters).charIds.length;
          return html`<label class="lp-check"><input type="checkbox" data-preset-roster-version=${v.id} checked=${dialog.scopeVersions.includes(v.id)} disabled=${!!dialog.source || !rosters}
            onChange=${() => { setMessage(null); setDialog({ ...dialog, scopeVersions: dialog.scopeVersions.includes(v.id) ? dialog.scopeVersions.filter(id => id !== v.id) : [...dialog.scopeVersions, v.id] }); }} />
            <span>${t(v.label)}${count === null ? "" : html` · ${t("{n} 名干员", { n: count })}`}</span></label>`;
        })}</div>
        ${!dialog.source && !rosters ? html`<p class="lp-hint" role="status">${rosterError ? t("版本名单加载失败，请重试。") : t("正在读取版本干员名单…")}</p>
          ${rosterError ? html`<button type="button" class="lp-textbtn" onClick=${() => setRosterError(false)}>${t("重试")}<//>` : null}` : null}
        <p class="lp-hint">${t("独有指其他三个版本都没有的可调配干员；不包含自选专用干员。应用仅覆盖保存时的名单，名单外设置保持不变。")}</p>` : null}
      </fieldset>
      ${partChoices(dialog.parts, (key, on) => setDialog({ ...dialog, parts: { ...dialog.parts, [key]: on } }))}
      ${dialog.parts.skinRandom ? html`<p class="lp-hint">${t("随机皮肤策略是全局设置，不按干员名单拆分。")}</p>` : null}
      <label class="lp-check"><input type="checkbox" data-testid="preset-include-diy" checked=${dialog.includeDiy}
        disabled=${!!dialog.source && !Object.keys(dialog.source.diy).length}
        onChange=${e => setDialog({ ...dialog, includeDiy: e.currentTarget.checked, versions: dialog.versions.length ? dialog.versions : [pageVersion()] })} />${t("同时保存自选编队")}</label>
      ${dialog.includeDiy ? html`<button type="button" class="lp-textbtn" onClick=${() => setDialog({ ...dialog, versions: dialog.source ? Object.keys(dialog.source.diy) : VERSIONS.map(v => v.id) })}>${t("选全部")}</button>${versionChoices(dialog.versions)}` : null}
      ${library.items.some(p => p.name === dialog.name.trim() && p.id !== dialog.id) ? html`<label class="lp-check"><input type="checkbox" data-testid="preset-overwrite" checked=${dialog.overwrite} onChange=${e => setDialog({ ...dialog, overwrite: e.currentTarget.checked })} />${t("覆盖同名预设")}</label>` : null}
      <p class="lp-hint">${t("跨版本共用 · 仅保存在当前浏览器；可随个人数据备份迁移。")}</p>`;
    actions = html`${cancel}<${Button} variant="primary" data-testid="preset-save-confirm" disabled=${busy || !ready || (dialog.scopeMode !== "all" && !dialog.source && !rosters)} onClick=${save}>${t("保存预设")}<//>`;
  } else if (dialog?.mode === "guard") {
    title = t("当前配置尚未保存");
    body = html`<p>${t("切换前是否保存当前修改？")}</p>`;
    actions = html`${cancel}<${Button} variant="secondary" data-testid="preset-discard" onClick=${() => application(dialog.target)}>${t("直接切换")}<//>
      <${Button} variant="primary" data-testid="preset-guard-save" onClick=${guardSave}>${t("保存并切换")}<//>`;
  } else if (dialog?.mode === "apply") {
    title = t("应用调配预设");
    body = html`<h3 class="lp-selected-name">${dialog.item.name}</h3><p class="lp-hint">${t("勾选部分将恢复为预设快照，未勾选部分保持不变。")}</p>
      ${dialog.item.snapshot.scope ? html`<p class="lp-hint">${t("仅应用保存名单中的 {n} 名干员，名单外设置保持不变。", { n: dialog.item.snapshot.scope.charIds.length })}</p>` : null}
      ${partChoices(dialog.parts, (key, on) => setDialog({ ...dialog, parts: { ...dialog.parts, [key]: on }, dropped: null, skip: false }), true)}
      ${versionsOf(dialog.item).length ? versionChoices(dialog.versions, true) : null}
      ${(!permissions.loadout || (!permissions.diy && dialog.versions.length)) ? html`<p class="lp-warning">${t("当前对局已锁定部分配置。请取消相应勾选后应用；自选编队只能在局外切换。")}</p>` : null}
      ${dialog.dropped ? html`<div class="lp-warning"><p>${t("以下自选项在目标版本不可用：")}</p>
        <ul>${dialog.dropped.map(d => html`<li>${t(VERSIONS.find(v => v.id === d.version)?.label)} · ${d.name} · ${d.slot}</li>`)}</ul>
        <label class="lp-check"><input type="checkbox" data-testid="preset-skip-invalid" checked=${dialog.skip} onChange=${e => setDialog({ ...dialog, skip: e.currentTarget.checked })} />${t("确认跳过以上自选项")}</label></div>` : null}`;
    const blocked = (!permissions.loadout && gameplay.some(k => dialog.parts[k])) || (!permissions.diy && dialog.versions.length);
    actions = html`${cancel}<${Button} variant="primary" data-testid="preset-apply-confirm" disabled=${busy || !ready || blocked || (!!dialog.dropped && !dialog.skip)} onClick=${apply}>${busy ? t("正在校验…") : t("应用预设")}<//>`;
  } else if (dialog?.mode === "manage") {
    title = t("管理调配预设");
    const selected = library?.items.find(p => p.id === dialog.id) || list[0];
    body = html`<div class="lp-manager"><nav aria-label=${t("预设列表")} onKeyDown=${moveFocus}>${list.map(p => html`<button type="button" class=${p.id === selected?.id ? "is-on" : ""} onClick=${() => setDialog({ ...dialog, id: p.id })}>${p.name}</button>`)}</nav>
      <section>${selected ? html`<h3 class="lp-selected-name">${selected.name}</h3><p>${summary(selected)}</p>
        <p class="lp-hint">${t("更新时间：{time}", { time: new Date(selected.updatedAt).toLocaleString() })}</p>
        ${versionsOf(selected).map(id => html`<p>${t(VERSIONS.find(v => v.id === id)?.label)} · ${Object.keys(selected.snapshot.diy[id]).length ? t("已选 {n} 个名额", { n: Object.keys(selected.snapshot.diy[id]).length }) : t("空编队")}</p>`)}
        <div class="lp-manage-actions"><${Button} variant="primary" disabled=${!ready} onClick=${() => choose(selected)}>${t("应用预设")}<//>
          <${Button} variant="secondary" data-testid="preset-rename" onClick=${() => show({ mode: "rename", item: selected, name: selected.name })}>${t("重命名")}<//>
          <${Button} variant="secondary" disabled=${library.items.length >= PRESETS_LIMIT} onClick=${() => editor({ ...selected, id: null, name: "" }, null, selected.snapshot)}>${t("另存为新预设")}<//>
          <${Button} variant="ghost" data-testid="preset-delete" onClick=${() => show({ mode: "delete", item: selected })}>${t("删除预设")}<//></div>`
        : html`<p>${t("还没有预设")}</p><${Button} variant="primary" disabled=${!ready} onClick=${() => editor()}>${t("保存当前配置")}<//>`}</section></div>`;
    actions = html`<${Button} variant="ghost" onClick=${close}>${t("关闭")}<//><span class="lp-hint">${library?.items.length || 0}/${PRESETS_LIMIT}</span>`;
  } else if (dialog?.mode === "rename") {
    title = t("重命名预设");
    body = html`<label class="lp-name">${t("预设名称")}<input data-testid="preset-name" data-autofocus value=${dialog.name} maxLength="48" onInput=${e => setDialog({ ...dialog, name: e.currentTarget.value })} /></label>`;
    actions = html`${cancel}<${Button} variant="primary" data-testid="preset-rename-confirm" onClick=${() => { try { saveLibrary(renamePreset(readLibrary(), dialog.item.id, dialog.name)); show({ mode: "manage", id: dialog.item.id }); } catch (e) { failure(e); } }}>${t("保存")}<//>`;
  } else if (dialog?.mode === "delete") {
    title = t("删除预设");
    body = html`<p>${dialog.item.name}</p><p>${t("删除后当前配置保持不变，预设无法撤销删除。")}</p>`;
    actions = html`${cancel}<${Button} variant="primary" data-testid="preset-delete-confirm" onClick=${() => { try { saveLibrary(deletePreset(readLibrary(), dialog.item.id)); show({ mode: "manage" }); } catch (e) { failure(e); } }}>${t("确认删除")}<//>`;
  }
  return {
    toolbar: html`<div class="lp-toolbar"><button type="button" data-testid="preset-selector" class="lp-selector" title=${active?.name || t("未保存配置")}
        aria-haspopup="dialog" onClick=${() => show({ mode: "select" })}><span>${active ? active.name + (dirty ? " · " + t("已修改") : "") : t("未保存配置")}</span><${Icon} name="chevronRight" /></button>
      <${Button} variant="secondary" size="sm" data-testid="preset-save" disabled=${!ready || (!!active && !dirty) || !library} onClick=${update}>${t("保存")}<//></div>`,
    dialogs: dialog ? html`<${Modal} key=${dialog.mode} open=${true} title=${title} class="lp-dialog" veilClass="lp-veil" width=${dialog.mode === "manage" ? "min(880px, calc(100vw - 24px))" : "min(640px, calc(100vw - 24px))"}
      onClose=${close} closeOnBackdrop=${!busy} actions=${actions}>
      ${libraryState.error ? html`<p class="lp-error" role="alert">${errorText(libraryState.error)}</p>` : body}
      ${message ? html`<p class="lp-error" role="alert">${message}</p>` : null}<//>`
      : message ? html`<${Modal} open=${true} title=${t("预设操作失败")} class="lp-dialog" onClose=${() => setMessage(null)} actions=${html`<${Button} onClick=${() => setMessage(null)}>${t("关闭")}<//>`}><p role="alert">${message}</p><//>` : null,
  };
}
