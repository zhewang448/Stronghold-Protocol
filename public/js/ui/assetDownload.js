// Compatibility host for the resource manager's single download action. Closing pauses its HTTP-cache queue.
// A file already imported counts as ready here and is not requested again.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, ProgressBar } from './components.js';
import { createStore, useStore } from '../store.js';
import { assetDownload } from '../assetDownload.js';
import { t } from '../../../shared/i18n.js';

const downloadUi = createStore({ open: false });
// Only the resource manager's primary action reaches this compatibility host.
export function openAssetDownload() {
  downloadUi.set({ open: true });
  if (assetDownload.get().phase !== 'complete') void assetDownload.start();
}

export function AssetDownloadHost() {
  const { open } = useStore((s) => s, Object.is, downloadUi);
  const [state, setState] = useState(() => assetDownload.get());
  useEffect(() => assetDownload.subscribe(setState), []);
  const busy = ['preparing', 'downloading'].includes(state.phase);
  const close = () => {
    assetDownload.pause();
    downloadUi.set({ open: false });
  };
  const status = state.phase === 'complete' ? t('本次素材下载完成')
    : state.phase === 'preparing' ? t('正在读取素材清单…')
      : state.phase === 'paused' ? t('素材下载已暂停')
        : state.phase === 'error' ? t('无法读取素材清单，请检查网络后重试。')
          : state.phase === 'partial' ? t('有 {n} 个素材下载失败', { n: state.failures.length })
            : t('正在下载素材…');
  const ready = state.cached || 0;
  const missing = Math.max(0, (state.total || 0) - ready);
  return html`<${Modal} open=${open} onClose=${close} title=${t('下载完整素材')} class="asset-download" actions=${html`
      ${busy ? html`<${Button} onClick=${() => assetDownload.pause()}>${t('暂停下载')}<//>`
        : html`<${Button} variant="primary" data-testid="asset-download-resume" onClick=${() => void assetDownload.start()}>
          ${state.phase === 'complete' ? t('重新检查') : state.phase === 'paused' ? t('继续下载素材') : t('重试下载')}<//>`}
      <${Button} onClick=${close}>${t('关闭')}<//>`}>
      <p role="status" data-testid="asset-download-status">${status}</p>
      <${ProgressBar} value=${state.done} max=${state.total || 1} label=${t('已完成 {done} / {total} 个文件', { done: state.done, total: state.total })} />
      <p>${t('已读取 {size} MB（含浏览器缓存）', { size: (state.bytes / 1048576).toFixed(1) })}</p>
      ${state.total > 0 ? html`<p>${t('已就绪 {ready}，缺少 {missing}', { ready, missing })}</p>` : null}
      <p class="t-lo">${t('已导入的素材直接使用，不再向服务器请求。')}</p>
      <p class="t-lo">${t('下载本服务器提供的素材到浏览器缓存。关闭窗口会暂停；缓存被清理后可再次下载。')}</p>
      ${state.localMissing ? html`<p class="t-lo">${t('服务器未提供额外的本地素材包，将使用基础素材。')}</p>` : null}
      ${state.failures.length ? html`<div class="asset-download__errors">
        <p>${t('下载未完成。请重试；若文件持续缺失，请联系服主补齐素材。')}</p>
        <details><summary>${t('查看失败文件')}</summary><ul>
          ${state.failures.slice(0, 30).map((item) => html`<li key=${item.url}><code>${item.url}</code> (${item.status})</li>`)}
        </ul></details>
      </div>` : null}
  <//>`;
}
