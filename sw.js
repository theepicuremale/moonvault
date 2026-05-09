/*
 * sw.js — service worker for offline caching of static assets and music.
 *
 * Strategy:
 *  - Precache app shell (HTML, CSS, JS, GIF) on install.
 *  - For the music file, use a "stale-while-revalidate" style: serve from
 *    cache instantly if present, otherwise fetch and cache for next time.
 *  - For everything else (cross-origin GIFs from Tenor, fonts, etc.), just
 *    pass through to the network — no caching, so we don't break content
 *    that updates upstream.
 *
 * Bump CACHE_VERSION whenever any precached asset changes meaningfully so
 * old caches get cleaned up on activate.
 */
const CACHE_VERSION = 'v3';
const CACHE_NAME = `moonvault-${CACHE_VERSION}`;
const MUSIC_CACHE = `moonvault-music-${CACHE_VERSION}`;
const PHOTOS_CACHE = `moonvault-photos-${CACHE_VERSION}`;

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
    'photoswipe/photoswipe.esm.min.js',
    'assets/manifest.json'
];

const MUSIC_URL_RE = /\.mp3(\?.*)?$/i;
const PHOTO_URL_RE = /^\/.*\/assets\/[^/]+\/[^/]+\.(jpg|jpeg|png|webp|heic|heif|gif)(\?.*)?$/i;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            // addAll fails the whole install if any item fails; use individual
            // adds with catch so a single 404 doesn't brick the SW.
            Promise.all(
                PRECACHE_URLS.map((url) =>
                    cache.add(url).catch(() => {})
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
                    .filter((k) => k !== CACHE_NAME && k !== MUSIC_CACHE && k !== PHOTOS_CACHE)
                    .map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

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
                            // Only cache full 200 responses (Range requests
                            // come back as 206 — leave those alone so the
                            // browser audio engine handles seek correctly).
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

    // Gallery photos under assets/<albumId>/<photoId>.<ext>: cache-first.
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

    // Same-origin app shell: cache-first.
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(req).then((cached) => {
                if (cached) return cached;
                return fetch(req).then((resp) => {
                    if (resp && resp.status === 200) {
                        const copy = resp.clone();
                        caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
                    }
                    return resp;
                });
            })
        );
        return;
    }

    // Cross-origin (Tenor GIFs, Google Fonts, ipapi, Google Forms, confetti CDN):
    // pass through to the network with default browser behavior.
});
