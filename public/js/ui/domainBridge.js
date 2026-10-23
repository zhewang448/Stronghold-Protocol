// Top-level legacy-origin page: no game boot, account creation, clocks or entry mutations.
import { t } from '../../../shared/i18n.js';
import { initLang } from './lang.js';
import { storedPersonalSummary, storedMediaSummary, migrationRequest, fetchDomainConfig } from './domainRecoveryModel.js';
import { trustedDiscovery } from './domainDiscovery.js';
import { capturePersonalData, encodePersonalData } from './personalData.js';
const root = document.getElementById('bridge-root');
const request = migrationRequest(location.hash);
const auto = request?.auto === true;
history.replaceState(history.state, '', location.pathname);
const discoveryAllowed = auto && trustedDiscovery(request, await fetchDomainConfig(), location.origin);
await initLang().catch(() => {});
function add(tag, text, cls = '') { const el = document.createElement(tag); el.textContent = text; el.className = cls; root.append(el); return el; }
add('h1', t('找回数据'));
add('p', t('迁移页面可用'));
let summary;
try { summary = storedPersonalSummary(); } catch { add('p', t('无法读取本机存储，请允许网站存储后重试。'), 'personal-data-error'); }
if (auto && discoveryAllowed && !summary && window.opener) window.opener.postMessage({ type: 'sp.recovery-error', nonce: request.nonce, code: 'storage' }, request.origin);
if (summary) {
  try { Object.assign(summary, await storedMediaSummary()); summary.hasData ||= summary.backdrop || summary.music; }
  catch { /* readable local preferences can still be inspected; full export reports media errors */ }
}
if (summary) {
  add('p', summary.name || t('未命名存档'));
  add('p', t('战绩：{n} 条', { n: summary.records }));
  add('p', t('最近进入游戏：{time}', { time: summary.lastEnteredAt ? new Date(summary.lastEnteredAt).toLocaleString() : t('未记录') }));
  if (!summary.hasData) add('p', t('此浏览器在该旧网址下没有个人存档。'));
}
if (request && window.opener && summary) {
  add('p', t('授权后先发送摘要；在新站选择此存档时，会向下列网址发送完整个人数据，包括背景和音乐。确认恢复后才写入新站。'));
  add('strong', request.origin, 'personal-data-origin');
  const status = add('p', '', 'personal-data-feedback'); status.setAttribute('role', 'status');
  const allow = auto ? null : add('button', t('允许检查存档'), 'btn btn--primary'); if (allow) allow.type = 'button';
  const send = (data) => window.opener.postMessage({ ...data, nonce: request.nonce }, request.origin);
  let granted = false, sending = false;
  const grant = () => {
    granted = true; if (allow) allow.disabled = true;
    try { send({ type: 'sp.recovery-summary', summary }); status.textContent = t('摘要已发送，请回新站选择存档，并保持此窗口打开。'); }
    catch { granted = false; if (allow) allow.disabled = false; status.textContent = t('来源窗口不可用，请回到新站重新打开。'); }
  };
  window.addEventListener('message', async event => {
    if (!granted || sending || event.source !== window.opener || event.origin !== request.origin || event.data?.nonce !== request.nonce || event.data?.type !== 'sp.recovery-export') return;
    sending = true;
    try { send({ type: 'sp.recovery-data', code: await encodePersonalData(await capturePersonalData()) }); status.textContent = t('数据已发送，请回到新站核对并确认恢复。'); }
    catch { sending = false; send({ type: 'sp.recovery-error' }); status.textContent = t('无法读取个人数据，请核对恢复码是否完整，或重试导出。'); }
  });
  if (allow) allow.onclick = grant;
  if (auto && discoveryAllowed) grant();
  else if (auto) {
    status.textContent = t('自动读取仅允许已配置的正式站与启用旧站，请检查域名配置。');
    window.opener.postMessage({ type: 'sp.recovery-error', nonce: request.nonce }, request.origin);
  }
} else if (!request) add('p', t('请从新站的“找回数据”打开此页，以授权读取旧站存档。'));
else add('p', t('来源窗口不可用，请回到新站重新打开。'), 'personal-data-error');
