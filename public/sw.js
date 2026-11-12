// Unified classic worker: imported upstream packs and the extension resource manager share one scope.
// Cache helpers mirror resources/common.js, resources/service.js and shared/assetPaths.js.
// Keep these three lines in sync with public/js/assetCache.js (that module documents why this file is not a module).
const IMPORTED_ASSET_CACHE = 'sp-imported-assets-v1';
const IMPORTED_ASSET_CACHE_PREFIX = 'sp-imported-assets-';
const IMPORTED_ASSET_PATH = /^\/(?:assets|fonts|media)\/~[0-9a-f]{16}\//;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(IMPORTED_ASSET_CACHE_PREFIX) && name !== IMPORTED_ASSET_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  // A cache-only probe (resourceCheck.js) must reach the browser HTTP cache. respondWith, even with 504, hides
  // that cache. Leaving the event unanswered lets a hit return and a miss reject, with no network. Cache Storage
  // is already decided by the page's caches.match before this probe.
  if (request.cache === 'only-if-cached') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (!isResourcePath(url.pathname)) return;
  event.respondWith((async () => {
    const resource = await handleResourceRequest(request);
    if (resource) return resource;
    if (!IMPORTED_ASSET_PATH.test(url.pathname) || request.headers.has('range')) return fetch(request);
    const cache = await caches.open(IMPORTED_ASSET_CACHE);
    // The exact key: an import stores each URL without a query, so the path is the key. `ignoreSearch` would make
    // Chrome scan every entry — about 4 s per request once a whole pack (some 43,000 entries) is imported.
    const hit = await cache.match(url.origin + url.pathname);
    if (hit) return hit;
    // Do not cache the network response. The browser's own HTTP cache still applies to this fetch.
    return fetch(request);
  })());
});

const CACHE_PREFIX = 'stronghold-resources-v1-';
const CACHE_NAME = CACHE_PREFIX + 'all';
const HASH_SEGMENT_RE = /^~([0-9a-f]{16})$/;

/** URL roots whose first segment may be a content hash. */
const HASHED_ROOTS = Object.freeze(['/assets/', '/fonts/', '/media/']);

/**
 * Split the content-hash segment off a URL path.
 * '/assets/~0123456789abcdef/x.png' → { hash: '0123456789abcdef', path: '/assets/x.png' }; any other path (no segment,
 * a malformed one, another root) → { hash: null, path } unchanged.
 * @param {string} path a URL path (no query)
 * @returns {{ hash: string | null, path: string }}
 */
function splitHashedPath(path) {
  const p = String(path ?? '');
  for (const root of HASHED_ROOTS) {
    if (!p.startsWith(root)) continue;
    const slash = p.indexOf('/', root.length);
    if (slash < 0) break;
    const m = HASH_SEGMENT_RE.exec(p.slice(root.length, slash));
    return m ? { hash: m[1], path: root + p.slice(slash + 1) } : { hash: null, path: p };
  }
  return { hash: null, path: p };
}


function canonicalResourceUrl(url) {
  const value = String(url);
  if (!value.startsWith('/') && !/^https?:\/\//i.test(value)) return value.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
  try {
    const parsed = new globalThis.URL(value, 'https://resources.invalid');
    parsed.pathname = parsed.pathname.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
    return value.startsWith('/') && !value.startsWith('//') ? parsed.pathname + parsed.search + parsed.hash : parsed.href;
  } catch { return value; }
}

const MEDIA_PREFIX = '/media/';
const AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav'];
function mediaCandidates(pathname) {
  const p = String(pathname || '');
  if (!p.startsWith(MEDIA_PREFIX)) return [];
  const rest = p.slice(MEDIA_PREFIX.length);
  if (!rest || rest.endsWith('/')) return [];
  const segments = rest.split('/').filter((s) => s.length > 0);
  if (!segments.length || segments.some((s) => s === '.' || s === '..' || s.startsWith('.') || s.endsWith('.'))) return [];
  const last = segments[segments.length - 1];
  const given = AUDIO_EXTS.find((e) => last.toLowerCase().endsWith(e)) || '';
  const stem = given ? last.slice(0, -given.length) : last;
  if (!stem) return [];
  const name = [...segments.slice(0, -1), stem].join('/');
  const order = given ? [given, ...AUDIO_EXTS.filter((e) => e !== given)] : AUDIO_EXTS;
  return order.map((ext) => `/assets/audio/${name}${ext}`);
}


function absoluteUrl(url, origin = globalThis.location?.origin || 'http://localhost') {
  try { return new URL(canonicalResourceUrl(url), origin).href; } catch { return null; }
}


async function rangeResponse(response, range) {
  const data = await response.arrayBuffer();
  const length = data.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(range || '').trim());
  let start;
  let end;
  if (m && (m[1] || m[2])) {
    start = m[1] ? Number(m[1]) : Math.max(0, length - Number(m[2]));
    end = m[1] && m[2] ? Math.min(length - 1, Number(m[2])) : length - 1;
  }
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= length) {
    headers.set('Content-Range', `bytes */${length}`);
    return new Response(null, { status: 416, statusText: 'Range Not Satisfiable', headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${length}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(data.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
}

function isResourcePath(pathname) { return /^\/(?:assets|fonts|media)\//.test(pathname); }
async function handleResourceRequest(request, { caches = globalThis.caches } = {}) {
  if (!caches || !request || request.method !== 'GET') return null;
  let url;
  try { url = new URL(request.url); } catch { return null; }
  if (!isResourcePath(url.pathname)) return null;
  const hit = await matchResource(url, caches);
  if (!hit) return null;
  const range = request.headers.get('Range');
  if (!range) return hit;
  try {
    return await rangeResponse(hit, range);
  } catch {
    return hit; // a range we cannot slice falls back to the whole file (a 200 is valid for any request)
  }
}

/**
 * The cache keys a request may be answered from. Usually just its own URL — but the game fetches audio through the
 * extension-less `/media/bgm/act1` route (shared/media.js, `server/index.js serveMedia`), and the preload stores the
 * canonical `/assets/audio/….mp3` the manifest lists, so such a request also looks for those. A `/assets/~<hash>/x.png`
 * request (the content-hash segment assetViews.js puts into the served manifests) also looks for the plain
 * `/assets/x.png`: the preload index stores whatever `/data/resource-manifest.json` listed, and both shapes name the
 * same bytes (shared/assetPaths.js).
 * @param {URL} url
 * @returns {string[]}
 */
function cacheKeys(url) {
  const plainPath = splitHashedPath(url.pathname).path;
  const candidates = mediaCandidates(plainPath);
  if (!candidates.length) {
    const key = absoluteUrl(url.href);
    const legacy = key.replace(/%5B/gi, '[').replace(/%5D/gi, ']');
    const keys = key === legacy ? [key] : [key, legacy];
    const plain = splitHashedPath(url.pathname).path;
    if (plain !== url.pathname) {
      const bare = new URL(url.href);
      bare.pathname = plain;
      const bareKey = absoluteUrl(bare.href);
      if (bareKey && !keys.includes(bareKey)) keys.push(bareKey);
    }
    return keys;
  }
  const keys = [];
  for (const path of candidates) {
    try {
      const hash = splitHashedPath(url.pathname).hash;
      if (hash) keys.push(new URL(path.replace('/assets/', `/assets/~${hash}/`), url).href);
      keys.push(new URL(path, url).href);
    } catch { /* one impossible candidate less */ }
  }
  return keys.length ? keys : [url.href];
}

/**
 * First cache entry for a request across every cache this app owns: the current cache first, then the caches of earlier
 * builds (the pre-hash layout). Those are still answered while an update migrates them into `CACHE_NAME` — and the
 * order matters, because a stale entry left in an older cache must never shadow the fresh file of the current one.
 */
async function matchResource(url, caches) {
  const keys = cacheKeys(url);
  const names = (await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX));
  names.sort((a, b) => (a === CACHE_NAME ? -1 : b === CACHE_NAME ? 1 : 0));
  for (const name of names) {
    const cache = await caches.open(name);
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      const res = await cache.match(key);
      const requestedHash = splitHashedPath(url.pathname).hash;
      if (res && res.headers.get('X-SP-Resource') === '1' && (!requestedHash || requestedHash === res.headers.get('X-SP-AssetHash'))) return res;
    }
  }
  return null;
}
