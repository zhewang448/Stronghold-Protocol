// Manual HTTP-cache warming; fetches same-origin static media only and never parses skeletons into memory.
const ASSET_PATH = /^\/(?:assets|fonts|vendor)\/[^\s?#]+$/;
export function preloadPlan(manifest, local = null, scope = 'visual') {
  const urls = new Set();
  const walk = (v) => {
    if (typeof v === 'string' && ASSET_PATH.test(v) && !v.includes('..') && !v.includes('\\')) {
      if (scope === 'all' || (!/\.(?:mp3|ogg|wav)$/i.test(v) && !v.startsWith('/assets/dynamic/'))) urls.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(manifest);
  // Extraction manifests already carry the served /assets/local/... URL.
  for (const group of Object.values(local?.groups || {})) {
    for (const file of Object.values(group || {})) if (typeof file?.path === 'string') walk(file.path);
  }
  for (const url of ['/vendor/pixi.min.js', '/vendor/pixi-spine.js', '/vendor/three.module.js']) urls.add(url);
  return [...urls].sort();
}
export async function runPreload(urls, { signal, fetchImpl = globalThis.fetch, onProgress = () => {}, concurrency = 4, timeoutMs = 30000 } = {}) {
  const state = { done: 0, total: urls.length, failed: 0 };
  let next = 0;
  onProgress({ ...state });
  await Promise.all(Array.from({ length: Math.max(1, Math.min(6, concurrency)) }, async () => {
    while (next < urls.length && !signal?.aborted) {
      const url = urls[next++];
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      try {
        const response = await fetchImpl(url, { cache: 'force-cache', credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // Drain without retaining a whole image/model/audio file in JavaScript memory.
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          try { while (!(await reader.read()).done) { /* drain */ } } finally { reader.releaseLock(); }
        } else await response.arrayBuffer();
      } catch {
        if (signal?.aborted) break;
        state.failed++;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
      state.done++;
      onProgress({ ...state });
    }
  }));
  return { ...state, cancelled: !!signal?.aborted };
}
