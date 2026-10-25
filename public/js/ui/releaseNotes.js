import { t } from '../../../shared/i18n.js';

// Shared by the game and the standalone host console, which does not load theme.css.
// Mount scoped styles synchronously so the native dialog never paints in its light default.
export function createReleaseDialog(title, label = title) {
  if (!document.getElementById('release-dialog-styles')) {
    const style = document.createElement('style');
    style.id = 'release-dialog-styles';
    style.textContent = `
      .release-notes {
        --release-accent: var(--mint-500, #4ed8af);
        --release-line: var(--line-2, #3e4b45);
        --release-space: clamp(8px, .2rem, 20px);
        --release-edge: max(8px, .3rem);
        box-sizing: border-box; color-scheme: dark;
        width: min(720px, calc(100vw - var(--sa-l, 0px) - var(--sa-r, 0px) - 2 * var(--release-edge))); max-width: none;
        max-height: calc(100vh - var(--sa-t, 0px) - var(--sa-b, 0px) - 2 * var(--release-edge));
        max-height: calc(100dvh - var(--sa-t, 0px) - var(--sa-b, 0px) - 2 * var(--release-edge)); padding: 0;
        margin: auto; inset: var(--sa-t, 0px) var(--sa-r, 0px) var(--sa-b, 0px) var(--sa-l, 0px);
        overflow: hidden; background: var(--bg-1, #141816);
        color: var(--text-hi, #f2f2f2); border: 1px solid var(--release-line);
        border-radius: 0; box-shadow: 0 24px 64px #000a;
        font: max(calc(.16 * var(--t, 100px)), 13px)/1.75 var(--font-cjk, system-ui, "Microsoft YaHei", sans-serif);
        user-select: text; -webkit-user-select: text;
      }
      .release-notes[open] { display: flex; flex-direction: column; }
      .release-notes--game { width: min(10.8rem, calc(100vw - var(--sa-l, 0px) - var(--sa-r, 0px) - 2 * var(--release-edge))); }
      .release-notes--dual { width: min(1120px, calc(100vw - var(--sa-l, 0px) - var(--sa-r, 0px) - 2 * var(--release-edge))); }
      .release-notes__columns { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--release-space); }
      .release-notes--dual .release-notes__columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .release-notes__column { min-width: 0; }
      .release-notes__column + .release-notes__column { border-left: 1px solid var(--release-line); padding-left: var(--release-space); }
      .release-notes__source { margin: 0 0 .5em; font-size: 1.125em; line-height: 1.5; color: var(--text-hi, #f2f2f2); }
      .release-notes__version { margin: 0 0 1em !important; color: var(--text-lo, #a3afa9); font-size: .9em; }
      @media (max-width: 700px), (max-height: 480px) {
        .release-notes--dual .release-notes__columns { grid-template-columns: minmax(0, 1fr); }
        .release-notes__column + .release-notes__column { border-left: 0; border-top: 1px solid var(--release-line); padding: var(--release-space) 0 0; }
      }
      .release-notes::backdrop { background: rgba(3, 5, 4, .78); }
      .release-notes__head { display: block; flex: none; min-width: 0; padding: var(--release-space); border-bottom: 1px solid var(--release-line); }
      .release-notes__head::before {
        content: ''; display: block; height: 4px; margin: calc(-1 * var(--release-space)) calc(-1 * var(--release-space)) var(--release-space);
        background: repeating-linear-gradient(-45deg, var(--release-accent) 0 6px, transparent 6px 13px);
        opacity: .55;
      }
      .release-notes__title { margin: 0; color: var(--text-hi, #f2f2f2); font-size: max(calc(.26 * var(--t, 80px)), 16px); line-height: 1.4; font-weight: 700; overflow-wrap: anywhere; }
      .release-notes__body {
        flex: 1 1 auto; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;
        touch-action: pan-y; -webkit-overflow-scrolling: touch; padding: var(--release-space);
        color: var(--text-md, #c3cbc7); overflow-wrap: anywhere;
        scrollbar-width: thin; scrollbar-color: var(--release-line) var(--bg-1, #141816);
      }
      .release-notes__body::-webkit-scrollbar { width: 6px; }
      .release-notes__body::-webkit-scrollbar-thumb { background: var(--release-line); }
      .release-notes__body::-webkit-scrollbar-thumb:hover { background: var(--release-accent); }
      .release-notes__body p { margin: 0; }
      .release-notes__language { margin-bottom: .8em !important; color: var(--text-lo, #a3afa9); font-size: .9em; }
      .release-notes__list { margin: 0; padding-left: 1.5em; }
      .release-notes__list li + li { margin-top: .6em; }
      .release-notes__list li::marker { color: var(--release-accent); }
      .release-history__sources { display: flex; flex-wrap: wrap; gap: 8px; margin-top: var(--release-space); }
      .release-history__sources .release-notes__button { flex: 1 1 0; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
      .release-history__sources [aria-pressed="true"] { border-color: var(--release-accent); color: var(--release-accent); }
      .release-history__release { border-top: 1px solid var(--release-line); padding: var(--release-space) 0; }
      .release-history__release:first-of-type { border-top: 0; }
      .release-history__release summary { cursor: pointer; min-height: 32px; align-content: center; touch-action: manipulation; color: var(--text-hi, #f2f2f2); font-weight: 600; }
      .release-history__release summary::marker { color: var(--release-accent); }
      .release-history__release summary:focus-visible { outline: 2px solid var(--release-accent); outline-offset: 3px; }
      .release-history__release .release-notes__list { margin-top: .7em; }
      .release-notes__actions {
        display: flex; flex: none; flex-wrap: wrap; justify-content: flex-end; gap: 12px;
        padding: var(--release-space); border-top: 1px solid var(--release-line); background: var(--bg-0, #0c0f0e);
      }
      .release-notes__button {
        box-sizing: border-box; min-height: 36px; padding: .4em 1em; font: inherit; line-height: 1.4; touch-action: manipulation;
        color: var(--text-hi, #f2f2f2); background: var(--bg-2, #1e2421);
        border: 1px solid var(--release-line); border-radius: 0; cursor: pointer;
      }
      .release-notes__button:hover { border-color: var(--release-accent); }
      .release-notes__button--primary { background: var(--release-accent); color: var(--text-on-mint, #06110d); border-color: var(--release-accent); font-weight: 600; }
      .release-notes__button--primary:hover { background: var(--mint-400, #59f4ca); }
      .release-notes__button:focus-visible { outline: 2px solid var(--release-accent); outline-offset: 3px; }
      .release-notes__button:active { transform: translateY(1px); }
      .release-notes ::selection { color: var(--text-on-mint, #06110d); background: var(--release-accent); }
      @media (pointer: coarse) {
        .release-notes__button, .release-history__release summary { min-height: 44px; }
      }
      @media (max-height: 480px) {
        .release-notes { --release-space: 8px; --release-edge: 8px; }
        .release-notes__head::before { margin-bottom: 6px; }
        .release-history__sources { margin-top: 6px; }
        .release-notes__actions { padding-block: 6px; }
      }
    `;
    document.head.append(style);
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'release-notes';
  if (getComputedStyle(document.documentElement).getPropertyValue('--t').trim()) dialog.classList.add('release-notes--game');
  dialog.setAttribute('aria-label', label);
  const header = document.createElement('header'); header.className = 'release-notes__head';
  const heading = document.createElement('h2'); heading.className = 'release-notes__title'; heading.textContent = title;
  header.append(heading);
  const body = document.createElement('div'); body.className = 'release-notes__body';
  const actions = document.createElement('div'); actions.className = 'release-notes__actions';
  dialog.append(header, body, actions);
  return { dialog, body, actions };
}

export function releaseButton(label, primary = false) {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = label;
  button.className = `release-notes__button${primary ? ' release-notes__button--primary' : ''}`;
  return button;
}

/** The host's update notice uses the same theme as release notes; Esc means later. */
export function showReleaseUpdatePrompt({ title, message, confirmLabel, cancelLabel }) {
  const { dialog, body, actions } = createReleaseDialog(title);
  const text = document.createElement('p'); text.textContent = message; body.append(text);
  const cancel = releaseButton(cancelLabel), confirm = releaseButton(confirmLabel, true);
  cancel.onclick = () => dialog.close();
  confirm.onclick = () => dialog.close('confirm');
  actions.append(cancel, confirm);
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => { const confirmed = dialog.returnValue === 'confirm'; dialog.remove(); resolve(confirmed); }, { once: true });
    document.body.append(dialog); dialog.showModal(); cancel.focus();
  });
}

/** First installs only establish a baseline. A changed version is acknowledged on close. */
export function shouldShowReleaseNotes(previous, current) {
  return !!previous && !!current && previous !== current;
}

/**
 * @param {any} notes
 * @param {{ storage?: Pick<Storage, 'getItem'|'setItem'>, storageKey?: string, upstream?: any,
 *   preferences?: { upstreamReleaseNotes?: boolean, extensionReleaseNotes?: boolean }, chineseOnly?: boolean }} [options]
 */
export function showReleaseNotes(notes, { storage = globalThis.localStorage, storageKey = 'sp.release-notes', upstream = null, preferences = {}, chineseOnly = false } = {}) {
  const save = (key, version) => { try { storage.setItem(key, version); } catch { /* optional storage */ } };
  const sources = [
    { id: 'upstream', notes: upstream, key: `${storageKey}.upstream`, enabled: preferences.upstreamReleaseNotes !== false, changed: false },
    { id: 'extension', notes, key: storageKey, enabled: preferences.extensionReleaseNotes !== false, changed: false },
  ].filter((source) => source.notes?.version);
  let legacy;
  try { legacy = storage.getItem(storageKey); } catch { return null; }
  for (const source of sources) {
    let previous;
    try { previous = storage.getItem(source.key); } catch { return null; }
    // Existing installs already know the upstream part of their last extension tag.
    if (!previous && source.id === 'upstream') {
      previous = /^v?(\d+\.\d+\.\d+)-extended\./.exec(legacy || '')?.[1] || null;
      if (previous) save(source.key, previous);
    }
    source.changed = source.enabled && shouldShowReleaseNotes(previous, source.notes.version) && Array.isArray(source.notes.entries) && source.notes.entries.length > 0;
    if (!previous || previous === source.notes.version || !source.notes.entries?.length) save(source.key, source.notes.version);
  }
  if (!sources.some((source) => source.changed)) return null;
  if (document.querySelector('dialog.release-notes[data-release-notes]')) return null;
  const visible = sources.filter((source) => source.changed);
  const { dialog, body, actions } = createReleaseDialog(t('更新记录'));
  dialog.dataset.releaseNotes = 'true';
  if (visible.length > 1) dialog.classList.add('release-notes--dual');
  if (chineseOnly) { const p = document.createElement('p'); p.className = 'release-notes__language'; p.textContent = t('仅提供中文'); body.append(p); }
  const columns = document.createElement('div'); columns.className = 'release-notes__columns';
  for (const source of visible) {
    const section = document.createElement('section'); section.className = 'release-notes__column'; section.dataset.releaseSource = source.id;
    const title = document.createElement('h3'); title.className = 'release-notes__source';
    title.textContent = source.id === 'upstream' ? t('上游更新内容') : t('扩展更新内容');
    const version = document.createElement('p'); version.className = 'release-notes__version'; version.textContent = source.notes.title || source.notes.version;
    const list = document.createElement('ul'); list.className = 'release-notes__list';
    for (const entry of source.notes.entries) { const li = document.createElement('li'); li.textContent = entry; list.append(li); }
    section.append(title, version, list); columns.append(section);
  }
  const close = releaseButton(t('关闭'), true);
  close.onclick = () => dialog.close();
  body.append(columns); actions.append(close); document.body.append(dialog);
  dialog.addEventListener('close', () => { for (const source of visible) save(source.key, source.notes.version); dialog.remove(); }, { once: true });
  dialog.showModal(); close.focus();
  return dialog;
}
