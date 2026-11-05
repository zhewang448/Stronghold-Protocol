// Crops use Spine's y-up coordinates. The same crop underlies the still and live image.
export function rectLayout(w, h, rect, posX = 50, posY = 50, zoom = 1) {
  const scale = Math.max(w / rect.width, h / rect.height) * zoom;
  return { scale, x: (w - rect.width * scale) * posX / 100 - rect.x * scale,
    y: (h - rect.height * scale) * posY / 100 + (rect.y + rect.height) * scale };
}

export function framingLayout(w, h, bounds, frame = {}) {
  if (frame.fit === 'contain') {
    const scale = Math.min(w / bounds.width, h / bounds.height) * 0.94;
    return { scale, x: w / 2 - (bounds.x + bounds.width / 2) * scale,
      y: h / 2 + (bounds.y + bounds.height / 2) * scale };
  }
  const l = rectLayout(w, h, frame.rect || bounds, frame.posX ?? 50, frame.posY ?? 50);
  const zoom = frame.zoom ?? 1;
  return { scale: l.scale * zoom, x: w / 2 + (l.x - w / 2) * zoom + w * (frame.ox || 0) / 100,
    y: h / 2 + (l.y - h / 2) * zoom + h * (frame.oy || 0) / 100 };
}

export function dynamicOf(m, charId, skin = null, kind = 'portrait', elite = true, staticSrc = null) {
  const rec = m?.chars?.[charId];
  if (skin === `${charId}#1`) elite = false;
  else if (skin === `${charId}#2`) elite = true;
  // A missing skin must use its default art; never animate another appearance underneath it.
  const appearance = skin && rec?.skins?.[skin] ? rec.skins[skin] : rec;
  const d = kind === 'avatar' ? appearance?.dynamicAvatar || (elite && appearance?.dynamicE2) || appearance?.dynamic
    : (elite && appearance?.dynamicE2) || appearance?.dynamic;
  // A picture-only overlay must keep its own pixels. Installed crop provenance
  // prevents an inherited skeleton from covering a replacement portrait/avatar.
  const artKind = kind === 'illustration' ? 'illust' : kind;
  const field = elite && appearance?.[artKind + 'E2'] ? artKind + 'E2' : artKind;
  if (staticSrc && !skin && appearance?.[field]) {
    const logical = url => url.replace(/\/~[0-9a-f]{8,64}(?=\/)/g, '');
    if (logical(staticSrc) !== logical(appearance[field])) return null;
  }
  if (d?.staticArt?.[field] && appearance?.[field] !== d.staticArt[field]) return null;
  return d && typeof d.skel === 'string' && typeof d.atlas === 'string' ? d : null;
}

export const cropFraming = (entry, kind, posX = 50, posY = 0) => {
  const rect = entry?.frames?.[kind];
  return rect?.width > 0 && rect?.height > 0 ? { rect, posX, posY } : null;
};

/** Include all resources and the caller's appearance/content identity in the cache key. */
export const dynamicIdentity = (entry) => JSON.stringify([entry?.skel, entry?.atlas, entry?.textures,
  entry?.pma, entry?.background, entry?.foreground, entry?.identity, entry?.bounds, entry?.anims, entry?.extraTracks]);

export function pixelSize(w, h, dpr = 1, limit = 4096) {
  const density = Math.min(1.5, Math.max(0.5, dpr));
  const scale = Math.min(density, limit / Math.max(1, w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export function dynamicFps(fps = 0, coarse = false) {
  return fps > 0 ? Math.min(fps, coarse ? 24 : 30) : coarse ? 24 : 30;
}
