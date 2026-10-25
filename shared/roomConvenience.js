// Room-local convenience choices. Defaults are the maintainer's 2026-10-25 decision.
// They supplement a version's rules; a declared gameplay-plugin rule takes precedence.
export const CONVENIENCE_DEFAULTS = Object.freeze({ benchEquip: true, soloUnlimited: true, prepLoadout: true, unequip: false, morphPairing: false });
export const CONVENIENCE_KEYS = Object.freeze(Object.keys(CONVENIENCE_DEFAULTS));

export function roomConvenience(raw) {
  return Object.fromEntries(CONVENIENCE_KEYS.map(key => [key, typeof raw?.[key] === 'boolean' ? raw[key] : CONVENIENCE_DEFAULTS[key]]));
}

export function convenienceRules(raw, pluginRules = null) {
  const choices = roomConvenience(raw);
  return { prepLoadout: choices.prepLoadout ? 'prep' : 'locked', unequip: choices.unequip ? 'allow' : 'official', morphPairing: choices.morphPairing ? 'plus' : 'official', ...pluginRules };
}

const effectiveCache = new WeakMap();
export function effectiveRoomRules(room) {
  if (!room?.convenience) return room?.content?.rules ?? null;
  const prior = effectiveCache.get(room);
  if (prior?.choices === room.convenience && prior?.plugin === room.content?.rules) return prior.rules;
  const rules = convenienceRules(room.convenience, room.content?.rules);
  effectiveCache.set(room, { choices: room.convenience, plugin: room.content?.rules, rules });
  return rules;
}
