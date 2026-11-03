// public/js/ui/personalization.js — the server's 座位卡外观 switches (avatarFirst / customIllust) as the IN-MATCH
// screens read them.
//
// The switches are the server's (server/http/personalizationConfig.js ← local/personalization.json) and every
// room.state frame carries them as `personalization` (server/lobby.js Room.toState). The room screen reads them off the
// room state it already has (screens/room.js); the in-match screens have no room.state of their own, but the client keeps
// the last room state in the store for the whole match (screens/game.js reads `s.room` too), so they read it there.
//
// A client that has no room state at all — a reconnect straight into a running game — reads both off, which is exactly
// the rendering of the version before these switches existed. Nothing here throws or fetches.
//
// i18n-ignore-file: identifiers and comments only, no player-facing text (tools/i18n.mjs)

import { useStore, store } from '../store.js';

/** Both switches off (the rendering before 2026-10-18). */
export const PERSONALIZATION_OFF = Object.freeze({ avatarFirst: false, customIllust: false });

/**
 * The switches out of a room.state payload (`personalization`), defaults when it is missing.
 * @param {any} [room] room.state (defaults to the one the store holds — the room the client is in, or was in)
 * @returns {{ avatarFirst: boolean, customIllust: boolean }}
 */
export function personalizationOf(room = store.get().room) {
  const p = room?.personalization;
  return { avatarFirst: p?.avatarFirst === true, customIllust: p?.customIllust === true };
}

/**
 * Subscribe to the switches (a component re-renders when the room state's personalization changes, and not on every
 * unrelated store write). Returns the raw `personalization` object or null — use `personalization.avatarFirst === true`.
 * @returns {{ avatarFirst?: boolean, customIllust?: boolean }|null}
 */
export function usePersonalization() {
  return useStore(
    (s) => s.room?.personalization ?? null,
    (a, b) => (a?.avatarFirst === true) === (b?.avatarFirst === true)
      && (a?.customIllust === true) === (b?.customIllust === true),
  );
}
