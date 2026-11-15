import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { audio } from '../audio.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';

/** One small action shared by the title's information row and the lobby's version block. */
export function EntryFilmButton({ version, class: cls = '' }) {
  const [busy, setBusy] = useState(false);
  const live = useRef(true), pending = useRef(false);
  useEffect(() => () => { live.current = false; }, []);
  const play = async event => {
    if (pending.current) return;
    const trigger = event.currentTarget;
    pending.current = true;
    setBusy(true);
    // Keep activation inside this gesture, before the lazy import or picture loading.
    audio._unlock();
    try { await (await import('./entryFilm.js')).playEntryFilm(version, { trigger }); }
    catch { toast(t('开场动画素材未就绪，请在「素材与资源」中下载或导入后重试。'), 'warn'); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };
  return html`<${Button} variant="ghost" size="sm" icon="play" class=${`entry-film-button ${cls}`}
    data-testid="entry-film-button" loading=${busy} onClick=${play}>${t('观看开场')}<//>`;
}
