/*
 * auth.js — synchronous access gate for gated pages (index.html, yes.html, ...).
 *
 * Goal: a gated page must NEVER render anything — not even a hidden flash —
 * for an unauthorized visitor. So this script is intentionally tiny and runs
 * synchronously in <head> before <body> parses.
 *
 * Flow:
 *   1) If localStorage.vday_authed === '1', set the real title (read from
 *      <html data-real-title="...">) and continue normally.
 *   2) Otherwise, IMMEDIATELY redirect to blocked.html with ?next=<current>.
 *      The page body never gets a chance to parse / render / fetch anything.
 *
 * The IP allowlist + passcode logic now lives in blocked.html. That page
 * does the IP check on load and either auto-redirects authorized users back
 * to "next" (granting localStorage flag) or shows the Pinocchio block UI.
 *
 * Why this is stronger than before:
 *   - No async fetch on the gated page → no window where DOM exists in a
 *     hidden state but devtools / view-source can still inspect it.
 *   - Direct URL navigation to yes.html (or any other gated page) without
 *     prior auth is bounced before any of its scripts/markup can run.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'vday_authed';
    var BLOCK_PAGE = 'blocked.html';

    try {
        if (localStorage.getItem(STORAGE_KEY) === '1') {
            var realTitle = document.documentElement.getAttribute('data-real-title');
            if (realTitle) document.title = realTitle;
            return;
        }
    } catch (e) {
        // localStorage unavailable (private mode etc.) — fall through to redirect.
    }

    // Not authenticated → kick out synchronously, preserving the originally
    // requested URL so blocked.html can return us here on success.
    var next = location.pathname + location.search + location.hash;
    location.replace(BLOCK_PAGE + '?next=' + encodeURIComponent(next));

    // Belt and braces: throw to halt any further script execution on this page
    // in case the redirect is somehow delayed by the browser.
    throw new Error('auth required');
})();
