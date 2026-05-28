/*
 * tracker.js — shared visitor tracker for moonvault.
 *
 * Single entry point: window.OFTrack(eventLabel).
 *
 * Honours a per-device kill switch (localStorage.ourflix_no_track === '1')
 * — when set, no ping is sent from this device for ANY event.
 *
 * Receiver: the existing Google Form. The form has one field
 * (entry.1756652319) that captures the full message string.
 */
(function () {
    var FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScIms1aon2hHUF9MuTZ4Y8nYan8lka3ojvMv7oHHFvUE9QTGw/formResponse';
    var FIELD = 'entry.1756652319';
    var OPT_OUT_KEY = 'ourflix_no_track';

    function isOptedOut() {
        try { return localStorage.getItem(OPT_OUT_KEY) === '1'; } catch (_) { return false; }
    }

    function getDevice() {
        var ua = (navigator.userAgent || '').toLowerCase();
        if (ua.indexOf('iphone') !== -1) return 'iPhone';
        if (ua.indexOf('ipad') !== -1) return 'iPad';
        if (ua.indexOf('android') !== -1) return 'Android';
        if (ua.indexOf('windows') !== -1) return 'Windows PC';
        if (ua.indexOf('mac') !== -1) return 'Mac';
        return 'Unknown';
    }

    function fetchIp() {
        return new Promise(function (resolve) {
            var done = false;
            var t = setTimeout(function () {
                if (!done) { done = true; resolve('unknown'); }
            }, 1500);
            try {
                fetch('https://ipapi.co/json/').then(function (r) {
                    return r.json();
                }).then(function (j) {
                    if (done) return;
                    done = true;
                    clearTimeout(t);
                    resolve((j && j.ip) || 'unknown');
                }).catch(function () {
                    if (done) return;
                    done = true;
                    clearTimeout(t);
                    resolve('unknown');
                });
            } catch (_) {
                if (!done) { done = true; clearTimeout(t); resolve('unknown'); }
            }
        });
    }

    window.OFTrack = function (eventLabel) {
        if (isOptedOut()) {
            try { console.log('OFTrack: opt-out flag set, skipping', eventLabel); } catch (_) {}
            return;
        }
        var time = new Date().toLocaleString();
        var device = getDevice();
        fetchIp().then(function (ip) {
            var message = eventLabel + ' | Time: ' + time + ' | Device: ' + device + ' | IP: ' + ip;
            try { console.log('OFTrack:', message); } catch (_) {}
            try {
                fetch(FORM_URL, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: FIELD + '=' + encodeURIComponent(message)
                }).catch(function () {});
            } catch (_) {}
        });
    };
})();
