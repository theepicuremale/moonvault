#!/usr/bin/env node
/*
 * tools/build-gallery.mjs
 *
 * Builds assets/ + assets/manifest.json from photos/<Album Title>/<file>.
 *
 * Design contract (see plan):
 *  - Originals are copied byte-for-byte to assets/<albumId>/<photoId><ext>.
 *    Resolution, quality, color profile, and EXIF are all preserved.
 *  - Thumbnails are generated at <photoId>.t.jpg (max 480 px, JPEG q75,
 *    EXIF stripped). Used by the grid and card carousels only.
 *  - Photo IDs are derived from SHA-256(content) — first 10 hex chars. So
 *    the same photo always maps to the same ID; rebuilds are stable.
 *  - Album IDs are derived from SHA-256(folderName + ":" + SALT) — first
 *    6 hex chars. So renaming an album folder *will* generate a new ID;
 *    renames should be done via the manifest's `title` field.
 *  - Existing manifest entries' manual fields are preserved across rebuilds:
 *      title, featured, order, hidden, cover.
 *  - Incremental: photos already in the manifest with the same hash are
 *    skipped entirely (no copy, no thumbnail, no manifest churn).
 *
 * CLI flags:
 *  --prune                 Delete orphan album/photo entries (whose source
 *                          files are gone). Default: warn only.
 *  --validate              Don't write anything. Just verify manifest.json
 *                          matches assets/. Exit non-zero if drift.
 *  --interactive-cover [t] Re-prompt the cover photo for an existing album
 *                          (by title). If no title is given, lists all
 *                          albums and asks which one.
 *  --set-cover "Album=filename"
 *                          Non-interactively set an album's cover.
 *  --strip-exif-on-fulls   For this run only, also strip EXIF from full
 *                          originals (via sharp re-encode at q92 — this
 *                          DOES change file bytes / size slightly, but
 *                          preserves resolution).
 */

import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output, argv, exit } from 'node:process';
import sharp from 'sharp';

// --- config ----------------------------------------------------------------

const ROOT = process.cwd();
const PHOTOS_DIR = path.join(ROOT, 'photos');
const ASSETS_DIR = path.join(ROOT, 'assets');
const MANIFEST_PATH = path.join(ASSETS_DIR, 'manifest.json');
const SALT = 'moonvault-v1';
const VALID_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif']);
const THUMB_MAX = 480;
const THUMB_QUALITY = 75;
const FULL_REENCODE_QUALITY = 92;

// --- args ------------------------------------------------------------------

function parseArgs(argv) {
    const args = { prune: false, validate: false, interactiveCover: null, setCover: [], stripExifOnFulls: false };
    const a = argv.slice(2);
    for (let i = 0; i < a.length; i++) {
        const arg = a[i];
        if (arg === '--prune') args.prune = true;
        else if (arg === '--validate') args.validate = true;
        else if (arg === '--strip-exif-on-fulls') args.stripExifOnFulls = true;
        else if (arg === '--interactive-cover') {
            args.interactiveCover = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : '';
        } else if (arg === '--set-cover') {
            const val = a[++i];
            if (!val || !val.includes('=')) {
                console.error(`--set-cover expects "Album=filename", got: ${val}`);
                exit(2);
            }
            const eq = val.indexOf('=');
            args.setCover.push({ title: val.slice(0, eq).trim(), match: val.slice(eq + 1).trim() });
        } else {
            console.error(`Unknown arg: ${arg}`);
            exit(2);
        }
    }
    return args;
}

// --- helpers ---------------------------------------------------------------

async function fileExists(p) {
    try { await fs.access(p); return true; } catch { return false; }
}

async function sha256OfFile(p) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        const s = createReadStream(p);
        s.on('error', reject);
        s.on('data', (c) => h.update(c));
        s.on('end', () => resolve(h.digest('hex')));
    });
}

function albumIdFromTitle(title) {
    return crypto.createHash('sha256').update(`${SALT}::album::${title}`).digest('hex').slice(0, 6);
}

async function readManifest() {
    if (!(await fileExists(MANIFEST_PATH))) {
        return { version: 1, albums: [] };
    }
    const text = await fs.readFile(MANIFEST_PATH, 'utf8');
    try {
        const m = JSON.parse(text);
        if (!m.albums) m.albums = [];
        if (!m.version) m.version = 1;
        return m;
    } catch (e) {
        console.error(`manifest.json is not valid JSON: ${e.message}`);
        exit(1);
    }
}

async function writeManifest(m) {
    await fs.mkdir(ASSETS_DIR, { recursive: true });
    const ordered = {
        version: m.version || 1,
        generatedAt: new Date().toISOString(),
        albums: m.albums.map(orderAlbumKeys)
    };
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(ordered, null, 2) + '\n');
}

function orderAlbumKeys(a) {
    const out = {};
    for (const k of ['id', 'title', 'featured', 'order', 'hidden', 'cover']) {
        if (a[k] !== undefined) out[k] = a[k];
    }
    out.photos = (a.photos || []).map((p) => {
        const op = {};
        for (const k of ['id', 'src', 'ext', 'w', 'h', 'tw', 'th']) {
            if (p[k] !== undefined) op[k] = p[k];
        }
        return op;
    });
    return out;
}

async function listAlbumsInPhotosDir() {
    if (!(await fileExists(PHOTOS_DIR))) return [];
    const entries = await fs.readdir(PHOTOS_DIR, { withFileTypes: true });
    const albums = [];
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('.') || e.name.startsWith('_')) continue;
        const dir = path.join(PHOTOS_DIR, e.name);
        const files = (await fs.readdir(dir, { withFileTypes: true }))
            .filter((f) => f.isFile() && VALID_EXTS.has(path.extname(f.name).toLowerCase()))
            .map((f) => ({ name: f.name, full: path.join(dir, f.name) }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        albums.push({ title: e.name, files });
    }
    albums.sort((a, b) => a.title.localeCompare(b.title));
    return albums;
}

async function processPhoto({ srcPath, srcName, albumDir, stripExifOnFull }) {
    const hash = await sha256OfFile(srcPath);
    const id = hash.slice(0, 10);
    const ext = path.extname(srcName).toLowerCase();
    const fullDest = path.join(albumDir, `${id}${ext}`);
    const thumbDest = path.join(albumDir, `${id}.t.jpg`);

    await fs.mkdir(albumDir, { recursive: true });

    let w = 0, h = 0;
    try {
        const meta = await sharp(srcPath).metadata();
        w = meta.width || 0;
        h = meta.height || 0;
        if (meta.orientation && meta.orientation >= 5 && meta.orientation <= 8) {
            [w, h] = [h, w];
        }
    } catch (e) {
        console.warn(`  ! could not read metadata for ${srcName}: ${e.message}`);
    }

    if (!(await fileExists(fullDest))) {
        if (stripExifOnFull) {
            await sharp(srcPath, { failOn: 'none' })
                .rotate()
                .toFormat(ext === '.png' ? 'png' : 'jpeg', { quality: FULL_REENCODE_QUALITY, mozjpeg: true })
                .toFile(fullDest);
        } else {
            await fs.copyFile(srcPath, fullDest);
        }
    }

    let tw = 0, th = 0;
    if (!(await fileExists(thumbDest))) {
        const tmeta = await sharp(srcPath, { failOn: 'none' })
            .rotate()
            .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
            .toFile(thumbDest);
        tw = tmeta.width;
        th = tmeta.height;
    } else {
        const tmeta = await sharp(thumbDest).metadata();
        tw = tmeta.width || 0;
        th = tmeta.height || 0;
    }

    return { id, src: srcName, ext, w, h, tw, th };
}

function findCoverIdInAlbum(albumEntry, match) {
    if (!match) return undefined;
    if (match === 'random') {
        const photos = albumEntry.photos || [];
        if (!photos.length) return undefined;
        return photos[Math.floor(Math.random() * photos.length)].id;
    }
    const n = Number.parseInt(match, 10);
    if (!Number.isNaN(n) && String(n) === match && n >= 1 && n <= (albumEntry.photos || []).length) {
        return albumEntry.photos[n - 1].id;
    }
    const byId = (albumEntry.photos || []).find((p) => p.id === match);
    if (byId) return byId.id;
    const byName = (albumEntry.photos || []).find((p) => p.src && p.src.toLowerCase() === match.toLowerCase());
    if (byName) return byName.id;
    return undefined;
}

async function promptCover(albumEntry) {
    const rl = readline.createInterface({ input, output });
    try {
        console.log(`\n📸 Album "${albumEntry.title}" — pick a cover photo:`);
        albumEntry.photos.slice(0, 50).forEach((p, i) => {
            console.log(`   ${String(i + 1).padStart(2)}) ${p.src}`);
        });
        if (albumEntry.photos.length > 50) {
            console.log(`   … and ${albumEntry.photos.length - 50} more (type a filename or 'random')`);
        }
        const ans = (await rl.question(`   Enter number / filename / 'random' [default: 1]: `)).trim();
        const choice = ans === '' ? '1' : ans;
        const id = findCoverIdInAlbum(albumEntry, choice);
        if (!id) {
            console.warn(`   Could not match "${choice}", defaulting to first photo.`);
            return albumEntry.photos[0].id;
        }
        return id;
    } finally {
        rl.close();
    }
}

async function chooseAlbumInteractively(manifest) {
    const rl = readline.createInterface({ input, output });
    try {
        console.log('\nAlbums in manifest:');
        manifest.albums.forEach((a, i) => {
            console.log(`   ${String(i + 1).padStart(2)}) ${a.title}  (cover: ${a.cover || 'unset'})`);
        });
        const ans = (await rl.question('   Pick a number or type the album title: ')).trim();
        if (!ans) return null;
        const n = Number.parseInt(ans, 10);
        if (!Number.isNaN(n) && n >= 1 && n <= manifest.albums.length) {
            return manifest.albums[n - 1];
        }
        return manifest.albums.find((a) => a.title.toLowerCase() === ans.toLowerCase()) || null;
    } finally {
        rl.close();
    }
}

async function listAssetFiles() {
    if (!(await fileExists(ASSETS_DIR))) return [];
    const out = [];
    const albumDirs = (await fs.readdir(ASSETS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
    for (const d of albumDirs) {
        const ad = path.join(ASSETS_DIR, d.name);
        const files = await fs.readdir(ad);
        for (const f of files) out.push(path.posix.join(d.name, f));
    }
    return out;
}

// --- main ------------------------------------------------------------------

async function main() {
    const args = parseArgs(argv);
    const manifest = await readManifest();

    if (args.validate) {
        let ok = true;
        const seen = new Set();
        for (const album of manifest.albums) {
            if (!album.id || !album.title) { console.error(`✗ Album missing id/title: ${JSON.stringify(album)}`); ok = false; continue; }
            const albumDir = path.join(ASSETS_DIR, album.id);
            const photosArr = album.photos || [];
            for (const p of photosArr) {
                const full = path.join(albumDir, `${p.id}${p.ext}`);
                const thumb = path.join(albumDir, `${p.id}.t.jpg`);
                seen.add(path.posix.join(album.id, `${p.id}${p.ext}`));
                seen.add(path.posix.join(album.id, `${p.id}.t.jpg`));
                if (!(await fileExists(full))) { console.error(`✗ Missing full: ${full}`); ok = false; }
                if (!(await fileExists(thumb))) { console.error(`✗ Missing thumb: ${thumb}`); ok = false; }
            }
            if (album.cover && !photosArr.some((p) => p.id === album.cover)) {
                console.error(`✗ Album "${album.title}" cover ${album.cover} not in photos[]`);
                ok = false;
            }
        }
        const onDisk = await listAssetFiles();
        for (const f of onDisk) {
            if (f === 'manifest.json') continue;
            if (!seen.has(f)) console.warn(`! Orphan asset (not in manifest): assets/${f}`);
        }
        if (!ok) {
            console.error('\nValidation FAILED.');
            exit(1);
        }
        console.log(`✓ Validation passed: ${manifest.albums.length} albums, ${manifest.albums.reduce((n, a) => n + (a.photos || []).length, 0)} photos.`);
        return;
    }

    if (args.interactiveCover !== null) {
        let target = null;
        if (args.interactiveCover) {
            target = manifest.albums.find((a) => a.title.toLowerCase() === args.interactiveCover.toLowerCase());
            if (!target) { console.error(`No album titled "${args.interactiveCover}".`); exit(1); }
        } else {
            target = await chooseAlbumInteractively(manifest);
            if (!target) { console.error('No album selected.'); exit(1); }
        }
        target.cover = await promptCover(target);
        await writeManifest(manifest);
        console.log(`✓ Album "${target.title}" cover set to ${target.cover}.`);
        return;
    }

    const sourceAlbums = await listAlbumsInPhotosDir();
    if (!sourceAlbums.length) {
        console.warn(`(no albums found in ${PHOTOS_DIR}; nothing to do)`);
    }

    let totalNew = 0;
    let totalSkipped = 0;
    const seenAlbumIds = new Set();

    for (const src of sourceAlbums) {
        const id = albumIdFromTitle(src.title);
        seenAlbumIds.add(id);
        let album = manifest.albums.find((a) => a.id === id);
        if (!album) {
            album = { id, title: src.title, photos: [] };
            manifest.albums.push(album);
            console.log(`+ New album: "${src.title}" (${id})`);
        }
        const albumDir = path.join(ASSETS_DIR, id);

        const knownById = new Map((album.photos || []).map((p) => [p.id, p]));
        let added = 0, skipped = 0;

        for (const file of src.files) {
            const hash = await sha256OfFile(file.full);
            const photoId = hash.slice(0, 10);
            if (knownById.has(photoId)) {
                skipped++;
                continue;
            }
            const entry = await processPhoto({
                srcPath: file.full,
                srcName: file.name,
                albumDir,
                stripExifOnFull: args.stripExifOnFulls
            });
            album.photos = album.photos || [];
            album.photos.push(entry);
            knownById.set(entry.id, entry);
            added++;
        }

        const setCoverEntry = args.setCover.find((s) => s.title.toLowerCase() === src.title.toLowerCase());
        if (setCoverEntry) {
            const coverId = findCoverIdInAlbum(album, setCoverEntry.match);
            if (!coverId) {
                console.warn(`  ! --set-cover "${setCoverEntry.title}=${setCoverEntry.match}" did not match any photo`);
            } else {
                album.cover = coverId;
                console.log(`  cover (--set-cover): ${album.cover}`);
            }
        }

        if (!album.cover && album.photos.length) {
            album.cover = await promptCover(album);
            console.log(`  cover: ${album.cover}`);
        }

        totalNew += added;
        totalSkipped += skipped;
        console.log(`Album "${album.title}" (${id}): +${added} new, ${skipped} unchanged`);
    }

    const orphans = manifest.albums.filter((a) => !seenAlbumIds.has(a.id));
    if (orphans.length) {
        if (args.prune) {
            for (const a of orphans) {
                console.log(`- Pruning album: "${a.title}" (${a.id})`);
                manifest.albums = manifest.albums.filter((x) => x !== a);
                const dir = path.join(ASSETS_DIR, a.id);
                if (await fileExists(dir)) await fs.rm(dir, { recursive: true, force: true });
            }
        } else {
            for (const a of orphans) {
                console.warn(`! Orphan in manifest (no source folder): "${a.title}" (${a.id}). Use --prune to remove.`);
            }
        }
    }

    manifest.albums.sort((a, b) => {
        const ao = a.order ?? Number.POSITIVE_INFINITY;
        const bo = b.order ?? Number.POSITIVE_INFINITY;
        if (ao !== bo) return ao - bo;
        return a.title.localeCompare(b.title);
    });

    await writeManifest(manifest);
    const totalPhotos = manifest.albums.reduce((n, a) => n + (a.photos || []).length, 0);
    console.log(`\nmanifest.json: ${manifest.albums.length} albums, ${totalPhotos} photos total.`);
    console.log(`(this run: +${totalNew} new, ${totalSkipped} unchanged)`);
}

main().catch((e) => {
    console.error('Build failed:', e);
    exit(1);
});
