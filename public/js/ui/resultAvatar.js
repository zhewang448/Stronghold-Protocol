// Adapted from xinhai-ai f988c680 / fe60c100 using this branch's existing card/cardSkin fields.
import { html } from './components.js';
import { PlayerAvatar, Img } from './gameComponents.js';
import { useStore, loadPref } from '../store.js';
import { data, useData } from '../data.js';
import { CARD_PREF, CARD_SKIN_PREF, cardAvatarUrl, chosenPortrait } from './seatArt.js';
import { LiveArt } from './dynamicIllustration.js';
function useCard(player, self) {
  const seat = useStore((s) => s.room?.seats?.find((row) => row?.playerId === player?.playerId) || null);
  if (player?.isBot) return {};
  return { charId: player?.card || (self ? loadPref(CARD_PREF, '') : seat?.card), skinId: player?.cardSkin || (self ? loadPref(CARD_SKIN_PREF, '') : seat?.cardSkin) };
}
export function ResultAvatar({ player, self = false, ...props }) {
  const card = useCard(player, self);
  return html`<${PlayerAvatar} ...${props} player=${player} self=${self} charId=${card.charId} skin=${card.skinId} avatar=${cardAvatarUrl(card.charId, card.skinId, data.get('assets'))} />`;
}
export function ResultPortrait({ player, self = false, fallbackSrc = null, fallbackClass = '', fallback = null, class: cls = '' }) {
  useData('seat-art');
  const card = useCard(player, self);
  const src = chosenPortrait(card.charId, card.skinId, data.get('assets'), data.get('seat-art'), data.list('chess'));
  return html`<${Img} src=${src || fallbackSrc} class=${(cls + ' ' + (src ? 'is-portrait' : fallbackClass)).trim()} fallback=${fallback} />
    ${src ? html`<${LiveArt} m=${data.get('assets')} charId=${card.charId} skin=${card.skinId} />` : null}`;
}
