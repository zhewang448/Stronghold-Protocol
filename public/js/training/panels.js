import { html, Icon } from '../ui/components.js';
import { Img, UnitThumb, RichText } from '../ui/gameComponents.js';
import { ChessDetail } from '../ui/detailPanel.js';
import { skillRecordIconUrl, itemIconUrl, bondIconUrl, tokenAvatarUrl } from '../ui/assetUrls.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { Select, Numeric, numeric } from './ui.js';
import { TRAINING_TIMES } from '../../../shared/training.js';
import { trainingModeLabel } from './model.js';
export { TrainingResults } from './results.js';

export function TrainingLibrary({ raw, tab, setTab, query, setQuery, palette, armedItem, tokens, editable, onPick, onItem, onToken, onDrag }) {
  const manifest = data.get('assets');
  const roster = Object.values(raw.chess).filter(r => !r.isGolden && !r.isDiy && !r.isHidden && r.visible !== false)
    .filter(r => `${r.name} ${data.localeName(r.name)} ${r.charId}`.toLowerCase().includes(query.toLowerCase()));
  const items = Object.entries(raw.items).filter(([, r]) => r.itemType === 'EQUIP' && data.localeName(r.name).includes(query));
  const drag = (e, value) => { e.dataTransfer.setData('application/x-training', JSON.stringify(value)); onDrag?.(value); };
  return html`<section class="tf-library" aria-label=${t('单位与装备库')} data-testid="training-library">
    <header><div class="tf-tabs">${[['chess', t('干员')], ['items', t('装备')], ['tokens', t('召唤物')]].map(([id, label]) => html`<button type="button" key=${id} aria-pressed=${tab === id} onClick=${() => { setTab(id); setQuery(''); }}>${label}</button>`)}</div>
      <input type="search" aria-label=${t('搜索干员或装备')} placeholder=${t('搜索干员或装备')} value=${query} onInput=${e => setQuery(e.currentTarget.value)} /></header>
    <div class="tf-catalogue" data-testid="training-roster">${tab === 'chess' ? roster.map(r => html`<button key=${r.chessId} type="button" data-chess=${r.chessId} disabled=${!editable} aria-pressed=${palette?.chessId === r.chessId}
      draggable=${editable} onDragStart=${e => drag(e, { kind: 'chess', id: r.chessId })} onClick=${() => onPick(r)}>
      <${UnitThumb} kind="chess" id=${r.chessId} size="md" /><b>${data.localeName(r.name)}</b><span>${r.tier} ${t('阶')}</span></button>`)
      : tab === 'items' ? items.map(([id, r]) => html`<button type="button" key=${id} data-item=${id} disabled=${!editable} aria-pressed=${armedItem === id} draggable=${editable}
        onDragStart=${e => drag(e, { kind: 'item', id })} onClick=${() => onItem(id)} title=${data.localeName(r.name)}><${Img} src=${itemIconUrl(manifest, r)} fallback=${html`<${Icon} name="box" />`} /><b>${data.localeName(r.name)}</b></button>`)
      : tokens.length ? tokens.map(slot => html`<button type="button" key=${`${slot.ownerUid}:${slot.tokenId}`} disabled=${!editable || !slot.remaining}
        draggable=${editable && !!slot.remaining} onDragStart=${e => drag(e, { kind: 'token', id: slot.tokenId, ownerUid: slot.ownerUid })} onClick=${() => onToken(slot)}>
        <${Img} src=${tokenAvatarUrl(manifest, slot.tokenId)} /><b>${data.localeName(slot.name)}</b><span>${slot.remaining} / ${slot.count}</span></button>`)
      : html`<p class="tf-empty-inline">${t('先部署所属干员，再选择其召唤物。')}</p>`}</div>
  </section>`;
}

export function TrainingInspector({ raw, unit, editable, live, onChange, onForm, onRemove, onEquip, onUnequip, onRotate, onClose }) {
  const rec = raw.chess[unit?.chessId], shown = rec && (data.lookup('chess', rec.chessId) || rec);
  if (!unit) return html`<section class="tf-inspector tf-empty-inspector"><${Icon} name="user" /><h2>${t('点击场上干员')}</h2><p>${t('在这里换技能、配装备，直接观察攻击范围。')}</p></section>`;
  const manifest = data.get('assets'), sk = unit.skillIndex ?? rec?.skill?.index;
  return html`<section class="tf-inspector" data-testid="training-inspector"><header><${UnitThumb} kind=${rec ? 'chess' : 'token'} id=${unit.chessId || unit.tokenId} size="lg" />
    <div><h2>${data.localeName(rec?.name || raw.tokens[unit.tokenId]?.name || '')}</h2><span>${rec?.isGolden ? t('精锐') : t('普通')}</span></div>
    <button type="button" class="tf-icon-button" aria-label=${t('关闭单位面板')} onClick=${onClose}><${Icon} name="close" /></button></header>
    ${rec ? html`<div class="tf-icon-choices" aria-label=${t('技能')}>${shown.skills?.map(skill => html`<button type="button" key=${skill.index} data-skill=${skill.index} disabled=${!editable} aria-pressed=${sk === skill.index} title=${skill.name} onClick=${() => onChange({ skillIndex: skill.index })}>
      <${Img} src=${skillRecordIconUrl(manifest, skill, { empty: false })} fallback=${html`<b>S${skill.index + 1}</b>`} /><span>S${skill.index + 1}</span></button>`)}</div>
      <p class="tf-selected-skill">${shown.skills?.find(s => s.index === sk)?.name || shown.skill?.name}</p>
      <div class="tf-equipment">${[0, 1].map(i => { const item = raw.items[unit.items?.[i]]; return html`<div key=${i}><button type="button" data-testid=${`training-equip-${i}`} disabled=${!editable} onClick=${() => onEquip(i)} title=${item ? data.localeName(item.name) : t('选择装备')}>
        ${item ? html`<${Img} src=${itemIconUrl(manifest, item)} />` : html`<${Icon} name="plus" />`}<span>${item ? data.localeName(item.name) : t('装备 {n}', { n: i + 1 })}</span></button>
        ${item && editable ? html`<button type="button" class="tf-unequip" onClick=${() => onUnequip(i)}>${t('卸下')}</button>` : null}</div>`; })}</div>
      <div class="tf-unit-tools"><button type="button" disabled=${!editable} onClick=${onForm}>${rec.isGolden ? t('切换普通') : t('晋升精锐')}</button><button type="button" disabled=${!editable} onClick=${onRotate}>${t('调整朝向')}</button></div>
      ${rec.isGolden ? html`<${Select} label=${t('模组')} value=${unit.moduleId ?? rec.modules?.find(m => m.isDefault)?.uniEquipId ?? 'none'} disabled=${!editable}
        options=${[['none', t('无')], ...(shown.modules || []).map(m => [m.uniEquipId, m.name])]} onChange=${moduleId => onChange({ moduleId })} />` : null}
      ${live ? html`<dl class="tf-live-stats"><div><dt>HP</dt><dd>${numeric(live.hp)} / ${numeric(live.maxHp)}</dd></div><div><dt>${t('攻击力')}</dt><dd>${numeric(live.atk)}</dd></div><div><dt>SP</dt><dd>${numeric(live.sp)}</dd></div></dl>` : null}
      <details><summary>${t('更多配置')}</summary><${Select} label=${t('潜能')} value=${unit.potential ?? 6} disabled=${!editable} options=${[1, 2, 3, 4, 5, 6].map(n => [n, n])} onChange=${n => onChange({ potential: +n })} />
        <${Select} label=${t('练度')} value=${unit.cultivate ?? 3} disabled=${!editable} options=${[[0, t('未精英化')], [1, t('精英阶段1')], [2, t('精英阶段2')], [3, t('精英2 Lv.60')]]} onChange=${n => onChange({ cultivate: +n })} /></details>
      <details><summary>${t('干员资料与数值')}</summary><${ChessDetail} chess=${shown} editable=${false} piece=${{ ...unit, id: unit.chessId, items: unit.items.map(id => ({ id })) }}
        loadout=${{ [rec.baseId || rec.chessId]: { skill: sk, module: unit.moduleId } }}
        cultOpts=${{ cultivation: { potential: unit.potential ?? 6, cultivate: unit.cultivate ?? 3 } }} live=${live || null} /></details>`
      : html`<button type="button" disabled=${!editable} onClick=${onRotate}>${t('调整朝向')}</button>`}
    ${editable ? html`<button type="button" class="tf-remove" onClick=${onRemove}>${t('移除单位')}</button>` : html`<p class="tf-note">${t('返回备战后可修改搭配')}</p>`}
  </section>`;
}

export function TrainingConditions({ doc, raw, options, update, onEnvironment, onClear, onClose, library, save, load, savedIndex, setSavedIndex, exportDoc, importDoc, player, updatePlayer }) {
  const entries = file => Object.entries(raw[file] || {});
  const isUnit = doc.mode === 'unit';
  return html`<aside class="tf-drawer" aria-label=${t('公共测试条件')} data-testid="training-conditions"><header><h2>${t('公共测试条件')}</h2><button type="button" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button></header>
    <div class="tf-drawer-scroll">
      ${isUnit ? html`<${Select} label=${t('测试时长')} value=${doc.environment.seconds} options=${TRAINING_TIMES.map(n => [n, `${n}s`])} onChange=${n => onEnvironment({ seconds: +n })} />
        <${Numeric} label=${t('木桩生命')} testId="training-hp" value=${doc.dummy.hp} min=${1} max=${1e10} onChange=${hp => update({ ...doc, dummy: { ...doc.dummy, hp } })} />
        <${Numeric} label=${t('木桩防御')} value=${doc.dummy.def} max=${1e6} onChange=${def => update({ ...doc, dummy: { ...doc.dummy, def } })} />
        <${Numeric} label=${t('木桩法抗')} value=${doc.dummy.res} min=${-100} max=${100} onChange=${res => update({ ...doc, dummy: { ...doc.dummy, res } })} />
        <${Numeric} label=${t('木桩数量')} value=${doc.dummy.count} min=${1} max=${12} onChange=${count => update({ ...doc, dummy: { ...doc.dummy, count } })} />`
        : html`<${Select} label=${t('地图')} value=${doc.environment.stageId} options=${entries('stages').map(([id, r]) => [id, data.localeName(r.name)])} onChange=${stageId => onClear({ environment: { ...doc.environment, stageId } })} />
          <${Select} label=${t('战场区域')} value=${doc.environment.kind} options=${[['normal', t('各自行动')], ['boss', t('最终攻势')], ['hidden', t('隐秘核心')]]} onChange=${kind => {
            const boss = entries('bosses').find(([, b]) => !!b.hidden === (kind === 'hidden'));
            onClear({ environment: { ...doc.environment, kind, fields: 1, round: kind === 'normal' ? 1 : kind === 'hidden' ? 15 : 14, bossId: kind === 'normal' ? null : boss?.[0] }, resetFields: true });
          }} />
          <${Numeric} label=${t('回合')} value=${doc.environment.round} min=${1} max=${15} onChange=${round => onEnvironment({ round })} />
          <${Numeric} label=${t('测试时限')} value=${doc.environment.seconds} min=${1} max=${1200} onChange=${seconds => onEnvironment({ seconds })} />
          ${doc.environment.kind !== 'normal' ? html`<${Select} label=${t('领袖')} value=${doc.environment.bossId} options=${entries('bosses').filter(([, b]) => !!b.hidden === (doc.environment.kind === 'hidden')).map(([id, b]) => [id, data.localeName(b.name)])} onChange=${bossId => onEnvironment({ bossId })} />` : null}`}
      <${Select} label=${t('难度 / 规程等级')} value=${doc.environment.modeId} options=${options.modes.map(m => [m.id, trainingModeLabel(m, data.localeName(m.name))])} onChange=${modeId => onEnvironment({ modeId })} />
      <details><summary>${t('随机条件')}</summary><${Numeric} label=${t('随机种子')} value=${doc.environment.seed} min=${1} max=${4294967295} onChange=${seed => onEnvironment({ seed })} />
        <button type="button" onClick=${() => { const a = new Uint32Array(1); crypto.getRandomValues(a); onEnvironment({ seed: a[0] || 1 }); }}>${t('重新抽取随机条件')}</button></details>
      <details><summary>${t('高级战斗条件')}</summary><${Select} label=${t('策略')} value=${player?.bandId || ''} options=${[['', t('无')], ...entries('bands').map(([id, r]) => [id, data.localeName(r.name)])]} onChange=${bandId => updatePlayer({ bandId: bandId || null })} />
        <p class="tf-note">${t('仅运行策略的战斗效果，不模拟资金与整备奖励。')}</p></details>
      <details><summary>${t('我的试算方案')}</summary><label class="tr-field">${t('方案名称')}<input maxLength="120" value=${doc.name} onInput=${e => update({ ...doc, name: e.currentTarget.value })} /></label>
        <button type="button" onClick=${save}>${t('保存方案')}</button><${Select} label=${t('已保存方案')} value=${savedIndex} options=${[['', t('选择方案')], ...library.saved.map((s, i) => [i, s.name])]} onChange=${setSavedIndex} />
        <button type="button" disabled=${savedIndex === ''} onClick=${load}>${t('打开方案')}</button><div class="tf-row"><button type="button" onClick=${exportDoc}>${t('导出方案')}</button><button type="button" onClick=${importDoc}>${t('导入方案')}</button></div></details>
      <p class="tf-note">${t('公共条件改变时，A、B 两个方案都需要重新试算。')}</p>
    </div></aside>`;
}

export function TrainingBondStrip({ raw, player, compiled, field, mode, activeBond, setActiveBond, updatePlayer, editable }) {
  const ids = Object.keys(raw.bonds).filter(id => mode === 'unit' ? player.bonds[id]?.tier || player.units.some(u => raw.chess[u.chessId]?.bonds?.includes(id)) : compiled?.bondStates[field]?.[id]?.count);
  const bond = raw.bonds[activeBond], value = player.bonds[activeBond] || { tier: 0, layers: 0 };
  return html`<div class="tf-bond-zone"><div class="tf-bonds" aria-label=${t('盟约与层数')}>${ids.map(id => html`<button type="button" key=${id} aria-pressed=${activeBond === id} onClick=${() => setActiveBond(activeBond === id ? null : id)}>
      <${Img} src=${bondIconUrl(data.get('assets'), id)} /><span>${data.localeName(raw.bonds[id].name)}<small>${mode === 'team' ? compiled?.bondStates[field]?.[id]?.count || 0 : player.bonds[id]?.tier || 0} · ${player.bonds[id]?.layers || 0}</small></span></button>`)}
      ${mode === 'unit' ? html`<button type="button" onClick=${() => setActiveBond(activeBond ? null : Object.keys(raw.bonds)[0])}>${t('外部盟约加成')}</button>` : null}</div>
    ${bond ? html`<section class="tf-bond-editor"><${Select} label=${mode === 'unit' ? t('盟约加成（测试假设）') : t('盟约')} value=${activeBond} options=${Object.entries(raw.bonds).map(([id, r]) => [id, data.localeName(r.name)])} onChange=${setActiveBond} />
      ${mode === 'unit' ? html`<${Select} label=${t('阶数')} value=${value.tier} disabled=${!editable} options=${Array.from({ length: bond.thresholds.length + 1 }, (_, i) => [i, i ? i : t('未激活')])} onChange=${n => updatePlayer({ bonds: { ...player.bonds, [activeBond]: { ...value, tier: +n } } })} />` : null}
      <${Numeric} label=${t('层数')} value=${value.layers} onChange=${layers => { if (editable) updatePlayer({ bonds: { ...player.bonds, [activeBond]: { ...value, layers } } }); }} />
      <${RichText} text=${bond.desc || bond.effectDesc || ''} /></section>` : null}</div>`;
}
