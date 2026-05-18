/*
 * gallery-admin.js — lazy-loaded when the OURFLIX admin passcode is unlocked.
 *
 * Adds:
 *   - "+" button in the header to upload photos / videos.
 *   - Upload sheet with album picker (existing + "New album") and multi-file
 *     picker. Progress bar per file.
 *   - "Manage" button to add / delete / hide albums and delete individual
 *     photos.
 *   - Token paste flow (first-time) + sign-out.
 *
 * Uploads go to the `incoming` branch on GitHub via the Contents API. A
 * GitHub Actions workflow then processes them onto `main` (resize, thumb,
 * EXIF strip, manifest) and force-resets `incoming` empty. Originals never
 * land on `main`.
 *
 * Storage:
 *   - GitHub PAT lives in localStorage on this device only. Never sent
 *     anywhere except `api.github.com`.
 */

const REPO_OWNER = 'theepicuremale';
const REPO_NAME = 'moonvault';
const INCOMING_BRANCH = 'incoming';

let ctx = null;

export function init(opts) {
    ctx = opts;
    if (!getToken()) {
        // First-time unlock: ask for PAT before showing admin UI.
        promptForToken().then((ok) => { if (ok) mountAdminUI(); });
    } else {
        mountAdminUI();
    }
}

// ===== token storage ======================================================

function getToken() {
    try { return localStorage.getItem(ctx.tokenKey) || ''; } catch { return ''; }
}
function setToken(t) {
    try { localStorage.setItem(ctx.tokenKey, t); } catch (_) {}
}
function clearToken() {
    try { localStorage.removeItem(ctx.tokenKey); } catch (_) {}
}
function signOut() {
    clearToken();
    try { localStorage.removeItem(ctx.flagKey); } catch (_) {}
    location.reload();
}

// ===== minimal GitHub Contents API client ================================

const GH = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

async function gh(method, path, body) {
    const r = await fetch(`${GH}${path}`, {
        method,
        headers: {
            'Authorization': `Bearer ${getToken()}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) {
        const txt = await r.text().catch(() => '');
        // Only clear the token on a genuine 401 (token invalid/expired).
        // Other errors (404 on a not-yet-existing path, 422, 5xx, etc.)
        // should NOT log the user out.
        if (r.status === 401) {
            clearToken();
            // Prompt for a new token so the next call works.
            await promptForToken();
        }
        throw new Error(`GitHub ${method} ${path} -> ${r.status}: ${txt.slice(0, 200)}`);
    }
    return r.status === 204 ? null : r.json();
}

// Upload a file to a path on the `incoming` branch.
async function uploadFileToIncoming(repoPath, fileObj, message) {
    const base64 = await fileToBase64(fileObj);
    return gh('PUT', `/contents/${encodePath(repoPath)}`, {
        message,
        content: base64,
        branch: INCOMING_BRANCH
    });
}

// Delete a file on main (used for photo / album deletion).
async function deleteOnMain(repoPath, sha, message) {
    return gh('DELETE', `/contents/${encodePath(repoPath)}`, {
        message,
        sha,
        branch: 'main'
    });
}

// Get the sha of a file on main.
async function getMainFileSha(repoPath) {
    try {
        const r = await gh('GET', `/contents/${encodePath(repoPath)}?ref=main`);
        return r.sha;
    } catch (_) { return null; }
}

function encodePath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
            const r = reader.result;
            const comma = r.indexOf(',');
            resolve(comma >= 0 ? r.slice(comma + 1) : r);
        };
        reader.readAsDataURL(file);
    });
}

// ===== token prompt =======================================================

function promptForToken() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'adm-modal';
        modal.innerHTML = `
            <div class="adm-card">
                <h2>Admin sign-in</h2>
                <p>Paste a GitHub Personal Access Token with <code>contents: read/write</code> access to <code>${REPO_OWNER}/${REPO_NAME}</code>.</p>
                <input type="password" class="adm-input" placeholder="ghp_..." spellcheck="false" autocomplete="off" />
                <div class="adm-actions">
                    <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
                    <button type="button" class="btn btn-primary"   data-act="save">Save</button>
                </div>
                <p class="adm-hint">The token stays on this device only (localStorage). It's only sent to <code>api.github.com</code>.</p>
            </div>
        `;
        document.body.appendChild(modal);
        const input = modal.querySelector('input');
        input.focus();
        modal.querySelector('[data-act="cancel"]').addEventListener('click', () => {
            modal.remove();
            try { localStorage.removeItem(ctx.flagKey); } catch (_) {}
            resolve(false);
        });
        modal.querySelector('[data-act="save"]').addEventListener('click', () => {
            const t = (input.value || '').trim();
            if (!t) return;
            setToken(t);
            modal.remove();
            resolve(true);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') modal.querySelector('[data-act="save"]').click();
            if (e.key === 'Escape') modal.querySelector('[data-act="cancel"]').click();
        });
    });
}

// ===== top-level UI mount =================================================

function mountAdminUI() {
    // Mark body so non-admin CSS scopes can opt into admin treatments.
    document.body.classList.add('is-admin');

    // Replace any existing nav with an admin-specific menu.
    const nav = document.querySelector('.ourflix-nav');
    if (nav) {
        nav.innerHTML = `
            <button type="button" class="adm-nav-btn" id="adm-add">+ Add</button>
            <button type="button" class="adm-nav-btn" id="adm-manage">Manage</button>
            <button type="button" class="adm-nav-btn adm-signout" id="adm-signout" title="Sign out">⎋</button>
        `;
        nav.querySelector('#adm-add').addEventListener('click', openUploadSheet);
        nav.querySelector('#adm-manage').addEventListener('click', openManageSheet);
        nav.querySelector('#adm-signout').addEventListener('click', async () => {
            const ok = await showConfirm({
                title: 'Sign out of admin?',
                message: 'This removes the GitHub token from this device. You will need to paste it again next time.',
                confirmText: 'Sign out',
                danger: true
            });
            if (ok) signOut();
        });
    }

    // Decorate the current view with delete overlays on photo tiles.
    decorateExistingView();
    // And re-decorate whenever gallery.js re-renders.
    const appNode = document.getElementById('app');
    if (appNode) {
        new MutationObserver(decorateExistingView).observe(appNode, { childList: true, subtree: false });
    }
}

function decorateExistingView() {
    document.querySelectorAll('.photo-tile').forEach((tile) => {
        if (tile.querySelector('.adm-del')) return;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'adm-del';
        del.setAttribute('aria-label', 'Delete');
        del.innerHTML = '×';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            handleDeletePhotoTile(tile);
        });
        tile.appendChild(del);
    });
}

// ===== confirm / alert modal (themed replacement for native dialogs) =====

function showConfirm({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'adm-modal adm-confirm';
        modal.innerHTML = `
            <div class="adm-card">
                <h2>${escHTML(title)}</h2>
                <div class="adm-confirm-body">${message}</div>
                <div class="adm-actions">
                    <button type="button" class="btn btn-secondary" data-act="cancel">${escHTML(cancelText)}</button>
                    <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm">${escHTML(confirmText)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('[data-act="cancel"]').addEventListener('click', () => { modal.remove(); resolve(false); });
        modal.querySelector('[data-act="confirm"]').addEventListener('click', () => { modal.remove(); resolve(true); });
        modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); resolve(false); } });
        function onKey(e) {
            if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); modal.remove(); resolve(false); }
            if (e.key === 'Enter')  { document.removeEventListener('keydown', onKey); modal.remove(); resolve(true); }
        }
        document.addEventListener('keydown', onKey);
    });
}

function showAlert({ title, message }) {
    return showConfirm({ title, message, confirmText: 'OK', cancelText: '' });
}

function summarizeFiles(files) {
    let photos = 0, videos = 0;
    for (const f of files) {
        if ((f.type || '').startsWith('video/')) videos++;
        else photos++;
    }
    const parts = [];
    if (photos) parts.push(`${photos} photo${photos === 1 ? '' : 's'}`);
    if (videos) parts.push(`${videos} video${videos === 1 ? '' : 's'}`);
    return parts.join(' and ') || `${files.length} file${files.length === 1 ? '' : 's'}`;
}

// ===== upload sheet =======================================================

function openUploadSheet() {
    const m = ctx.getManifest();
    const albums = (m && m.albums) || [];

    const sheet = document.createElement('div');
    sheet.className = 'adm-modal';
    sheet.innerHTML = `
        <div class="adm-card">
            <h2>Add photos &amp; videos</h2>

            <label class="adm-label">Album</label>
            <select class="adm-input" id="adm-album">
                <option value="__new__">+ New album…</option>
                ${albums.map((a) => `<option value="${escAttr(a.title)}">${escHTML(a.title)}</option>`).join('')}
            </select>

            <div class="adm-newalbum" id="adm-newalbum" hidden>
                <label class="adm-label">New album name</label>
                <input type="text" class="adm-input" id="adm-new-name" placeholder="e.g. Bali Dec 2025" />
            </div>

            <label class="adm-label">Files</label>
            <label class="adm-file-pick">
                <input type="file" id="adm-files" multiple accept="image/*,video/*" />
                <span>Tap to pick photos &amp; videos</span>
            </label>
            <div class="adm-files-info" id="adm-files-info"></div>

            <div class="adm-progress" id="adm-progress" hidden>
                <div class="adm-progress-bar"><span></span></div>
                <p class="adm-progress-text"></p>
            </div>

            <p class="adm-error" id="adm-error" aria-live="polite"></p>

            <div class="adm-actions">
                <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
                <button type="button" class="btn btn-primary"   data-act="upload">Upload</button>
            </div>
            <p class="adm-hint">Photos go to a hidden processing branch. They'll appear on the site in ~1 minute after Actions resizes them.</p>
        </div>
    `;
    document.body.appendChild(sheet);

    const $album = sheet.querySelector('#adm-album');
    const $newAlbumWrap = sheet.querySelector('#adm-newalbum');
    const $newName = sheet.querySelector('#adm-new-name');
    const $files = sheet.querySelector('#adm-files');
    const $info = sheet.querySelector('#adm-files-info');
    const $progress = sheet.querySelector('#adm-progress');
    const $progressBar = sheet.querySelector('.adm-progress-bar span');
    const $progressText = sheet.querySelector('.adm-progress-text');
    const $error = sheet.querySelector('#adm-error');
    const $upload = sheet.querySelector('[data-act="upload"]');
    const $cancel = sheet.querySelector('[data-act="cancel"]');

    // Default to first existing album if any.
    if (albums.length) $album.value = albums[0].title;
    syncNewAlbum();
    $album.addEventListener('change', syncNewAlbum);

    function syncNewAlbum() {
        const isNew = $album.value === '__new__';
        $newAlbumWrap.hidden = !isNew;
        if (isNew) setTimeout(() => $newName.focus(), 50);
    }

    $files.addEventListener('change', () => {
        const n = $files.files.length;
        if (!n) { $info.textContent = ''; return; }
        const totalMB = Array.from($files.files).reduce((s, f) => s + f.size, 0) / (1024 * 1024);
        $info.textContent = `${n} file${n === 1 ? '' : 's'} · ${totalMB.toFixed(1)} MB`;
    });

    $cancel.addEventListener('click', () => sheet.remove());

    $upload.addEventListener('click', async () => {
        $error.textContent = '';
        const album = $album.value === '__new__' ? (($newName.value || '').trim()) : $album.value;
        if (!album) { $error.textContent = 'Pick or name an album.'; return; }
        if (album.includes('/') || album.includes('\\')) { $error.textContent = 'Album name cannot contain / or \\.'; return; }
        const files = Array.from($files.files || []);
        if (!files.length) { $error.textContent = 'Pick at least one file.'; return; }

        // Confirm dialog so a wrong tap doesn't push anything.
        const isNew = $album.value === '__new__';
        const summary = summarizeFiles(files);
        const totalMB = (files.reduce((s, f) => s + f.size, 0) / (1024 * 1024)).toFixed(1);
        const msg = isNew
            ? `Create a new album <strong>"${escHTML(album)}"</strong> with <strong>${summary}</strong> (${totalMB} MB)?`
            : `Add <strong>${summary}</strong> to <strong>"${escHTML(album)}"</strong> (${totalMB} MB)?`;
        const ok = await showConfirm({
            title: isNew ? 'Create album?' : 'Add to album?',
            message: msg,
            confirmText: isNew ? 'Create &amp; upload' : 'Upload'
        });
        if (!ok) return;

        $upload.disabled = true;
        $cancel.disabled = true;
        $progress.hidden = false;

        let okCount = 0, failCount = 0;
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const pct = Math.round((i / files.length) * 100);
            $progressBar.style.width = `${pct}%`;
            $progressText.textContent = `Uploading ${i + 1} of ${files.length} · ${f.name}`;
            const safeName = sanitizeFilename(f.name);
            const repoPath = `photos/${album}/${safeName}`;
            try {
                await uploadFileToIncoming(repoPath, f, `upload: ${album} / ${safeName}`);
                okCount++;
            } catch (e) {
                console.error('upload failed', e);
                failCount++;
            }
        }
        $progressBar.style.width = '100%';
        if (failCount === 0) {
            $progressText.textContent = `✓ Sent ${okCount} to "${album}". Processing on the server — refresh in ~1 minute.`;
        } else {
            $progressText.textContent = `Sent ${okCount}, ${failCount} failed. See console.`;
        }
        // Replace the actions row with a Close + Refresh.
        sheet.querySelector('.adm-actions').innerHTML = `
            <button type="button" class="btn btn-secondary" data-act="close">Close</button>
            <button type="button" class="btn btn-primary"   data-act="refresh">Refresh in 60s</button>
        `;
        sheet.querySelector('[data-act="close"]').addEventListener('click', () => sheet.remove());
        const $r = sheet.querySelector('[data-act="refresh"]');
        let left = 60;
        const tick = setInterval(() => {
            left -= 1;
            if (left <= 0) {
                clearInterval(tick);
                location.reload();
                return;
            }
            $r.textContent = `Refresh in ${left}s`;
        }, 1000);
        $r.addEventListener('click', () => location.reload());
    });
}

function sanitizeFilename(name) {
    // Drop anything path-y; keep just the basename.
    const base = name.split(/[/\\]/).pop();
    // Collapse weird characters.
    return base.replace(/[^A-Za-z0-9._\- ]/g, '_').slice(0, 200);
}

// ===== manage albums sheet ================================================

function openManageSheet() {
    const m = ctx.getManifest();
    const albums = (m && m.albums) || [];

    const sheet = document.createElement('div');
    sheet.className = 'adm-modal';
    sheet.innerHTML = `
        <div class="adm-card">
            <h2>Manage albums</h2>
            <p class="adm-hint">Delete removes the album and all its photos from <code>main</code>. To rename, edit <code>assets/manifest.json</code> via git (renaming via this UI would conflict with how album IDs are derived from titles).</p>
            <ul class="adm-list">
                ${albums.map((a) => `
                    <li data-id="${escAttr(a.id)}">
                        <span class="adm-list-title">${escHTML(a.title)}</span>
                        <span class="adm-list-meta">${(a.photos || []).length} item${(a.photos || []).length === 1 ? '' : 's'}</span>
                        <button type="button" class="adm-list-btn" data-act="delete">Delete</button>
                    </li>
                `).join('')}
            </ul>
            <div class="adm-actions">
                <button type="button" class="btn btn-secondary" data-act="close">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(sheet);

    sheet.querySelector('[data-act="close"]').addEventListener('click', () => sheet.remove());

    sheet.querySelectorAll('li').forEach((li) => {
        const id = li.dataset.id;
        li.querySelector('[data-act="delete"]').addEventListener('click', async () => {
            const album = (ctx.getManifest().albums || []).find((a) => a.id === id);
            if (!album) return;
            const photoCount = (album.photos || []).filter((p) => p.type !== 'video').length;
            const vidCount = (album.photos || []).filter((p) => p.type === 'video').length;
            const parts = [];
            if (photoCount) parts.push(`${photoCount} photo${photoCount === 1 ? '' : 's'}`);
            if (vidCount) parts.push(`${vidCount} video${vidCount === 1 ? '' : 's'}`);
            const summary = parts.join(' and ') || '0 items';
            const ok = await showConfirm({
                title: 'Delete album?',
                message: `Delete <strong>"${escHTML(album.title)}"</strong> and all its content (<strong>${summary}</strong>)?<br><br><span style="color:#ff8b8b">This cannot be undone.</span>`,
                confirmText: 'Delete',
                danger: true
            });
            if (!ok) return;
            try {
                await deleteWholeAlbum(album);
                await showAlert({ title: 'Deleted', message: `"${escHTML(album.title)}" was removed. The site will reflect this in ~30 s.` });
                location.reload();
            } catch (e) {
                console.error(e);
                await showAlert({ title: 'Delete failed', message: 'See the browser console for details.' });
            }
        });
    });
}

// ===== mutations against main =============================================

async function deleteWholeAlbum(album) {
    // Delete every asset file (full + thumb + song) and the manifest entry.
    const paths = [];
    for (const p of (album.photos || [])) {
        paths.push(`assets/${album.id}/${p.id}${p.ext}`);
        paths.push(`assets/${album.id}/${p.id}.t.jpg`);
    }
    if (album.song) paths.push(`assets/${album.id}/${album.song}`);
    for (const p of paths) {
        const sha = await getMainFileSha(p);
        if (!sha) continue;
        await deleteOnMain(p, sha, `delete: ${p}`);
    }
    // Update manifest.
    const manifestPath = 'assets/manifest.json';
    const cur = await gh('GET', `/contents/${manifestPath}?ref=main`);
    const json = JSON.parse(atobUtf8(cur.content));
    json.albums = (json.albums || []).filter((a) => a.id !== album.id);
    await gh('PUT', `/contents/${manifestPath}`, {
        message: `delete album: ${album.title}`,
        content: btoaUtf8(JSON.stringify(json, null, 2) + '\n'),
        sha: cur.sha,
        branch: 'main'
    });
}

async function handleDeletePhotoTile(tile) {
    // Find which photo / album this tile belongs to.
    const grid = tile.closest('.photo-grid');
    if (!grid) return;
    const albumId = (grid.id || '').replace(/^grid-/, '');
    const m = ctx.getManifest();
    const album = (m.albums || []).find((a) => a.id === albumId);
    if (!album) return;

    // Identify the photo by its child <img>.t.jpg src.
    const img = tile.querySelector('img');
    if (!img) return;
    const m2 = img.src.match(/assets\/[^/]+\/([^/]+)\.t\.jpg/);
    if (!m2) return;
    const photoId = m2[1];
    const photo = (album.photos || []).find((p) => p.id === photoId);
    if (!photo) return;

    const ok = await showConfirm({
        title: 'Delete this item?',
        message: `Remove <strong>1 ${photo.type === 'video' ? 'video' : 'photo'}</strong> from <strong>"${escHTML(album.title)}"</strong>?<br><br><span style="color:#ff8b8b">This cannot be undone.</span>`,
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;

    try {
        const fullPath = `assets/${album.id}/${photo.id}${photo.ext}`;
        const thumbPath = `assets/${album.id}/${photo.id}.t.jpg`;
        const fullSha = await getMainFileSha(fullPath);
        const thumbSha = await getMainFileSha(thumbPath);
        if (fullSha) await deleteOnMain(fullPath, fullSha, `delete: ${fullPath}`);
        if (thumbSha) await deleteOnMain(thumbPath, thumbSha, `delete: ${thumbPath}`);

        // Update manifest.
        const manifestPath = 'assets/manifest.json';
        const cur = await gh('GET', `/contents/${manifestPath}?ref=main`);
        const json = JSON.parse(atobUtf8(cur.content));
        const a = (json.albums || []).find((x) => x.id === album.id);
        if (a) a.photos = (a.photos || []).filter((p) => p.id !== photo.id);
        if (a && a.cover === photo.id) {
            a.cover = (a.photos[0] && a.photos[0].id) || undefined;
        }
        await gh('PUT', `/contents/${manifestPath}`, {
            message: `delete: ${album.title}/${photo.src || photo.id}`,
            content: btoaUtf8(JSON.stringify(json, null, 2) + '\n'),
            sha: cur.sha,
            branch: 'main'
        });

        // Remove tile from current DOM and update local manifest cache.
        tile.remove();
        if (a) ctx.setManifest && ctx.setManifest(json);
        await showAlert({ title: 'Deleted', message: 'The site will reflect this in ~30 s.' });
    } catch (e) {
        console.error(e);
        await showAlert({ title: 'Delete failed', message: e.message || 'See console for details.' });
    }
}

// ===== helpers ============================================================

function escHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}
function escAttr(s) { return escHTML(s); }

// base64 helpers that handle non-ASCII (album titles, JSON unicode).
function btoaUtf8(s) {
    return btoa(unescape(encodeURIComponent(s)));
}
function atobUtf8(s) {
    return decodeURIComponent(escape(atob(s.replace(/\s/g, ''))));
}
