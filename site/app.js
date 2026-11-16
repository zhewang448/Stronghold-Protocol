import { t } from './runtime/i18n.js';

const directoryButton = document.querySelector('.directory-toggle');
const directory = document.querySelector('.sidebar');
const mobile = matchMedia('(max-width: 800px)');

function updateDirectory() {
  directoryButton.hidden = !mobile.matches;
  directory.hidden = mobile.matches && directoryButton.getAttribute('aria-expanded') !== 'true';
}
directoryButton.addEventListener('click', () => {
  directoryButton.setAttribute('aria-expanded', String(directoryButton.getAttribute('aria-expanded') !== 'true'));
  updateDirectory();
});
directory.addEventListener('click', event => {
  if (!event.target.closest('a') || !mobile.matches) return;
  directoryButton.setAttribute('aria-expanded', 'false');
  updateDirectory();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobile.matches && directoryButton.getAttribute('aria-expanded') === 'true') {
    directoryButton.setAttribute('aria-expanded', 'false');
    updateDirectory();
    directoryButton.focus();
  }
});
mobile.addEventListener('change', updateDirectory);
updateDirectory();

const filters = document.querySelector('.filters');
const status = document.querySelector('.filter-status');
const rows = [...document.querySelectorAll('.summary-section tbody tr')];
filters.hidden = false;
status.hidden = false;
function applyFilter(value) {
  if (!['all', 'player', 'host'].includes(value)) value = 'all';
  for (const button of filters.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.filter === value));
  for (const row of rows) row.hidden = value !== 'all' && !row.dataset.audience.split(' ').includes(value);
  const visible = rows.filter(row => !row.hidden).length;
  status.textContent = t('显示 {n} 项改进', { n: visible });
  const url = new URL(location.href);
  if (value === 'all') url.searchParams.delete('audience');
  else url.searchParams.set('audience', value);
  history.replaceState(null, '', url);
}
filters.addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (button) applyFilter(button.dataset.filter);
});
applyFilter(new URL(location.href).searchParams.get('audience') || 'all');

const dialog = document.querySelector('.lightbox');
const dialogImage = dialog.querySelector('img');
const caption = dialog.querySelector('#lightbox-caption');
const original = dialog.querySelector('.lightbox-original');
let priorFocus = null;
if (typeof dialog.showModal === 'function') {
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-zoom]');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    priorFocus = link;
    caption.textContent = link.dataset.caption;
    dialogImage.src = link.href;
    dialogImage.alt = link.querySelector('img')?.alt || link.dataset.caption;
    original.href = link.href;
    dialog.showModal();
    document.body.classList.add('has-lightbox');
    dialog.querySelector('[data-close]').focus();
  });
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('has-lightbox');
    dialogImage.removeAttribute('src');
    priorFocus?.focus({ preventScroll: true });
  });
}

const chapterLinks = [...document.querySelectorAll('.sidebar a[href]')];
if ('IntersectionObserver' in window) {
  const visible = new Map();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
    const current = [...document.querySelectorAll('[data-chapter]')].find(chapter => visible.get(chapter.id));
    for (const link of chapterLinks) {
      if (current && link.hash === '#' + current.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }, { rootMargin: '-100px 0px -50% 0px', threshold: 0 });
  document.querySelectorAll('[data-chapter]').forEach(chapter => observer.observe(chapter));
}
