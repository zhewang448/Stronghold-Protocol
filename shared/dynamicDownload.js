// Static fallbacks live beside the animation. They remain mandatory even without dynamic art.
export function isOptionalDynamicArt(relative) {
  return relative.startsWith('public/assets/dynamic/')
    && !/\/(?:avatar|portrait|illust(?:-client)?)\.(?:png|webp|jpe?g)$/.test(relative);
}
