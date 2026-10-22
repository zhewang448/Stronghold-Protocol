// Install prompts are browser-issued, one-use capabilities. This module does not register a service worker
// and does not offline the server. Imported art is served by public/sw.js (see assetCache.js).
export function createPwaInstall(win) {
  let prompt = null, installed = false, enabled = true;
  const listeners = new Set();
  const display = win?.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)');
  const isInstalled = () => installed || !!display?.matches || !!win?.navigator?.standalone;
  const visible = () => enabled && !isInstalled();
  const available = () => !!prompt && visible();
  const emit = () => { for (const fn of listeners) fn(available()); };
  const offer = (event) => {
    if (installed || display?.matches || win?.navigator?.standalone || typeof event.prompt !== 'function') return;
    event.preventDefault();
    prompt = event;
    emit();
  };
  const done = () => { installed = true; prompt = null; emit(); };
  win?.addEventListener?.('beforeinstallprompt', offer);
  win?.addEventListener?.('appinstalled', done);
  display?.addEventListener?.('change', emit);
  return {
    available,
    visible,
    setEnabled(value) {
      if (typeof value !== 'boolean' || value === enabled) return;
      enabled = value;
      emit();
    },
    installed: isInstalled,
    subscribe(fn) { listeners.add(fn); fn(available()); return () => listeners.delete(fn); },
    async request() {
      if (!available()) return false;
      const event = prompt;
      prompt = null; // Consume before awaiting: dismissal, rejection and repeated clicks cannot reuse this event.
      emit();
      try {
        const result = await event.prompt();
        const choice = event.userChoice ? await event.userChoice : result;
        return choice?.outcome === 'accepted';
      } catch { return false; }
    },
    dispose() {
      win?.removeEventListener?.('beforeinstallprompt', offer);
      win?.removeEventListener?.('appinstalled', done);
      display?.removeEventListener?.('change', emit);
      prompt = null; listeners.clear();
    },
  };
}
export const pwaInstall = createPwaInstall(globalThis.window);
