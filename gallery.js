/*
 * gallery.js — OURFLIX router and renderers (iter 4).
 *
 * Two views, single page, History API.
 *
 * Photo viewer: custom Instagram-style "stories" component (replaces
 * PhotoSwipe). Fullscreen, top progress bar, three tap zones (prev /
 * play-pause / next), swipe-down to close, keyboard ←/→/Space/Esc, smooth
 * horizontal slide. Videos play with their actual duration.
 *
 * Slideshow: fullscreen crossfade, 3 s per photo, title pill at low opacity.
 */

const HERO_INTERVAL_MS = 6000;
const CARD_INTERVAL_MS = 1800;
const SLIDESHOW_INTERVAL_MS = 3000;
const STORY_PHOTO_MS = 5000;
const FALLBACK_SONG = 'music/Tum Ho Rockstar 128 Kbps.mp3';
const MANIFEST_URL = 'assets/manifest.json';

const $app = document.getElementById('app');
const $header = document.getElementById('ourflix-header');
const $brand = document.getElementById('brand-link');
const $brandText = document.querySelector('.brand-text');

let manifestCache = null;
let activeHeroTimer = null;
let activeAudio = null;

// SVG icons
const ICON_PLAY  = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_INFO  = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.8" fill="currentColor"/></svg>';
const ICON_BACK  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
const ICON_PLAY_SOLID = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE_SOLID = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';
const ICON_INFO_SMALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.6" fill="currentColor"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';
const ICON_UNMUTED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';

// ===== utilities ==========================================================

function fullUrl(album, photo) { return `assets/${album.id}/${photo.id}${photo.ext}`; }
function thumbUrl(album, photo) { return `assets/${album.id}/${photo.id}.t.jpg`; }
function songUrl(album) { return album.song ? `assets/${album.id}/${album.song}` : FALLBACK_SONG; }
function isVideo(p) { return p.type === 'video'; }
function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}
function formatDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function albumOrder(a) { return a.order ?? Number.POSITIVE_INFINITY; }
function visibleAlbums(manifest) {
    return (manifest.albums || [])
        .filter((a) => !a.hidden && (a.photos || []).length > 0)
        .sort((a, b) => {
            const ao = albumOrder(a), bo = albumOrder(b);
            if (ao !== bo) return ao - bo;
            return a.title.localeCompare(b.title);
        });
}
function chooseFeatured(albums) {
    if (!albums.length) return null;
    const featured = albums.filter((a) => a.featured);
    const pool = featured.length ? featured : albums;
    return pool[Math.floor(Math.random() * pool.length)];
}
function orderedPhotos(album) {
    const photos = album.photos || [];
    if (!album.cover) return photos;
    const cover = photos.find((p) => p.id === album.cover);
    if (!cover) return photos;
    return [cover, ...photos.filter((p) => p.id !== album.cover)];
}
function totals(album) {
    const photos = album.photos || [];
    const v = photos.filter(isVideo).length;
    const i = photos.length - v;
    return { photos: i, videos: v, total: photos.length };
}
function metaUpper(album) {
    const t = totals(album);
    const parts = [];
    if (t.photos) parts.push(`${t.photos} PHOTO${t.photos === 1 ? '' : 'S'}`);
    if (t.videos) parts.push(`${t.videos} VIDEO${t.videos === 1 ? '' : 'S'}`);
    if (album.dateLabel) parts.push(album.dateLabel.toUpperCase());
    return parts.join('  ·  ');
}

const DESC_TEMPLATES = [
    "Remembering the time we spent at {t}.",
    "Little moments from {t}.",
    "{t} — captured forever.",
    "Some of our favourites from {t}.",
    "All the small things from {t}.",
    "Pieces of {t} we don't want to forget.",
    "{t}, in pictures."
];
function descriptionFor(album) {
    const seed = [...album.id].reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return DESC_TEMPLATES[seed % DESC_TEMPLATES.length].replace('{t}', album.title);
}

function shuffle(a) {
    const arr = a.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ===== background audio (hero mute) =======================================

function ensureAudioForAlbum(album) {
    const url = songUrl(album);
    if (activeAudio && activeAudio.dataset.url === url) return activeAudio;
    if (activeAudio) { try { activeAudio.pause(); } catch (_) {} activeAudio = null; }
    // Pass URL directly to constructor + preload='auto' so the browser begins
    // fetching immediately. This makes the subsequent .play() (which runs
    // inside a user-gesture chain) succeed reliably across browsers.
    const a = new Audio(url);
    a.dataset.url = url;
    a.preload = 'auto';
    a.loop = true;
    a.volume = 0.4;
    activeAudio = a;
    return a;
}
function stopAudio() {
    if (activeAudio) { try { activeAudio.pause(); } catch (_) {} activeAudio = null; }
}

// ===== hero billboard =====================================================

function renderHero(album, options = {}) {
    if (activeHeroTimer) { clearInterval(activeHeroTimer); activeHeroTimer = null; }

    const wrap = document.createElement('section');
    wrap.className = 'hero';

    if (!album) {
        wrap.classList.add('empty');
        wrap.innerHTML = `
            <div class="hero-stage" aria-hidden="true"></div>
            <div class="hero-overlay">
                <h1 class="hero-title">Add your first album</h1>
                <p class="hero-sub">Drop a folder into <code>photos/</code> on your machine and run <code>npm run build</code>.</p>
            </div>
        `;
        return wrap;
    }

    const photos = orderedPhotos(album);
    const stage = document.createElement('div');
    stage.className = 'hero-stage';
    stage.setAttribute('aria-hidden', 'true');
    photos.slice(0, 12).forEach((p, i) => {
        const img = document.createElement('img');
        img.src = thumbUrl(album, p);
        img.loading = i === 0 ? 'eager' : 'lazy';
        img.decoding = 'async';
        img.alt = '';
        if (i === 0) img.classList.add('active');
        stage.appendChild(img);
    });
    wrap.appendChild(stage);

    const overlay = document.createElement('div');
    overlay.className = 'hero-overlay';
    const metaText = options.metaText || (album.featured ? `FEATURED  ·  ${metaUpper(album)}` : metaUpper(album) || 'ALBUM');
    overlay.innerHTML = `
        <p class="hero-meta">${escapeHTML(metaText)}</p>
        <h1 class="hero-title">${escapeHTML(album.title)}</h1>
        <p class="hero-sub">${escapeHTML(options.description || descriptionFor(album))}</p>
        <div class="hero-actions"></div>
    `;
    const actions = overlay.querySelector('.hero-actions');
    if (options.actions) {
        options.actions.forEach((a) => actions.appendChild(a));
    } else {
        const open = document.createElement('button');
        open.className = 'btn btn-primary';
        open.innerHTML = `${ICON_PLAY}<span>Play</span>`;
        open.addEventListener('click', () => startSlideshow(album));
        const info = document.createElement('button');
        info.className = 'btn btn-secondary';
        info.innerHTML = `${ICON_INFO}<span>More info</span>`;
        info.addEventListener('click', () => navigateTo({ view: 'album', id: album.id }));
        actions.append(open, info);
    }
    wrap.appendChild(overlay);

    const muteBtn = document.createElement('button');
    muteBtn.className = 'hero-mute';
    muteBtn.type = 'button';
    muteBtn.setAttribute('aria-label', 'Toggle background music');
    muteBtn.innerHTML = ICON_MUTED;
    let muted = true;
    muteBtn.addEventListener('click', () => {
        muted = !muted;
        if (muted) {
            stopAudio();
            muteBtn.innerHTML = ICON_MUTED;
        } else {
            const a = ensureAudioForAlbum(album);
            a.play().catch(() => {});
            muteBtn.innerHTML = ICON_UNMUTED;
        }
    });
    wrap.appendChild(muteBtn);

    if (photos.length > 1) {
        let i = 0;
        activeHeroTimer = setInterval(() => {
            const imgs = stage.querySelectorAll('img');
            if (!imgs.length) return;
            imgs[i].classList.remove('active');
            i = (i + 1) % imgs.length;
            imgs[i].classList.add('active');
        }, HERO_INTERVAL_MS);
    }
    return wrap;
}

// ===== album row carousel =================================================

function renderAlbumRow(title, albums) {
    const row = document.createElement('section');
    row.className = 'row';
    if (title) {
        const h = document.createElement('h2');
        h.className = 'row-title';
        h.textContent = title;
        row.appendChild(h);
    }

    if (!albums.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = `
            <h2>No albums yet</h2>
            <p>Add a folder to <code>photos/</code> on your machine, then <code>npm run build</code>.</p>
        `;
        row.appendChild(empty);
        return row;
    }

    const wrap = document.createElement('div');
    wrap.className = 'row-track-wrap';
    const track = document.createElement('div');
    track.className = 'row-track';

    for (const album of albums) {
        const photos = orderedPhotos(album);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'card' + (album.featured ? ' is-featured' : '');
        card.setAttribute('aria-label', `Open album ${album.title}`);

        const frame = document.createElement('div');
        frame.className = 'card-frame';

        const thumbs = document.createElement('div');
        thumbs.className = 'thumbs';
        photos.slice(0, 8).forEach((p, i) => {
            const img = document.createElement('img');
            img.src = thumbUrl(album, p);
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = '';
            if (i === 0) img.classList.add('active');
            thumbs.appendChild(img);
        });
        frame.appendChild(thumbs);
        card.appendChild(frame);

        // Title overlay (low-opacity grey, bottom-left, inside the card)
        const titleOverlay = document.createElement('span');
        titleOverlay.className = 'card-title-overlay';
        titleOverlay.textContent = album.title;
        card.appendChild(titleOverlay);

        // Hover popup (desktop only via CSS)
        const pop = document.createElement('div');
        pop.className = 'card-popup';
        pop.innerHTML = `
            <h3>${escapeHTML(album.title)}</h3>
            <p class="card-meta">${escapeHTML(metaUpper(album))}</p>
            <p class="card-desc">${escapeHTML(descriptionFor(album))}</p>
            <div class="card-actions">
                <button class="circle-btn solid" data-act="play" aria-label="Play stories">${ICON_PLAY_SOLID}</button>
                <button class="circle-btn" data-act="open" aria-label="Open album">${ICON_INFO_SMALL}</button>
            </div>
        `;
        card.appendChild(pop);

        pop.querySelector('[data-act="play"]').addEventListener('click', (e) => {
            e.stopPropagation();
            openStories(album);
        });
        pop.querySelector('[data-act="open"]').addEventListener('click', (e) => {
            e.stopPropagation();
            navigateTo({ view: 'album', id: album.id });
        });

        let timer = null, idx = 0;
        const start = () => {
            if (timer) return;
            const imgs = thumbs.querySelectorAll('img');
            if (imgs.length < 2) return;
            timer = setInterval(() => {
                imgs[idx].classList.remove('active');
                idx = (idx + 1) % imgs.length;
                imgs[idx].classList.add('active');
            }, CARD_INTERVAL_MS);
        };
        const stop = () => {
            if (timer) { clearInterval(timer); timer = null; }
            const imgs = thumbs.querySelectorAll('img');
            imgs.forEach((img) => img.classList.remove('active'));
            if (imgs[0]) imgs[0].classList.add('active');
            idx = 0;
        };
        card.addEventListener('mouseenter', start);
        card.addEventListener('mouseleave', stop);
        card.addEventListener('focus', start);
        card.addEventListener('blur', stop);
        card.addEventListener('touchstart', start, { passive: true });
        card.addEventListener('click', () => navigateTo({ view: 'album', id: album.id }));

        track.appendChild(card);
    }

    wrap.appendChild(track);
    row.appendChild(wrap);
    return row;
}

// ===== photo grid =========================================================

function renderPhotoGrid(album) {
    const grid = document.createElement('div');
    grid.className = 'photo-grid';
    grid.id = `grid-${album.id}`;

    const photos = orderedPhotos(album);
    photos.forEach((p, idx) => {
        const tile = document.createElement('div');
        tile.className = 'photo-tile' + (isVideo(p) ? ' is-video' : '');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', isVideo(p) ? `Play video ${p.src || ''}` : `Open photo`);
        const img = document.createElement('img');
        img.src = thumbUrl(album, p);
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = '';
        btn.appendChild(img);

        if (isVideo(p)) {
            const badge = document.createElement('span');
            badge.className = 'play-badge';
            badge.innerHTML = ICON_PLAY_SOLID;
            btn.appendChild(badge);
            if (p.dur) {
                const d = document.createElement('span');
                d.className = 'dur-badge';
                d.textContent = formatDuration(p.dur);
                btn.appendChild(d);
            }
        }
        // Click → open stories at this index.
        btn.addEventListener('click', () => openStories(album, idx));
        tile.appendChild(btn);
        grid.appendChild(tile);
    });
    return grid;
}

// ===== slideshow (album hero "Play") ======================================

function startSlideshow(album) {
    document.querySelectorAll('.slideshow-modal, .stories').forEach((n) => n.remove());
    const photos = (album.photos || []).filter((p) => !isVideo(p));
    if (!photos.length) return;
    const order = shuffle(photos);

    const modal = document.createElement('div');
    modal.className = 'slideshow-modal';
    modal.innerHTML = `
        <button class="slideshow-close" type="button" aria-label="Close">×</button>
        <div class="slideshow-stage"></div>
        <div class="slideshow-pill">${escapeHTML(album.title)}</div>
    `;
    document.body.appendChild(modal);

    const stage = modal.querySelector('.slideshow-stage');
    order.forEach((p, i) => {
        const img = document.createElement('img');
        img.src = fullUrl(album, p);
        img.loading = i < 2 ? 'eager' : 'lazy';
        img.decoding = 'async';
        img.alt = '';
        if (i === 0) img.classList.add('active');
        stage.appendChild(img);
    });

    let i = 0;
    const tick = setInterval(() => {
        const imgs = stage.querySelectorAll('img');
        imgs[i].classList.remove('active');
        i = (i + 1) % imgs.length;
        imgs[i].classList.add('active');
    }, SLIDESHOW_INTERVAL_MS);

    const audio = ensureAudioForAlbum(album);
    audio.play().catch(() => {});

    function close() {
        clearInterval(tick);
        modal.remove();
        document.removeEventListener('keydown', onKey);
        stopAudio();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    modal.querySelector('.slideshow-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target === stage) close(); });
}

// ===== stories viewer (Instagram-style) ===================================

function openStories(album, startIndex = 0) {
    document.querySelectorAll('.stories, .video-modal').forEach((n) => n.remove());
    const items = orderedPhotos(album);
    if (!items.length) return;

    const modal = document.createElement('div');
    modal.className = 'stories';
    modal.innerHTML = `
        <div class="stories-progress" role="presentation"></div>
        <div class="stories-header">
            <span class="stories-title">${escapeHTML(album.title)}</span>
            <button class="stories-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="stories-stage">
            <button class="stories-zone zone-left"  type="button" aria-label="Previous"></button>
            <button class="stories-zone zone-mid"   type="button" aria-label="Play / pause"></button>
            <button class="stories-zone zone-right" type="button" aria-label="Next"></button>
        </div>
        <div class="stories-pause-flash" aria-hidden="true">${ICON_PAUSE_SOLID}</div>
    `;
    document.body.appendChild(modal);

    const $progress = modal.querySelector('.stories-progress');
    const $stage = modal.querySelector('.stories-stage');
    const $flash = modal.querySelector('.stories-pause-flash');

    items.forEach(() => {
        const seg = document.createElement('span');
        seg.className = 'seg';
        $progress.appendChild(seg);
    });

    let current = Math.max(0, Math.min(items.length - 1, startIndex));
    let paused = false;
    let advanceTimer = null;

    function clearAdvance() {
        if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    }

    function setProgress() {
        const segs = $progress.querySelectorAll('.seg');
        segs.forEach((s, i) => {
            s.classList.remove('active', 'done');
            if (i < current) s.classList.add('done');
            else if (i === current) s.classList.add('active');
        });
        const item = items[current];
        const ms = isVideo(item) ? null : STORY_PHOTO_MS;
        if (ms) {
            const seg = segs[current];
            // restart the CSS animation by toggling the variable + a reflow
            seg.style.setProperty('--story-ms', `${ms}ms`);
            // force reflow so the keyframes restart cleanly
            void seg.offsetWidth;
        }
    }

    function flashIcon(svg) {
        $flash.innerHTML = svg;
        $flash.classList.add('show');
        setTimeout(() => $flash.classList.remove('show'), 350);
    }

    function buildSlide(item) {
        const slide = document.createElement('div');
        slide.className = 'stories-slide';
        if (isVideo(item)) {
            const v = document.createElement('video');
            v.src = fullUrl(album, item);
            v.controls = false;
            v.autoplay = true;
            v.playsInline = true;
            v.preload = 'metadata';
            // No inline width/height — CSS handles letterboxing via max-*
            slide.appendChild(v);
        } else {
            const img = document.createElement('img');
            img.src = fullUrl(album, item);
            img.alt = '';
            img.decoding = 'async';
            slide.appendChild(img);
        }
        return slide;
    }

    function showCurrent(direction) {
        // direction: 'next' | 'prev' | null (initial)
        const stage = $stage;
        const oldSlide = stage.querySelector('.stories-slide');
        const newSlide = buildSlide(items[current]);

        if (!oldSlide) {
            stage.appendChild(newSlide);
        } else if (direction === null) {
            oldSlide.remove();
            stage.appendChild(newSlide);
        } else {
            // Slide animation
            newSlide.classList.add(direction === 'next' ? 'entering-right' : 'entering-left');
            stage.appendChild(newSlide);
            // next frame: animate them
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    newSlide.classList.remove('entering-right', 'entering-left');
                    oldSlide.classList.add(direction === 'next' ? 'exiting-left' : 'exiting-right');
                });
            });
            setTimeout(() => oldSlide.remove(), 320);
        }

        setProgress();
        scheduleAdvance(newSlide);
    }

    function scheduleAdvance(slide) {
        clearAdvance();
        if (paused) return;
        const item = items[current];
        if (isVideo(item)) {
            const v = slide.querySelector('video');
            if (!v) return;
            const onEnded = () => { v.removeEventListener('ended', onEnded); next(); };
            v.addEventListener('ended', onEnded);
            v.play().catch(() => {});
            // While playing, fill the active progress bar gradually based on
            // currentTime / duration.
            const segs = $progress.querySelectorAll('.seg');
            const seg = segs[current];
            if (seg) {
                seg.classList.remove('active');
                // Override the CSS animation with a manual transition.
                const after = seg.querySelector(':scope::after'); // not directly accessible
                const fill = document.createElement('span');
                fill.style.cssText = 'position:absolute;inset:0;background:rgba(255,255,255,0.95);transform:translateX(-100%);transform-origin:left;transition:transform 0.1s linear;';
                seg.appendChild(fill);
                seg.dataset.videoSeg = '1';
                const onTime = () => {
                    if (!v.duration) return;
                    const p = Math.min(1, v.currentTime / v.duration);
                    fill.style.transform = `translateX(${(p - 1) * 100}%)`;
                };
                v.addEventListener('timeupdate', onTime);
            }
        } else {
            advanceTimer = setTimeout(() => next(), STORY_PHOTO_MS);
        }
    }

    function next() {
        if (current >= items.length - 1) { close(); return; }
        current++;
        showCurrent('next');
    }
    function prev() {
        if (current <= 0) return;
        current--;
        showCurrent('prev');
    }
    function togglePause() {
        paused = !paused;
        modal.classList.toggle('paused', paused);
        const slide = $stage.querySelector('.stories-slide');
        const v = slide && slide.querySelector('video');
        if (paused) {
            clearAdvance();
            if (v) try { v.pause(); } catch (_) {}
            flashIcon(ICON_PAUSE_SOLID);
        } else {
            if (v) try { v.play(); } catch (_) {}
            scheduleAdvance(slide);
            flashIcon(ICON_PLAY_SOLID);
        }
    }
    function close() {
        clearAdvance();
        const slide = $stage.querySelector('.stories-slide');
        const v = slide && slide.querySelector('video');
        if (v) try { v.pause(); } catch (_) {}
        modal.remove();
        document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowRight') next();
        else if (e.key === 'ArrowLeft') prev();
        else if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); togglePause(); }
    }
    document.addEventListener('keydown', onKey);

    modal.querySelector('.stories-close').addEventListener('click', close);
    modal.querySelector('.zone-left').addEventListener('click', prev);
    modal.querySelector('.zone-right').addEventListener('click', next);
    modal.querySelector('.zone-mid').addEventListener('click', togglePause);

    // Swipe-down to close.
    let startY = 0, startX = 0, tracking = false;
    modal.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        tracking = true;
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
    }, { passive: true });
    modal.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;
        const t = e.changedTouches[0];
        const dy = t.clientY - startY;
        const dx = t.clientX - startX;
        if (dy > 80 && Math.abs(dy) > Math.abs(dx)) close();
    }, { passive: true });

    showCurrent(null);
}

// ===== views ==============================================================

function renderHomeView(manifest) {
    const albums = visibleAlbums(manifest);
    const view = document.createElement('div');
    view.className = 'view view-home';
    view.appendChild(renderHero(chooseFeatured(albums)));
    view.appendChild(renderAlbumRow('Albums', albums));
    return view;
}

function renderAlbumView(manifest, albumId) {
    const albums = visibleAlbums(manifest);
    const album = albums.find((a) => a.id === albumId)
        || (manifest.albums || []).find((a) => a.id === albumId);

    const view = document.createElement('div');
    view.className = 'view view-album album-view';

    if (!album) {
        view.innerHTML = `
            <div class="empty-state">
                <h2>Album not found</h2>
                <p>It may have been removed. <a href="#" data-home>Back to home</a>.</p>
            </div>
        `;
        view.querySelector('[data-home]').addEventListener('click', (e) => { e.preventDefault(); navigateTo({ view: 'home' }); });
        return view;
    }

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'back-pill';
    back.innerHTML = `${ICON_BACK}<span>Back</span>`;
    back.addEventListener('click', () => {
        if (history.length > 1) history.back();
        else navigateTo({ view: 'home' });
    });
    view.appendChild(back);

    const playBtn = document.createElement('button');
    playBtn.className = 'btn btn-primary';
    playBtn.innerHTML = `${ICON_PLAY}<span>Play</span>`;
    playBtn.addEventListener('click', () => startSlideshow(album));
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary';
    backBtn.innerHTML = `${ICON_BACK}<span>Back</span>`;
    backBtn.addEventListener('click', () => {
        if (history.length > 1) history.back();
        else navigateTo({ view: 'home' });
    });

    const hero = renderHero(album, {
        metaText: `ALBUM  ·  ${metaUpper(album)}`,
        actions: [playBtn, backBtn]
    });
    view.appendChild(hero);

    view.appendChild(renderPhotoGrid(album));

    const others = albums.filter((a) => a.id !== album.id);
    if (others.length) view.appendChild(renderAlbumRow('More albums', others));

    return view;
}

// ===== router =============================================================

function readState() {
    const u = new URL(location.href);
    const view = u.searchParams.get('view');
    const id = u.searchParams.get('a');
    if (view === 'album' && id) return { view: 'album', id };
    return { view: 'home' };
}
function writeState(state, replace = false) {
    const u = new URL(location.href);
    if (state.view === 'album') {
        u.searchParams.set('view', 'album');
        u.searchParams.set('a', state.id);
    } else {
        u.searchParams.delete('view');
        u.searchParams.delete('a');
    }
    if (replace) history.replaceState(state, '', u.toString());
    else history.pushState(state, '', u.toString());
}
function render(state) {
    if (!manifestCache) return;
    if (activeHeroTimer) { clearInterval(activeHeroTimer); activeHeroTimer = null; }
    document.querySelectorAll('.video-modal, .slideshow-modal, .stories').forEach((n) => n.remove());
    stopAudio();
    $app.innerHTML = '';
    const view = state.view === 'album'
        ? renderAlbumView(manifestCache, state.id)
        : renderHomeView(manifestCache);
    $app.appendChild(view);
    window.scrollTo({ top: 0 });
}
function navigateTo(state) { writeState(state, false); render(state); }
window.addEventListener('popstate', () => render(readState()));

// ===== header scroll fade =================================================

function setupHeaderScroll() {
    const onScroll = () => {
        if (window.scrollY > 60) $header.classList.add('scrolled');
        else $header.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
}

// ===== boot ===============================================================

(async function main() {
    setupHeaderScroll();

    if ($brandText) {
        $brandText.classList.add('intro');
        $brandText.addEventListener('animationend', () => $brandText.classList.remove('intro'), { once: true });
    }

    if ($brand) {
        $brand.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo({ view: 'home' });
        });
    }

    let manifest;
    try {
        const r = await fetch(MANIFEST_URL, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        manifest = await r.json();
    } catch (e) {
        console.error('Could not load manifest:', e);
        manifest = { version: 1, albums: [] };
    }
    manifestCache = manifest;

    const initial = readState();
    writeState(initial, true);
    render(initial);
})();
