import { html, Button } from './components.js';
import { t } from '../../../shared/i18n.js';
import { createReleaseDialog, releaseButton } from './releaseNotes.js';

/** Manual history never reads or acknowledges automatic release-notice preferences. */
export function showReleaseHistory() {
  const existing = document.querySelector('dialog[data-release-history]');
  if (existing) { existing.querySelector('button')?.focus(); return existing; }
  const { dialog, body, actions } = createReleaseDialog(t('更新内容'));
  dialog.dataset.releaseHistory = 'true';
  // Keep an underlying declarative settings modal from consuming this dialog's keys/focus.
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
  });
  dialog.addEventListener('focusin', event => event.stopPropagation());
  const sources = document.createElement('nav');
  sources.className = 'release-history__sources';
  sources.setAttribute('aria-label', t('更新来源'));
  dialog.querySelector('header').append(sources);
  const close = releaseButton(t('关闭'), true);
  close.onclick = () => dialog.close();
  actions.append(close);
  const controller = new AbortController();
  dialog.addEventListener('close', () => { controller.abort(); dialog.remove(); }, { once: true });
  const sourceButtons = new Map();
  const render = (history, source) => {
    for (const [id, button] of sourceButtons) button.setAttribute('aria-pressed', String(id === source));
    body.replaceChildren(); body.scrollTop = 0;
    const language = document.createElement('p');
    language.className = 'release-notes__language'; language.textContent = t('仅提供中文'); body.append(language);
    const releases = Array.isArray(history[source]) ? history[source] : [];
    if (!releases.length) { body.append(document.createTextNode(t('暂无更新记录'))); return; }
    releases.forEach((release, index) => {
      const details = document.createElement('details'); details.className = 'release-history__release'; details.open = index === 0;
      const summary = document.createElement('summary'); summary.textContent = release.title || release.version;
      const list = document.createElement('ul'); list.className = 'release-notes__list';
      for (const entry of release.entries || []) { const li = document.createElement('li'); li.textContent = entry; list.append(li); }
      details.append(summary, list); body.append(details);
    });
  };
  const load = async () => {
    body.textContent = t('正在载入更新内容…'); body.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/release-history.json', { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      const history = await response.json();
      if (!Array.isArray(history.upstream) || !Array.isArray(history.extension)) throw new Error('Invalid release history');
      if (controller.signal.aborted) return;
      for (const [id, label] of [['upstream', t('上游更新内容')], ['extension', t('扩展更新内容')]]) {
        const button = releaseButton(label); button.dataset.releaseHistorySource = id;
        button.onclick = () => render(history, id); sourceButtons.set(id, button); sources.append(button);
      }
      render(history, 'upstream');
    } catch {
      if (controller.signal.aborted) return;
      body.textContent = t('更新内容载入失败，请重试');
      const retry = releaseButton(t('重试')); retry.onclick = load; body.append(retry);
    } finally { body.removeAttribute('aria-busy'); }
  };
  document.body.append(dialog); dialog.showModal(); close.focus(); void load();
  return dialog;
}

export function ReleaseHistoryButton({ class: cls = '', variant = 'ghost', square = false } = {}) {
  return html`<${Button} class=${cls} variant=${variant} size="sm" icon="book" square=${square} data-testid="release-history-button" title=${t('更新内容')} aria-label=${t('更新内容')} onClick=${showReleaseHistory}>${square ? null : t('更新内容')}<//>`;
}
