export const MAX_AVATAR_LENGTH = 32 * 1024;

export function isSharedAvatar(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > MAX_AVATAR_LENGTH) return false;
  const prefix = 'data:image/jpeg;base64,';
  if (!value.startsWith(prefix + '/9j/')) return false;
  const encoded = value.slice(prefix.length);
  return encoded.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded);
}
