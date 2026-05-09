/*
 * gallery.js — renders OurNetflix from assets/manifest.json.
 *
 * Phases:
 *  1. Fetch manifest.
 *  2. Render hero (random featured album, crossfade rotation starting from cover).
 *  3. Render album cards grid (each shows cover; on hover, rotate through thumbs).
 *  4. Click an album card → expand album section inline (multiple stay open).
 *  5. Click a photo in a section → PhotoSwipe lightbox showing full-size original.
 */

import PhotoSwipeLightbox from './photoswipe/photoswipe-lightbox.esm.min.js';

const HERO_INTERVAL_MS = 5000;
const CARD_INTERVAL_MS = 1800;
const MANIFEST_URL = 'assets/manifest.json';

const $hero = document.getElementById('hero');
const $heroStage = document.getElementById('hero-stage');
const $heroTitle = document.getElementById('hero-title');
const $heroSub = document.getElementById('hero-sub');
const $heroOpen = document.getElementById('hero-open');
const $rows = document.getElementById('rows');
const $opened = document.getElementById('opened');

// Tracks which album sections are open so we don't double-add.
const openSections = new Map();

// --- helpers ---------------------------------------------------------------

function fullUrl(album, photo) {
    return `assets/${album.id}/${photo.id}${photo.ext}`;
}
function thumbUrl(album, photo) {
    return `assets/${album.id}/${photo.id}.t.jpg`;
}
function isVideo(photo) {
    return photo.type === 'video';
}

function preloadImg(src) {
    const i = new Image();
    i.decoding = 'async';
    i.loading = 'eager';
    i.src = src;
    return i;
}

function albumOrder(album) {
    return album.order ?? Number.POSITIVE_INFINITY;
}

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

// Returns photos in display order: cover first, then the rest in manifest order.
function orderedPhotos(album) {
    const photos = album.photos || [];
    if (!album.cover) return photos;
    const cover = photos.find((p) => p.id === album.cover);
    if (!cover) return photos;
    return [cover, ...photos.filter((p) => p.id !== album.cover)];
}

// --- hero ------------------------------------------------------------------

function renderHero(album) {
    if (!album) {
        $hero.classList.add('empty');
        $heroTitle.textContent = 'Add your first album';
        $heroSub.textContent = 'Drop a folder into photos/ and run npm run build.';
        $heroOpen.style.display = 'none';
        return;
    }

    $heroStage.innerHTML = '';
    const photos = orderedPhotos(album);
    photos.forEach((p, i) => {
        const img = document.createElement('img');
        img.src = thumbUrl(album, p);
        img.loading = i === 0 ? 'eager' : 'lazy';
        img.decoding = 'async';
        img.alt = '';
        if (i === 0) img.classList.add('active');
        $heroStage.appendChild(img);
    });

    $heroTitle.textContent = album.title;
    $heroSub.textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'}`;
    $heroOpen.onclick = () => openAlbum(album);

    if (photos.length > 1) {
        let i = 0;
        setInterval(() => {
            const imgs = $heroStage.querySelectorAll('img');
            if (!imgs.length) return;
            imgs[i].classList.remove('active');
            i = (i + 1) % imgs.length;
            imgs[i].classList.add('active');
        }, HERO_INTERVAL_MS);
    }
}

// --- album cards (grid) ----------------------------------------------------

function renderCards(albums) {
    $rows.innerHTML = '';
    if (!albums.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = `
            <h2>No albums yet 🌙</h2>
            <p>Add a folder to <code>photos/</code> on your machine, then <code>npm run build</code>.</p>
        `;
        $rows.appendChild(empty);
        return;
    }

    for (const album of albums) {
        const photos = orderedPhotos(album);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'album-card' + (album.featured ? ' featured' : '');
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

        const gloss = document.createElement('div');
        gloss.className = 'gloss';

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.innerHTML = `
            <h3>${escapeHTML(album.title)}</h3>
            <span class="count">${photos.length} photo${photos.length === 1 ? '' : 's'}</span>
        `;

        card.append(thumbs, gloss, meta);

        // Hover/tap-only crossfade carousel
        let timer = null;
        let idx = 0;
        function start() {
            stop();
            const imgs = thumbs.querySelectorAll('img');
            if (imgs.length < 2) return;
            timer = setInterval(() => {
                imgs[idx].classList.remove('active');
                idx = (idx + 1) % imgs.length;
                imgs[idx].classList.add('active');
            }, CARD_INTERVAL_MS);
        }
        function stop() {
            if (timer) { clearInterval(timer); timer = null; }
            const imgs = thumbs.querySelectorAll('img');
            imgs.forEach((img) => img.classList.remove('active'));
            if (imgs[0]) imgs[0].classList.add('active');
            idx = 0;
        }
        card.addEventListener('mouseenter', start);
        card.addEventListener('mouseleave', stop);
        card.addEventListener('focus', start);
        card.addEventListener('blur', stop);
        card.addEventListener('touchstart', start, { passive: true });
        card.addEventListener('touchend', () => setTimeout(stop, 4000), { passive: true });

        card.addEventListener('click', () => openAlbum(album));

        $rows.appendChild(card);
    }
}

// --- expandable album sections (lightbox) ----------------------------------

function openAlbum(album) {
    if (openSections.has(album.id)) {
        // already open → scroll to it
        openSections.get(album.id).scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    const section = document.createElement('section');
    section.className = 'album-section';
    section.id = `album-${album.id}`;

    const head = document.createElement('header');
    head.className = 'section-head';
    const h2 = document.createElement('h2');
    h2.textContent = album.title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close-btn';
    close.textContent = 'Close';
    close.addEventListener('click', () => {
        openSections.delete(album.id);
        section.remove();
    });
    head.append(h2, close);
    section.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'photo-grid';
    grid.dataset.gallery = `pswp-${album.id}`;

    const photos = orderedPhotos(album);
    photos.forEach((p) => {
        const isVid = isVideo(p);
        const a = document.createElement('a');
        a.href = fullUrl(album, p);
        a.dataset.pswpWidth = p.w || 1600;
        a.dataset.pswpHeight = p.h || 1200;
        if (isVid) {
            a.classList.add('is-video');
            a.dataset.video = '1';
            // Stop PhotoSwipe from picking this up.
            a.dataset.pswpDisabled = '1';
        }
        a.target = '_blank';
        a.rel = 'noopener';
        const img = document.createElement('img');
        img.src = thumbUrl(album, p);
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = '';
        a.appendChild(img);
        if (isVid) {
            const badge = document.createElement('span');
            badge.className = 'play-badge';
            badge.textContent = '▶';
            a.appendChild(badge);
            if (p.dur) {
                const dur = document.createElement('span');
                dur.className = 'dur-badge';
                dur.textContent = formatDuration(p.dur);
                a.appendChild(dur);
            }
            a.addEventListener('click', (ev) => {
                ev.preventDefault();
                openVideoModal(album, p);
            });
        }
        grid.appendChild(a);
    });
    section.appendChild(grid);

    $opened.appendChild(section);
    openSections.set(album.id, section);

    // Wire up PhotoSwipe lightbox for THIS section's grid only — but ignore
    // entries flagged as videos (they have their own modal).
    const lightbox = new PhotoSwipeLightbox({
        gallery: `#album-${album.id} .photo-grid`,
        children: 'a:not([data-video])',
        pswpModule: () => import('./photoswipe/photoswipe.esm.min.js')
    });
    lightbox.init();

    // Smooth scroll to it.
    requestAnimationFrame(() => {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

// --- utils -----------------------------------------------------------------

function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}

function formatDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

// --- video modal -----------------------------------------------------------

function openVideoModal(album, photo) {
    // Clean up any existing modal first.
    document.querySelectorAll('.video-modal').forEach((n) => n.remove());

    const modal = document.createElement('div');
    modal.className = 'video-modal';
    modal.tabIndex = -1;
    modal.innerHTML = `
        <button class="vm-close" type="button" aria-label="Close">×</button>
        <div class="vm-stage">
            <video controls autoplay playsinline preload="metadata"></video>
        </div>
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

// --- bootstrap -------------------------------------------------------------

(async function main() {
    let manifest;
    try {
        const r = await fetch(MANIFEST_URL, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        manifest = await r.json();
    } catch (e) {
        console.error('Could not load manifest:', e);
        manifest = { version: 1, albums: [] };
    }

    const albums = visibleAlbums(manifest);
    renderHero(chooseFeatured(albums));
    renderCards(albums);
})();
