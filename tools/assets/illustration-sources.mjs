import { createHash } from 'node:crypto';

export const EXTENSION_ILLUSTRATIONS = Object.freeze({ char_4247_oxi: '塔露拉', char_4246_dminon: '国度', char_4244_tocka: '冻河' });
export function prtsIllustrationUrl(title) {
  const name = title.replaceAll(' ', '_');
  const hash = createHash('md5').update(name).digest('hex');
  return `https://media.prts.wiki/${hash[0]}/${hash.slice(0, 2)}/${encodeURIComponent(name)}`;
}
