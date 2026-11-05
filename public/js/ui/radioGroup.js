import { html } from './components.js';

/** Roving tab stop; changing focus also commits the selected option. */
export function RadioGroup({ label, value, options, onChange, class: cls = 'set-seg' }) {
  const available = options.filter(o => !o.disabled);
  const selected = available.some(o => o.value === value) ? value : available[0]?.value;
  const keydown = e => {
    if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key) || !available.length) return;
    e.preventDefault();
    const i = available.findIndex(o => String(o.value) === e.target.dataset.value);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? available.length - 1
      : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + available.length) % available.length;
    onChange(available[n].value);
    const buttons = e.currentTarget.querySelectorAll('[role="radio"]');
    [...buttons].find(b => b.dataset.value === String(available[n].value))?.focus();
  };
  return html`<div class=${cls} role="radiogroup" aria-label=${label} onKeyDown=${keydown}>
    ${options.map(o => html`<button type="button" key=${o.value} role="radio" data-value=${o.value}
      aria-checked=${String(o.value === selected)} tabindex=${o.value === selected ? 0 : -1} disabled=${o.disabled}
      class=${o.value === selected ? 'is-on' : ''} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}
