import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, TextField } from './components.js';
import { createStore, store, useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';
import { copyText } from './clipboard.js';
import { backupDue, initializeReminder, isTemporaryHost, reminderState, updateReminder } from './backupReminder.js';
import { capturePersonalData, encodePersonalData, decodePersonalData, restorePersonalData, personalSummary,
  migrationOrigin, validMigrationMessage, MAX_CODE_CHARS } from './personalData.js';

const panel = createStore({ open: false });
export const openPersonalData = () => panel.set({ open: true });
function sourceRequest() {
  try {
    const match = /^#sp-migrate=(.+)$/.exec(location.hash);
    if (!match) return null;
    const raw = JSON.parse(decodeURIComponent(match[1]));
    const origin = migrationOrigin(raw.origin);
    if (!/^[a-f0-9]{32}$/.test(raw.nonce) || !window.opener) return null;
    history.replaceState(history.state, '', location.pathname + location.search);
    return { origin, nonce: raw.nonce };
  } catch { return null; }
}
const incomingRequest = typeof window === 'object' ? sourceRequest() : null;
function errorText(err) {
  switch (err?.code) {
    case 'newer': return t('恢复码版本较新，请更新游戏后重试。');
    case 'too-large': return t('个人数据过大，请减少自定义背景大小后重试。');
    case 'compression': return t('浏览器不支持解压恢复码，请使用新版浏览器。');
    case 'storage': return t('无法写入本机存储，已撤销本次恢复。请释放空间或允许网站存储后重试。');
    case 'rollback': return t('存储回滚失败，请保留恢复码，释放空间后重试。');
    case 'origin': return t('请输入与当前网站不同的完整旧网址，例如 https://old.example.com。');
    case 'popup': return t('浏览器拦截了旧站窗口，请允许弹出窗口后重试。');
    case 'timeout': return t('旧站没有回应，请检查网址、在旧站允许迁移，或改用恢复码。旧站也需要部署支持迁移的版本。');
    default: return t('无法读取个人数据，请核对恢复码是否完整，或重试导出。');
  }
}
function PersonalDataPanel({ source, onClose }) {
  const [code, setCode] = useState('');
  const [exported, setExported] = useState('');
  const [oldSite, setOldSite] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [reminders, setReminders] = useState(() => reminderState().enabled);
  const active = useRef(true), cancelMigration = useRef(() => {}), fileRef = useRef(null), operation = useRef(false);
  const oldSiteEdited = useRef(false);
  useEffect(() => () => { active.current = false; cancelMigration.current(); }, []);
  useEffect(() => {
    if (source) return;
    const controller = new AbortController();
    fetch('/personal-data-config.json', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((config) => {
        if (!active.current || oldSiteEdited.current || typeof config?.migrationSource !== 'string') return;
        try {
          const origin = migrationOrigin(config.migrationSource);
          setOldSite(origin + '/');
        } catch { /* absent, invalid or this origin: leave the editable field empty */ }
      }).catch(() => { /* optional machine-local default; manual entry stays available */ });
    return () => controller.abort();
  }, [source]);
  const close = () => {
    if (busy && busy !== 'migration') return;
    cancelMigration.current();
    if (done && !source) location.reload(); else onClose();
  };
  const work = async (kind, fn) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(kind); setError(''); setMessage('');
    try { await fn(); } catch (err) { if (active.current) setError(errorText(err)); }
    finally { operation.current = false; if (active.current) setBusy(''); }
  };
  const doExport = () => work('export', async () => {
    const value = await encodePersonalData(await capturePersonalData());
    if (active.current) setExported(value);
  });
  const doCopy = () => work('copy', async () => {
    const ok = await copyText(exported);
    if (ok) updateReminder({ exportedAt: Date.now() });
    if (active.current) setMessage(ok ? t('恢复码已复制，请妥善保存。') : t('快捷复制失败，请选中恢复码手动复制。'));
  });
  const inspect = () => work('inspect', async () => {
    setPreview(null);
    const value = await decodePersonalData(code);
    if (active.current) setPreview(value);
  });
  const saveFile = () => work('file-export', async () => {
    const url = URL.createObjectURL(new Blob([exported], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    try {
      link.href = url; link.download = `stronghold-personal-${new Date().toISOString().slice(0, 10)}.spdata`;
      document.body.appendChild(link); link.click();
      updateReminder({ exportedAt: Date.now() });
    } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }
  });
  const loadFile = (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    void work('file-import', async () => {
      setPreview(null);
      if (file.size > MAX_CODE_CHARS) throw Object.assign(new Error('too-large'), { code: 'too-large' });
      const text = await file.text();
      const value = await decodePersonalData(text);
      if (active.current) { setCode(text); setPreview(value); }
    });
  };
  const restore = () => work('restore', async () => {
    if (store.get().room) { setError(t('请先离开当前同盟，再恢复个人数据。')); return; }
    await restorePersonalData(preview);
    if (active.current) { setDone(true); setPreview(null); setMessage(t('个人数据已恢复，刷新页面后生效。')); }
  });
  const send = () => work('send', async () => {
    const value = await encodePersonalData(await capturePersonalData());
    if (!window.opener || window.opener.closed) throw new Error('closed');
    window.opener.postMessage({ type: 'sp.personal-data', nonce: source.nonce, code: value }, source.origin);
    if (active.current) { setDone(true); setMessage(t('数据已发送，请回到新站核对并确认恢复。')); }
  });
  const migrate = () => {
    setError(''); setMessage(''); setPreview(null);
    let origin;
    try { origin = migrationOrigin(oldSite); } catch (err) { setError(errorText(err)); return; }
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    let popup = null, timer, closedTimer;
    const cleanup = () => { clearTimeout(timer); clearInterval(closedTimer); window.removeEventListener('message', receive); popup?.close(); };
    const receive = (event) => {
      if (!validMigrationMessage(event, popup, origin, nonce)) return;
      cleanup();
      void work('inspect', async () => {
        const value = await decodePersonalData(event.data.code);
        if (active.current) setPreview(value);
      });
    };
    window.addEventListener('message', receive);
    popup = window.open(`${origin}/#sp-migrate=${encodeURIComponent(JSON.stringify({ origin: location.origin, nonce }))}`, '_blank', 'popup,width=960,height=720');
    if (!popup) { cleanup(); setError(errorText({ code: 'popup' })); return; }
    setBusy('migration');
    setMessage(t('请在旧站窗口确认目标网址并允许迁移。'));
    timer = setTimeout(() => { cleanup(); if (active.current) { setBusy(''); setMessage(''); setError(errorText({ code: 'timeout' })); } }, 180000);
    closedTimer = setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      if (active.current) { setBusy(''); setMessage(''); setError(errorText({ code: 'timeout' })); }
    }, 750);
    cancelMigration.current = () => { cleanup(); if (active.current) { setBusy(''); setMessage(''); } };
  };
  const summary = useMemo(() => preview ? personalSummary(preview) : null, [preview]);
  return html`<${Modal} open=${true} class="personal-data-modal" veilClass="personal-data-veil" title=${source ? t('迁移个人数据') : t('导出 / 导入个人数据')} onClose=${close}
    closeOnBackdrop=${!busy} actions=${html`<${Button} variant="secondary" disabled=${!!busy && busy !== 'migration'} onClick=${close}>${t('关闭')}<//>`}>
    <div class="personal-data-panel">
      <p>${t('包含本机账号、昵称、头像、战绩与成就、干员调配、皮肤、设置、插件个人配置、自定义大厅背景和音乐。素材缓存及临时对局凭证不包含在内。')}</p>
      <p class="personal-data-warning">${t('恢复码包含个人数据，请像密码一样保管；它是备份时的快照，不会自动更新。')}</p>
      ${!source ? html`<label><input type="checkbox" checked=${reminders} onChange=${(e) => { setReminders(e.currentTarget.checked); updateReminder({ enabled: e.currentTarget.checked }); }} /> ${t('定期提醒导出个人数据')}</label>` : null}
      ${source ? html`<section>
        <h3>${t('向新站传输')}</h3><p>${t('确认只将个人数据发送到以下网址：')}</p>
        <strong class="personal-data-origin">${source.origin}</strong>
        <${Button} variant="primary" disabled=${!!busy || done} loading=${busy === 'send'} onClick=${send}>${t('允许迁移')}<//>
      </section>` : done ? html`<${Button} variant="primary" icon="refresh" onClick=${() => location.reload()}>${t('刷新页面')}<//>` : html`
        <section><h3>${t('导出个人数据')}</h3>
          <div class="personal-data-actions"><${Button} variant="primary" icon="download" disabled=${!!busy} loading=${busy === 'export'} onClick=${doExport}>${t('生成恢复码')}<//>
            ${exported ? html`<${Button} variant="secondary" icon="copy" disabled=${!!busy} onClick=${doCopy}>${t('复制恢复码')}<//>
              <${Button} variant="secondary" icon="download" disabled=${!!busy} onClick=${saveFile}>${t('保存恢复码文件')}<//>` : null}</div>
          ${exported ? html`<textarea data-testid="personal-data-export" aria-label=${t('导出的恢复码')} readonly value=${exported} onFocus=${(e) => e.currentTarget.select()} spellcheck="false" />` : null}
        </section>
        <section><h3>${t('导入个人数据')}</h3>
          <textarea data-testid="personal-data-input" aria-label=${t('粘贴恢复码')} placeholder=${t('在这里粘贴完整恢复码')} value=${code} maxLength=${MAX_CODE_CHARS}
            disabled=${!!busy} onInput=${(e) => { setCode(e.currentTarget.value); setPreview(null); }} spellcheck="false" />
          <div class="personal-data-actions"><${Button} variant="secondary" icon="upload" disabled=${!!busy || !code.trim()} loading=${busy === 'inspect'} onClick=${inspect}>${t('检查恢复码')}<//>
            <${Button} variant="secondary" disabled=${!!busy} onClick=${() => fileRef.current?.click()}>${t('读取恢复码文件')}<//></div>
          <input ref=${fileRef} type="file" accept=".spdata,.txt,text/plain" hidden onChange=${loadFile} />
        </section>
        <section><h3>${t('从旧域名迁移')}</h3>
          <p>${t('旧站仍可访问时，在同一浏览器打开旧站并授权传输。旧站失效且没有恢复码时，无法读取旧域名的数据。')}</p>
          <${TextField} label=${t('旧站网址')} value=${oldSite} placeholder="https://old.example.com" disabled=${!!busy} onInput=${(value) => { oldSiteEdited.current = true; setOldSite(value); }} />
          <${Button} variant="secondary" icon="link" disabled=${!!busy || !oldSite.trim()} onClick=${migrate}>${t('打开旧站迁移')}<//>
          ${busy === 'migration' ? html`<${Button} variant="ghost" onClick=${() => cancelMigration.current()}>${t('取消')}<//>` : null}
        </section>
        ${summary ? html`<section class="personal-data-preview" data-testid="personal-data-preview">
          <h3>${t('确认恢复')}</h3>
          <p>${t('博士：{name} · {records} 条战绩 · {count} 项配置', { name: summary.name || t('博士'), records: summary.records, count: summary.count })}</p>
          <p>${t('备份时间：{time}', { time: summary.exportedAt || '—' })}</p>
          ${summary.backdrop ? html`<p>${t('包含自定义大厅背景')}</p>` : null}
          ${summary.music ? html`<p>${t('包含自定义大厅音乐')}</p>` : null}
          <p>${t('战绩按记录去重合并；备份中的配置将覆盖当前同名配置。恢复后请刷新页面。')}</p>
          <${Button} variant="primary" disabled=${!!busy} loading=${busy === 'restore'} onClick=${restore}>${t('确认并恢复')}<//>
        </section>` : null}
      `}
      ${message ? html`<p role="status">${message}</p>` : null}
      ${error ? html`<p role="alert" class="personal-data-error">${error}</p>` : null}
    </div>
  <//>`;
}
export function PersonalDataHost() {
  const open = useStore((s) => s.open, Object.is, panel);
  const [source, setSource] = useState(incomingRequest);
  if (!open && !source) return null;
  return html`<${PersonalDataPanel} source=${source} onClose=${() => { panel.set({ open: false }); setSource(null); }} />`;
}

export function PersonalDataReminder() {
  const [due, setDue] = useState(false);
  useEffect(() => {
    initializeReminder();
    const sync = () => setDue(backupDue(undefined, location.hostname));
    sync(); window.addEventListener('sp:backup-reminder', sync); window.addEventListener('storage', sync);
    return () => { window.removeEventListener('sp:backup-reminder', sync); window.removeEventListener('storage', sync); };
  }, []);
  if (!due) return null;
  return html`<section class="personal-data-reminder" role="status" data-testid="backup-reminder">
    <p>${isTemporaryHost(location.hostname) ? t('当前为临时网址，换网址前请导出个人数据。') : t('建议备份本机个人数据，换网址或清理浏览器前可用于恢复。')}</p>
    <div class="personal-data-actions"><${Button} size="sm" icon="download" onClick=${openPersonalData}>${t('导出个人数据')}<//>
      <${Button} size="sm" variant="ghost" onClick=${() => updateReminder({ dismissedAt: Date.now() })}>${t('明天再提醒')}<//></div>
  </section>`;
}
