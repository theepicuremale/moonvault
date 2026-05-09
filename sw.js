/*
 * sw.js — service worker for moonvault.
 *
 * Caching strategy (designed so site updates are NEVER stuck behind a stale
 * cache, while still giving instant repeat loads and offline support):
 *
 *  • App shell (HTML, JS, CSS, manifest.json):
 *      NETWORK-FIRST with cache fallback. Each request hits the network in
 *      a <2.5s budget; on success we update the cache and serve the fresh
 *      response. Only if the network fails (offline / really slow) do we
 *      serve the cached copy. So a `git push` always shows up on the next
 *      reload, even without bumping CACHE_VERSION.
 *
 *  • Music (*.mp3):
 *      Stale-while-revalidate in a separate MUSIC_CACHE. (Music never
 *      changes for a given filename, and is huge.)
 *
 *  • Gallery assets (assets/<albumId>/<photoId>.{jpg,png,webp,heic,heif,gif,
 *    mp4,mov,m4v,webm}):
 *      Cache-first in PHOTOS_CACHE. These have content-hashed file names
 *      (random IDs), so they're effectively immutable — once cached, never
 *      refetched, even when offline. New photos get new URLs and are
 *      simply fetched once.
 *
 *  • Cross-origin (Tenor GIFs, Google Fonts, ipapi, Google Forms, confetti
 *    CDN): pass through to the network.
 *
 * CACHE_VERSION only needs bumping if you change THIS strategy file in a
 * way that requires invalidating old caches.
 */

const CACHE_VERSION = 'v4';
const APPSHELL_CACHE = `moonvault-shell-${CACHE_VERSION}`;
const MUSIC_CACHE = `moonvault-music-${CACHE_VERSION}`;
const PHOTOS_CACHE = `moonvault-photos-${CACHE_VERSION}`;

// We pre-warm the shell cache on install so first offline visit works,
// but at runtime everything is network-first anyway.
const PRECACHE_URLS = [
    './',
    'index.html',
    'yes.html',
    'blocked.html',
    'ournetflix.html',
    'auth.js',
    'script.js',
    'yes-script.js',
    'gallery.js',
    'prefetch.js',
    'style.css',
    'gallery.css',
    'merged.gif',
    'photoswipe/photoswipe.css',
    'photoswipe/photoswipe-lightbox.esm.min.js',
    'photoswipe/photoswipe.esm.min.js'
];

const NETWORK_TIMEOUT_MS = 2500;

const MUSIC_URL_RE = /\.mp3(\?.*)?$/i;
const PHOTO_URL_RE = /\/assets\/[^/]+\/[^/]+\.(jpg|jpeg|png|webp|heic|heif|gif|mp4|mov|m4v|webm)(\?.*)?$/i;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APPSHELL_CACHE).then((cache) =>
            Promise.all(
                PRECACHE_URLS.map((url) =>
                    cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
                )
            )
        )
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((k) => k !== APPSHELL_CACHE && k !== MUSIC_CACHE && k !== PHOTOS_CACHE)
                    .map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

function timedFetch(req) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('sw-timeout')), NETWORK_TIMEOUT_MS);
        fetch(req).then(
            (r) => { clearTimeout(t); resolve(r); },
            (e) => { clearTimeout(t); reject(e); }
        );
    });
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Music: stale-while-revalidate, separate cache.
    if (url.origin === self.location.origin && MUSIC_URL_RE.test(url.pathname)) {
        event.respondWith(
            caches.open(MUSIC_CACHE).then((cache) =>
                cache.match(req).then((cached) => {
                    const networkFetch = fetch(req)
                        .then((resp) => {
                            // Skip Range responses (206); cache full 200s only.
                            if (resp && resp.status === 200) {
                                cache.put(req, resp.clone()).catch(() => {});
                            }
                            return resp;
                        })
                        .catch(() => cached);
                    return cached || networkFetch;
                })
            )
        );
        return;
    }

    // Gallery photos/videos: cache-first, immutable URLs.
    if (url.origin === self.location.origin && PHOTO_URL_RE.test(url.pathname)) {
        event.respondWith(
            caches.open(PHOTOS_CACHE).then((cache) =>
                cache.match(req).then((cached) => {
                    if (cached) return cached;
                    return fetch(req).then((resp) => {
                        if (resp && resp.status === 200) {
                            cache.put(req, resp.clone()).catch(() => {});
                        }
                        return resp;
                    });
                })
            )
        );
        return;
    }

    // App shell + manifest.json: NETWORK-FIRST so updates are always picked up.
    if (url.origin === self.location.origin) {
        event.respondWith(
            timedFetch(req).then(
                (resp) => {
                    if (resp && resp.status === 200) {
                        const copy = resp.clone();
                        caches.open(APPSHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
                    }
                    return resp;
                },
                () => caches.match(req).then((cached) => cached || new Response('', { status: 504 }))
            )
        );
        return;
    }

    // Cross-origin: pass-through (default browser handling).
});
