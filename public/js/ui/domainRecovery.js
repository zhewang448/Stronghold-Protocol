// Configured origins answer in one top-level helper; checks never mutate the last game entry.
import { render } from '../../vendor/preact.module.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from './components.js';
import { createStore, store, useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';
import { initLang } from './lang.js';
import { fetchDomainConfig, storedPersonalSummary, storedMediaSummary, RECOVERY_SEEN_KEY } from './domainRecoveryModel.js';
import { restorePersonalData, personalSummary, saveRecoveryBackup, readRecoveryBackup, undoRecoveryBackup } from './personalData.js';
import { openPersonalData, hasPersonalDataMigration } from './personalDataPanel.js';
import { beginDirectMigration, receiveDirectMigration, directTransferRequest, TRANSFER_HASH } from './domainTransfer.js';
import { createDomainDiscovery, openDiscoveryWindow } from './domainDiscovery.js';

const recovery = createStore({ open: false, incoming: null, transferring: false, transferFailed: false });
let cancelDirectReceive = () => {};
let config = { canonicalOrigin: '', sources: [] };
let legacy = null;
let discoveryPopup = null;
export const openRecovery = event => {
  if (event?.isTrusted && !recovery.get().open) discoveryPopup = openDiscoveryWindow();
  recovery.set({ open: true });
};
const timeText = value => value && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString() : t('未记录');
function summaryOf(data) {
  const basic = personalSummary(data);
  let profile = {}, last = null, records = [];
  try { profile = JSON.parse(data.entries['sp.pref.localAccount'] || '{}') || {}; last = JSON.parse(data.entries['sp.pref.lastEnteredAt'] || 'null'); records = JSON.parse(data.entries['sp.pref.stats'] || '{}').records || []; } catch { /* optional metadata */ }
  return { ...basic, hasData: true, lastEnteredAt: Number.isFinite(last) ? last : null, recentMatchAt: records.reduce((n, r) => Math.max(n, Number(r.t) || 0), 0),
    tag: typeof profile.tag === 'string' ? profile.tag.slice(0, 4) : '', avatar: typeof profile.avatar === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(profile.avatar) && profile.avatar.length <= 160000 ? profile.avatar : null };
}
function Summary({ value }) {
  return html`<div class='recovery-summary'>
    ${value.avatar ? html`<img class='recovery-avatar' src=${value.avatar} alt='' />` : null}
    <div><strong>${value.name || t('未命名存档')}${value.tag ? ` #${value.tag}` : ''}</strong>
      <p>${t('战绩：{n} 条', { n: value.records })} · ${t('配置：{n} 项', { n: value.count })}</p>
      <p>${t('最近进入游戏：{time}', { time: timeText(value.lastEnteredAt) })}</p>
      <p>${t('最近一局：{time}', { time: timeText(value.recentMatchAt) })}</p>
      ${value.backdrop ? html`<p>${t('包含自定义大厅背景')}</p>` : null}
      ${value.music ? html`<p>${t('包含自定义大厅音乐')}</p>` : null}</div>
  </div>`;
}
function RecoveryPanel({ onClose }) {
  const incoming = useStore(s => s.incoming, Object.is, recovery);
  const transferring = useStore(s => s.transferring, Object.is, recovery);
  const transferFailed = useStore(s => s.transferFailed, Object.is, recovery);
  const [sources, setSources] = useState(config.sources.filter(r => r.origin !== location.origin));
  const [rows, setRows] = useState({});
  const [current, setCurrent] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewOrigin, setPreviewOrigin] = useState('');
  const [undo, setUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [scanStatus, setScanStatus] = useState('');
  const alive = useRef(true), discovery = useRef(null), locked = useRef(false);
  useEffect(() => {
    if (incoming) { setPreview(incoming.data); setPreviewOrigin(incoming.origin); }
  }, [incoming]);
  useEffect(() => {
    discovery.current = createDomainDiscovery({
      onResult: (origin, patch) => { if (alive.current) setRows(previous => ({ ...previous, [origin]: { ...previous[origin], ...patch } })); },
      onStatus: status => { if (alive.current) setScanStatus(status); },
      onPreview: (data, origin) => { if (alive.current) { setPreview(data); setPreviewOrigin(origin); setBusy(false); locked.current = false; } },
      onExportError: () => { if (alive.current) { setError(t('无法读取个人数据，请核对恢复码是否完整，或重试导出。')); setBusy(false); locked.current = false; } },
    });
    fetchDomainConfig().then(value => {
      if (!alive.current) return;
      config = value; const enabled = value.sources.filter(r => r.origin !== location.origin); setSources(enabled);
      if (enabled.length && !recovery.get().incoming && !recovery.get().transferring && location.origin === value.canonicalOrigin) {
        discovery.current.scan(enabled, discoveryPopup || openDiscoveryWindow()); discoveryPopup = null;
      } else { try { discoveryPopup?.close(); } catch { /* unused helper */ } discoveryPopup = null; }
    });
    try { setCurrent(storedPersonalSummary()); } catch { setError(t('无法读取本机存储，请允许网站存储后重试。')); }
    storedMediaSummary().then(media => { if (alive.current) setCurrent(current => current ? { ...current, ...media, hasData: current.hasData || media.backdrop || media.music } : current); }).catch(() => {});
    readRecoveryBackup().then(value => { if (alive.current) setUndo(!!value); }).catch(() => {});
    return () => { alive.current = false; discovery.current?.dispose(); try { discoveryPopup?.close(); } catch { /* helper gone */ } discoveryPopup = null; };
  }, []);
  const close = () => { if (locked.current) return; if (done) location.reload(); else onClose(); };
  const scan = candidates => { setError(''); setPreview(null); discovery.current?.scan(candidates, discovery.current.window || openDiscoveryWindow()); };
  const select = source => {
    locked.current = true; setBusy(true); setError('');
    discovery.current?.select(source, discovery.current.window || openDiscoveryWindow());
  };
  const restore = async () => {
    if (locked.current) return;
    if (store.get().room) { setError(t('请先离开当前同盟，再恢复个人数据。')); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      await saveRecoveryBackup(); await restorePersonalData(preview);
      try { localStorage.setItem(RECOVERY_SEEN_KEY, '1'); } catch { /* restored data is already durable */ }
      if (alive.current) { setUndo(true); setDone(true); setPreview(null); }
    }
    catch { if (alive.current) setError(t('恢复失败，本次操作已停止；请保留恢复码并检查存储空间。')); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  const revert = async () => {
    if (locked.current) return;
    if (store.get().room) { setError(t('请先离开当前同盟，再恢复个人数据。')); return; }
    locked.current = true; setBusy(true); setError('');
    try { await undoRecoveryBackup(); location.reload(); }
    catch { if (alive.current) setError(t('撤销失败，请检查存储空间后重试；备份仍保留。')); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  const scanning = scanStatus === 'scanning';
  const statusText = status => ({ checking: t('正在读取旧站回复…'), found: t('发现存档'), empty: t('该旧站没有存档'), storage: t('旧站存储不可读取，请检查浏览器权限'), unavailable: t('旧站未回应或窗口已关闭，请重新检查') })[status] || t('等待自动读取');
  return html`<${Modal} open=${true} title=${t('找回数据')} class='personal-data-modal' veilClass='personal-data-veil' onClose=${close} closeOnBackdrop=${!busy}
    actions=${html`<${Button} variant='secondary' disabled=${busy} onClick=${close}>${done ? t('刷新页面') : t('关闭')}<//>`}>
    <div class='personal-data-panel recovery-panel'>
      <p>${incoming ? t('旧站存档已带入，请核对后确认恢复。无需再次打开旧站检查。') : t('自动汇总所有启用旧站的存档摘要，选择后直接预览。不会改写旧站数据或最近进入时间。')}</p>
      ${transferring ? html`<p role='status'>${t('正在接收旧站存档，请保持旧站页面打开…')}</p>` : null}
      ${transferFailed ? html`<p role='alert' class='personal-data-error'>${t('直接迁移未完成，请回旧站重试，或使用下方的旧站检查和恢复码。')}</p>` : null}
      ${current ? html`<section data-testid='recovery-current'><h3>${t('当前站存档')}</h3><${Summary} value=${current} /></section>` : null}
      ${!done && !preview && !transferring ? html`<section><h3>${t('旧站存档')}</h3>
        <${Button} variant='secondary' disabled=${busy || scanning || !sources.length} onClick=${() => scan(sources)}>${t('查找全部旧站')}<//>
        <p role='status' data-testid='discovery-status'>${scanning ? t('正在自动读取全部旧站，请保持辅助窗口打开…') : scanStatus === 'blocked' ? t('浏览器阻止自动打开辅助窗口，请点击一次“查找全部旧站”。') : scanStatus === 'closed' ? t('辅助窗口已关闭，已收到的回复仍保留，可重新查找。') : scanStatus === 'complete' ? t('旧站回复已汇总，可直接选择存档。') : ''}</p>
        ${sources.length ? sources.map(source => html`<article class='recovery-source' key=${source.origin} data-origin=${source.origin}>
          <h4>${source.label || t('旧站')}</h4><p class='personal-data-origin'>${source.origin}</p>
          <p role='status'>${statusText(rows[source.origin]?.status)}</p>
          ${rows[source.origin]?.summary ? html`<${Summary} value=${rows[source.origin].summary} />` : null}
          <div class='personal-data-actions'>${['unavailable', 'storage'].includes(rows[source.origin]?.status) ? html`<${Button} variant='secondary' disabled=${busy || scanning} onClick=${() => scan([source])}>${t('重试此旧站')}<//>` : null}
          ${rows[source.origin]?.summary?.hasData ? html`<${Button} variant='primary' disabled=${busy} onClick=${() => select(source)}>${t('选择此存档')}<//>` : null}</div>
        </article>`) : html`<p>${t('尚未配置旧网址，请联系服主，或使用恢复码导入。')}</p>`}
        <p>${t('旧站失效、证书异常或不支持迁移时，请使用预先导出的恢复码。无法连接不代表没有存档。')}</p>
        <${Button} variant='secondary' disabled=${busy} onClick=${() => { onClose(); openPersonalData(); }}>${t('使用恢复码导入')}<//>
      </section>` : done ? html`<p role='status'>${t('个人数据已恢复，刷新页面后生效。')}</p>` : null}
      ${preview ? html`<section class='personal-data-preview' data-testid='recovery-preview'><h3>${t('确认恢复')}</h3>
        <p class='personal-data-origin'>${previewOrigin}</p><${Summary} value=${summaryOf(preview)} />
        <p>${t('战绩按记录去重合并；备份中的配置将覆盖当前同名配置。恢复后请刷新页面。')}</p>
        <p>${t('恢复前自动备份当前站的个人数据，可撤销最近一次恢复。')}</p>
        <${Button} variant='primary' disabled=${busy} onClick=${restore}>${t('确认并恢复')}<//>
      </section>` : null}
      ${undo ? html`<section><h3>${t('恢复前备份')}</h3><p>${t('撤销会恢复最近一次导入前的完整本机数据，并移除导入新增的配置和战绩。')}</p>
        <${Button} variant='secondary' disabled=${busy} onClick=${revert}>${t('撤销最近一次恢复')}<//></section>` : null}
      ${busy ? html`<p role='status'>${t('正在读取或恢复，请稍候…')}</p>` : null}
      ${error ? html`<p role='alert' class='personal-data-error'>${error}</p>` : null}
    </div>
  <//>`;
}
export function RecoveryHost() {
  const open = useStore(s => s.open, Object.is, recovery);
  return html`${legacy?.mode === 'normal' ? html`<aside class='domain-notice' role='status'><span>${t('新网址：{url}', { url: config.canonicalOrigin })}</span><${DirectMigrationButton} /></aside>` : null}
    ${open ? html`<${RecoveryPanel} onClose=${() => { cancelDirectReceive(); try { localStorage.setItem(RECOVERY_SEEN_KEY, '1'); } catch { /* storage denied */ } recovery.set({ open: false, incoming: null, transferring: false, transferFailed: false }); }} />` : null}`;
}
function DirectMigrationButton() {
  const [status, setStatus] = useState('');
  const cancel = useRef(() => {});
  useEffect(() => () => cancel.current(), []);
  const beginDirect = () => {
    cancel.current();
    try { cancel.current = beginDirectMigration(config.canonicalOrigin, setStatus); }
    catch { setStatus('error'); }
  };
  const statusText = {
    sending: t('正在传输，请在新站等待存档预览，并保持本页打开。'),
    sent: t('存档已送达新站，请在新站核对并确认恢复。'),
    blocked: t('浏览器拦截了新站窗口，请允许弹出窗口后重试。'),
    error: t('存档传输失败，请重试或使用恢复码。'),
    timeout: t('新站没有回应，请检查连接后重试。'),
    closed: t('新站窗口已关闭，可重新迁移。'),
  }[status];
  return html`<div><${Button} variant='primary' disabled=${status === 'sending'} onClick=${beginDirect}>${t('迁移存档并前往新站')}<//>
    <p>${t('点击后在新窗口打开正式站，并传输本机个人数据（含背景和音乐）；新站确认后才恢复。')}</p>
    ${statusText ? html`<p role=${['blocked', 'error', 'timeout', 'closed'].includes(status) ? 'alert' : 'status'}>${statusText}</p>` : null}</div>`;
}
function MovingPage({ summary, unreadable }) {
  return html`<main class='domain-bridge'><h1>${t('网站已搬迁')}</h1><p>${t('新网址：{url}', { url: config.canonicalOrigin })}</p>
    ${summary ? html`<${Summary} value=${summary} />` : null}
    ${unreadable ? html`<p role='alert' class='personal-data-error'>${t('无法读取本机存储，请允许网站存储后重试。')}</p>` : null}
    <p>${t('先迁移存档再前往新站。旧站数据会继续保留。')}</p>
    <div class='personal-data-actions'><${DirectMigrationButton} />
      <a class='btn' href=${config.canonicalOrigin}>${t('直接前往新站')}</a><a class='btn' href='/personal-data-bridge.html'>${t('检查迁移页面')}</a></div></main>`;
}
export async function bootDomainGate() {
  if (hasPersonalDataMigration || /^#sp-(migrate|recover-source)=/.test(location.hash)) return false;
  config = await fetchDomainConfig();
  const direct = directTransferRequest(location.hash);
  if (location.hash.startsWith(TRANSFER_HASH)) {
    history.replaceState(history.state, '', location.pathname + location.search);
    openRecovery();
    if (direct && location.origin === config.canonicalOrigin && config.sources.some(r => r.origin === direct.origin)) {
      recovery.set({ transferring: true, transferFailed: false });
      cancelDirectReceive = receiveDirectMigration(direct, incoming => recovery.set({ open: true, incoming, transferring: false }),
        () => recovery.set({ transferring: false, transferFailed: true }));
    } else recovery.set({ transferFailed: true });
  }
  legacy = config.canonicalOrigin ? config.sources.find(r => r.origin === location.origin) || null : null;
  let summary = null, unreadable = false;
  try { summary = storedPersonalSummary(); } catch { unreadable = true; }
  if (legacy && config.canonicalOrigin && legacy.mode !== 'normal') {
    if (legacy.mode === 'smart' && !unreadable && !summary?.hasData) {
      try { const media = await storedMediaSummary(); Object.assign(summary, media); summary.hasData ||= media.backdrop || media.music; } catch { unreadable = true; }
    }
    if (legacy.mode === 'redirect' || legacy.mode === 'smart' && !unreadable && !summary?.hasData) { location.replace(config.canonicalOrigin); return true; }
    await initLang().catch(() => {});
    document.getElementById('boot')?.remove(); document.querySelector('.rotate-hint')?.remove();
    document.body.classList.add('domain-bridge-page');
    render(html`<${MovingPage} summary=${summary} unreadable=${unreadable} />`, document.getElementById('app')); return true;
  }
  let from = '';
  try { if (location.hash.startsWith('#sp-recover-from=')) from = decodeURIComponent(location.hash.slice('#sp-recover-from='.length)); } catch { /* malformed link */ }
  let first = false;
  try { first = !localStorage.getItem(RECOVERY_SEEN_KEY); } catch { /* storage denied */ }
  if (location.origin === config.canonicalOrigin && config.sources.length && (first || config.sources.some(r => r.origin === from))) {
    openRecovery(); if (from) history.replaceState(history.state, '', location.pathname + location.search);
  }
  return false;
}
