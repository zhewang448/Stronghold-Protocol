import { createStore, loadPref } from '../store.js';

export const cardArtStore = createStore({ values: loadPref('room.cardArt', {}) || {},
  scope: null, sync: 'idle', supported: false, retry: 0 });

export function setCardArtScope(scope) {
  const previous = cardArtStore.get().scope;
  if (JSON.stringify(previous) !== JSON.stringify(scope)) cardArtStore.set({ scope });
}

export function retryCardArtSync() {
  cardArtStore.set({ retry: cardArtStore.get().retry + 1 });
}
