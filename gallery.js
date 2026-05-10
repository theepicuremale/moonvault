/*
 * gallery.js — OURFLIX router and renderers.
 *
 * Two views, single page, History API for back-button support:
 *   • Home   — sticky header + hero (random featured) + row of all albums.
 *   • Album  — sticky header + back pill + that album's hero + photo grid +
 *              "More albums" row at the bottom (with proper section spacing).
 *
 * Photo grid:
 *   - Tile container is a uniform 16:9 landscape (CSS).
 *   - Photo inside is letterboxed (object-fit: contain on a black background)
 *     so portrait/landscape/square photos all keep their natural shape; black
 *     bars fill any leftover space.
 *
 * Lightbox (PhotoSwipe v5):
 *   - Default arrows + counter (CSS-enlarged).
 *   - Custom thumbnail strip pinned at the bottom; current item highlighted;
 *     click any thumb to jump to it. Touch-friendly horizontal scroll.
 *
 * Videos:
 *   - Excluded from PhotoSwipe (children selector skips .is-video tiles).
 *   - Click → custom modal with <video controls autoplay playsinline>.
 *
 * Mobile:
 *   - Hover-pop is gated behind `(hover: hover)` so it never triggers on
 *     touch. Tap-to-open works as the primary interaction. Thumbnail strip
 *     is horizontally scrollable. Layout breakpoints handled in CSS.
 */

import PhotoSwipeLightbox from './photoswipe/photoswipe-lightbox.esm.min.js';

const HERO_INTERVAL_MS = 6000;
const CARD_INTERVAL_MS = 1800;
const MANIFEST_URL = 'assets/manifest.json';

const $app = document.getElementById('app');
const $header = document.getElementById('ourflix-header');
const $brand = document.getElementById('brand-link');

let manifestCache = null;
let activeHeroTimer = null;

// SVG icons
const ICON_PLAY = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_INFO = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.8" fill="currentColor"/></svg>';
const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
const ICON_PLAY_SOLID = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

// ===== utilities ===========================================================

function fullUrl(album, photo) { return `assets/${album.id}/${photo.id}${photo.ext}`; }
function thumbUrl(album, photo) { return `assets/${album.id}/${photo.id}.t.jpg`; }
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
function metaLine(album) {
    const t = totals(album);
    const parts = [];
    if (t.photos) parts.push(`${t.photos} photo${t.photos === 1 ? '' : 's'}`);
    if (t.videos) parts.push(`${t.videos} video${t.videos === 1 ? '' : 's'}`);
    return parts.join('  ·  ');
}

// ===== hero billboard ======================================================

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
    const metaText = options.metaText || (album.featured ? 'FEATURED ALBUM' : 'ALBUM');
    overlay.innerHTML = `
        <p class="hero-meta">${escapeHTML(metaText)}</p>
        <h1 class="hero-title">${escapeHTML(album.title)}</h1>
        <p class="hero-sub">${escapeHTML(metaLine(album) || ' ')}</p>
        <div class="hero-actions"></div>
    `;
    const actions = overlay.querySelector('.hero-actions');
    if (options.actions) {
        options.actions.forEach((a) => actions.appendChild(a));
    } else {
        const open = document.createElement('button');
        open.className = 'btn btn-primary';
        open.innerHTML = `${ICON_PLAY}<span>Open</span>`;
        open.addEventListener('click', () => navigateTo({ view: 'album', id: album.id }));
        const info = document.createElement('button');
        info.className = 'btn btn-secondary';
        info.innerHTML = `${ICON_INFO}<span>More info</span>`;
        info.addEventListener('click', () => navigateTo({ view: 'album', id: album.id }));
        actions.append(open, info);
    }
    wrap.appendChild(overlay);

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

// ===== album row carousel ==================================================

function renderAlbumRow(title, albums) {
    const row = document.createElement('section');
    row.className = 'row';
    const h = document.createElement('h2');
    h.className = 'row-title';
    h.textContent = title;
    row.appendChild(h);

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

        const gloss = document.createElement('div'); gloss.className = 'gloss';
        const meta = document.createElement('div');
        meta.className = 'meta';
        const t = totals(album);
        meta.innerHTML = `
            <h3>${escapeHTML(album.title)}</h3>
            <span class="count">${t.total} item${t.total === 1 ? '' : 's'}</span>
        `;
        card.append(thumbs, gloss, meta);

        // Hover/tap carousel of all the album's thumbs.
        let timer = null;
        let idx = 0;
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

// ===== photo grid (album detail) ==========================================

function renderPhotoGrid(album) {
    const grid = document.createElement('div');
    grid.className = 'photo-grid';
    grid.id = `grid-${album.id}`;
    grid.dataset.gallery = `pswp-${album.id}`;

    const photos = orderedPhotos(album);
    photos.forEach((p) => {
        const tile = document.createElement('div');
        tile.className = 'photo-tile' + (isVideo(p) ? ' is-video' : '');

        if (isVideo(p)) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('aria-label', `Play video ${p.src || ''}`);
            const img = document.createElement('img');
            img.src = thumbUrl(album, p);
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = '';
            btn.appendChild(img);
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
            btn.addEventListener('click', () => openVideoModal(album, p));
            tile.appendChild(btn);
        } else {
            const a = document.createElement('a');
            a.href = fullUrl(album, p);
            a.dataset.pswpWidth = p.w || 1280;
            a.dataset.pswpHeight = p.h || 1920;
            // Carry the thumb URL so the lightbox thumbnail strip can use it.
            a.dataset.thumb = thumbUrl(album, p);
            a.target = '_blank';
            a.rel = 'noopener';
            const img = document.createElement('img');
            img.src = thumbUrl(album, p);
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = '';
            a.appendChild(img);
            tile.appendChild(a);
        }
        grid.appendChild(tile);
    });

    return grid;
}

// ===== video modal =========================================================

function openVideoModal(album, photo) {
    document.querySelectorAll('.video-modal').forEach((n) => n.remove());

    const modal = document.createElement('div');
    modal.className = 'video-modal';
    modal.tabIndex = -1;
    modal.innerHTML = `
        <button class="vm-close" type="button" aria-label="Close">×</button>
        <video controls autoplay playsinline preload="metadata"></video>
    `;
    document.body.appendChild(modal);

    const video = modal.querySelector('video');
    const source = document.createElement('source');
    source.src = fullUrl(album, photo);
    source.type = mimeForExt(photo.ext);
    video.appendChild(source);
    video.load();

    function close() {
        try { video.pause(); } catch (_) {}
        modal.remove();
        document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    modal.querySelector('.vm-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.focus();
}
function mimeForExt(ext) {
    switch ((ext || '').toLowerCase()) {
        case '.mp4':
        case '.m4v': return 'video/mp4';
        case '.mov': return 'video/quicktime';
        case '.webm': return 'video/webm';
        default: return 'video/mp4';
    }
}

// ===== PhotoSwipe with custom thumbnail strip =============================

function setupLightbox(gridSelector) {
    const lightbox = new PhotoSwipeLightbox({
        gallery: gridSelector,
        children: '.photo-tile:not(.is-video) a',
        pswpModule: () => import('./photoswipe/photoswipe.esm.min.js'),
        bgOpacity: 0.96,
        showHideAnimationType: 'fade'
    });

    // Add a custom bottom thumbnail strip.
    lightbox.on('uiRegister', () => {
        lightbox.pswp.ui.registerElement({
            name: 'thumbs-strip',
            order: 9,
            isButton: false,
            appendTo: 'wrapper',
            html: '',
            onInit: (el, pswp) => {
                el.classList.add('pswp__thumbs');

                // Build the strip from the current dataSource.
                const items = pswp.options.dataSource || [];
                el.innerHTML = '';
                items.forEach((item, i) => {
                    const t = document.createElement('button');
                    t.type = 'button';
                    t.className = 'pswp__thumb';
                    t.setAttribute('aria-label', `Photo ${i + 1}`);
                    const im = document.createElement('img');
                    // Prefer the .t.jpg thumb stored on the source <a>.
                    const thumb = item?.element?.dataset?.thumb || item.msrc || item.src;
                    im.src = thumb;
                    im.loading = 'lazy';
                    im.alt = '';
                    t.appendChild(im);
                    t.addEventListener('click', (e) => {
                        e.stopPropagation();
                        pswp.goTo(i);
                        // Bring it into view in case the strip is wider than the screen.
                        t.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
                    });
                    el.appendChild(t);
                });

                const setCurrent = (idx) => {
                    el.querySelectorAll('.pswp__thumb').forEach((n, i) => {
                        n.classList.toggle('is-current', i === idx);
                    });
                    const cur = el.querySelector('.pswp__thumb.is-current');
                    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
                };
                setCurrent(pswp.currIndex);
                pswp.on('change', () => setCurrent(pswp.currIndex));
            }
        });
    });

    lightbox.init();
    return lightbox;
}

// ===== views ===============================================================

function renderHomeView(manifest) {
    const albums = visibleAlbums(manifest);
    const view = document.createElement('div');
    view.className = 'view view-home';

    view.appendChild(renderHero(chooseFeatured(albums)));
    view.appendChild(renderAlbumRow('All Albums', albums));

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

    // Back pill (top-left, fixed)
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'back-pill';
    back.innerHTML = `${ICON_BACK}<span>Back</span>`;
    back.addEventListener('click', () => {
        if (history.length > 1) history.back();
        else navigateTo({ view: 'home' });
    });
    view.appendChild(back);

    // Hero of THIS album with one clear primary CTA: "Open photos".
    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-primary';
    openBtn.innerHTML = `${ICON_PLAY}<span>Open photos</span>`;
    openBtn.addEventListener('click', () => {
        // Scroll to grid; on touch devices that's the natural "play".
        const target = view.querySelector(`#grid-${album.id}`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary';
    backBtn.innerHTML = `${ICON_BACK}<span>Back</span>`;
    backBtn.addEventListener('click', () => {
        if (history.length > 1) history.back();
        else navigateTo({ view: 'home' });
    });

    const hero = renderHero(album, {
        metaText: `ALBUM  ·  ${totals(album).total} ITEMS`,
        actions: [openBtn, backBtn]
    });
    view.appendChild(hero);

    // Section header
    const sec = document.createElement('h2');
    sec.className = 'section-title';
    sec.textContent = 'All Photos';
    view.appendChild(sec);

    const grid = renderPhotoGrid(album);
    view.appendChild(grid);

    setupLightbox(`#grid-${album.id}`);

    // "More albums" row at the bottom — strong section spacing applied via CSS.
    const others = albums.filter((a) => a.id !== album.id);
    if (others.length) view.appendChild(renderAlbumRow('More albums', others));

    return view;
}

// ===== router ==============================================================

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
    document.querySelectorAll('.video-modal').forEach((n) => n.remove());
    $app.innerHTML = '';
    const view = state.view === 'album'
        ? renderAlbumView(manifestCache, state.id)
        : renderHomeView(manifestCache);
    $app.appendChild(view);
    window.scrollTo({ top: 0 });
}
function navigateTo(state) { writeState(state, false); render(state); }
window.addEventListener('popstate', () => render(readState()));

// ===== header scroll fade ==================================================

function setupHeaderScroll() {
    const onScroll = () => {
        if (window.scrollY > 60) $header.classList.add('scrolled');
        else $header.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
}

// ===== boot ================================================================

(async function main() {
    setupHeaderScroll();

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
