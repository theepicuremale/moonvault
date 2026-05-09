/*
 * prefetch.js — runs on gated pages AFTER auth, after window.load.
 *
 * Responsibilities:
 *  1) Register the service worker (sw.js) so future visits are cache-served.
 *  2) Once the page has fully painted, kick off a low-priority background
 *     fetch of the music file so the user can hit Yes without waiting.
 *
 * We only run after `load` so we never delay first paint or main scripts.
 */
(function () {
    'use strict';

    function start() {
        // 1. Register service worker (best-effort; ignore if unsupported).
        if ('serviceWorker' in navigator) {
            // Fire-and-forget; don't await.
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }

        // 2. Background-warm the music cache. Use requestIdleCallback when
        //    available so it truly waits for the browser to be idle.
        var warm = function () {
            var audio = document.getElementById('bg-music');
            if (!audio) return;
            var src = audio.currentSrc || (audio.querySelector('source') && audio.querySelector('source').src);
            if (!src) return;
            // fetch() with low priority where supported. This populates the
            // service worker cache for next time AND the HTTP cache for now,
            // so when the user clicks Yes the audio element can play instantly.
            try {
                fetch(src, { credentials: 'same-origin', priority: 'low' }).catch(function () {});
            } catch (e) {
                // Older browsers may not accept the priority option.
                try { fetch(src).catch(function () {}); } catch (_) {}
            }
        };

        if ('requestIdleCallback' in window) {
            requestIdleCallback(warm, { timeout: 3000 });
        } else {
            setTimeout(warm, 800);
        }
    }

    if (document.readyState === 'complete') {
        start();
    } else {
        window.addEventListener('load', start, { once: true });
    }
})();
