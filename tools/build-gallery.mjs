#!/usr/bin/env node
/*
 * tools/build-gallery.mjs
 *
 * Builds assets/ + assets/manifest.json from photos/<Album Title>/<file>.
 *
 * Inputs (gitignored):
 *   photos/<Album>/<image|video|audio file>
 *
 * Outputs (committed):
 *   assets/<albumId>/<photoId><ext>      — original byte-for-byte (image/video)
 *   assets/<albumId>/<photoId>.t.jpg     — 480 px max thumbnail (EXIF stripped)
 *   assets/<albumId>/<audioId>.<mp3|m4a> — album song, byte-for-byte
 *   assets/manifest.json
 *
 * Per-photo entry:
 *   { id, src, ext, type: 'image'|'video', w, h, tw, th, dur?, date? }
 * Per-album entry:
 *   { id, title, cover, dateLabel?, song?, featured?, order?, hidden?, photos: [...] }
 *
 * Stable IDs (incremental, no churn):
 *   photoId = sha256(content).slice(0,10)
 *   audioId = sha256(content).slice(0,10)
 *   albumId = sha256(SALT + ":album:" + title).slice(0,6)
 *
 * CLI flags (unchanged + new):
 *   --prune                 Delete orphan album/photo/audio entries.
 *   --validate              Only verify manifest <-> assets consistency.
 *   --interactive-cover [t] Re-prompt cover for an album (by title or interactive).
 *   --set-cover "Album=ref" Non-interactive cover set.
 *   --strip-exif-on-fulls   Re-encode full images without EXIF.
 */

import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { stdin as input, stdout as output, argv, exit } from 'node:process';
import sharp from 'sharp';

// --- config ----------------------------------------------------------------

const ROOT = process.cwd();
const PHOTOS_DIR = path.join(ROOT, 'photos');
const ASSETS_DIR = path.join(ROOT, 'assets');
const MANIFEST_PATH = path.join(ASSETS_DIR, 'manifest.json');
const SALT = 'moonvault-v1';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const AUDIO_EXTS = new Set(['.mp3', '.m4a']);
const VALID_PHOTO_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);
const THUMB_MAX = 480;
const THUMB_QUALITY = 75;
const FULL_REENCODE_QUALITY = 92;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

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
            if (!val || !val.includes('=')) { console.error(`--set-cover expects "Album=filename"`); exit(2); }
            const eq = val.indexOf('=');
            args.setCover.push({ title: val.slice(0, eq).trim(), match: val.slice(eq + 1).trim() });
        } else { console.error(`Unknown arg: ${arg}`); exit(2); }
    }
    return args;
}

// --- helpers ---------------------------------------------------------------

async function fileExists(p) { try { await fs.access(p); return true; } catch { return false; } }

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
    if (!(await fileExists(MANIFEST_PATH))) return { version: 1, albums: [] };
    const text = await fs.readFile(MANIFEST_PATH, 'utf8');
    try {
        const m = JSON.parse(text);
        if (!m.albums) m.albums = [];
        if (!m.version) m.version = 1;
        return m;
    } catch (e) { console.error(`manifest.json invalid: ${e.message}`); exit(1); }
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
    for (const k of ['id', 'title', 'featured', 'order', 'hidden', 'cover', 'dateLabel', 'song']) {
        if (a[k] !== undefined) out[k] = a[k];
    }
    out.photos = (a.photos || []).map((p) => {
        const op = {};
        for (const k of ['id', 'src', 'ext', 'type', 'dur', 'date', 'w', 'h', 'tw', 'th']) {
            if (p[k] !== undefined) op[k] = p[k];
        }
        return op;
    });
    return out;
}

// --- EXIF DateTimeOriginal parser (inline, no deps) -----------------------
//
// EXIF block in a JPEG/HEIF starts with 6-byte marker "Exif\0\0", then a TIFF
// block: 2 bytes byte-order ("II"=little, "MM"=big), 2 bytes 0x002A magic,
// 4 bytes offset to IFD0. IFD: 2 bytes entry count, then 12 bytes per entry.
// DateTimeOriginal lives in the ExifIFD (sub-IFD), pointed to from IFD0 by
// tag 0x8769 (ExifIFDPointer). DateTimeOriginal tag 0x9003 is an ASCII string
// "YYYY:MM:DD HH:MM:SS".
function parseExifDateTimeOriginal(buf) {
    if (!buf || buf.length < 14) return null;
    let p = 0;
    if (buf[0] === 0x45 && buf[1] === 0x78 && buf[2] === 0x69 && buf[3] === 0x66 && buf[4] === 0 && buf[5] === 0) {
        p = 6;
    }
    if (p + 8 > buf.length) return null;
    const bo = buf.slice(p, p + 2).toString('ascii');
    const little = bo === 'II';
    const big = bo === 'MM';
    if (!little && !big) return null;
    const r16 = (off) => little ? buf.readUInt16LE(off) : buf.readUInt16BE(off);
    const r32 = (off) => little ? buf.readUInt32LE(off) : buf.readUInt32BE(off);
    const tiffStart = p;
    if (r16(p + 2) !== 0x002A) return null;
    const ifd0Off = r32(p + 4);

    function readIFD(start) {
        const out = new Map();
        if (start + 2 > buf.length) return out;
        const count = r16(start);
        for (let i = 0; i < count; i++) {
            const e = start + 2 + i * 12;
            if (e + 12 > buf.length) break;
            const tag = r16(e);
            const type = r16(e + 2);
            const cnt = r32(e + 4);
            // value/offset is at e+8 (4 bytes)
            out.set(tag, { type, cnt, valOff: e + 8 });
        }
        return out;
    }
    function readAscii(entry) {
        const len = entry.cnt;
        let dataStart;
        if (len <= 4) dataStart = entry.valOff;
        else dataStart = tiffStart + r32(entry.valOff);
        if (dataStart + len > buf.length) return null;
        return buf.slice(dataStart, dataStart + len).toString('ascii').replace(/\0+$/, '');
    }

    const ifd0 = readIFD(tiffStart + ifd0Off);
    const exifPtr = ifd0.get(0x8769);
    let dto = null;
    if (exifPtr) {
        const exifIfd = readIFD(tiffStart + r32(exifPtr.valOff));
        const t = exifIfd.get(0x9003);
        if (t && t.type === 2) dto = readAscii(t);
    }
    if (!dto) {
        // fall back to IFD0 DateTime (0x0132)
        const t = ifd0.get(0x0132);
        if (t && t.type === 2) dto = readAscii(t);
    }
    if (!dto) return null;
    const m = dto.match(/^(\d{4}):(\d{2}):(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// --- file scanning ---------------------------------------------------------

async function listAlbumsInPhotosDir() {
    if (!(await fileExists(PHOTOS_DIR))) return [];
    const entries = await fs.readdir(PHOTOS_DIR, { withFileTypes: true });
    const albums = [];
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('.') || e.name.startsWith('_')) continue;
        const dir = path.join(PHOTOS_DIR, e.name);
        const allFiles = (await fs.readdir(dir, { withFileTypes: true }))
            .filter((f) => f.isFile())
            .map((f) => ({ name: f.name, full: path.join(dir, f.name) }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        const photos = allFiles.filter((f) => VALID_PHOTO_EXTS.has(path.extname(f.name).toLowerCase()));
        const audio = allFiles.filter((f) => AUDIO_EXTS.has(path.extname(f.name).toLowerCase()));
        albums.push({ title: e.name, files: photos, audio });
    }
    albums.sort((a, b) => a.title.localeCompare(b.title));
    return albums;
}

// --- ffmpeg (videos) -------------------------------------------------------

function runCmd(cmd, args) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        p.stdout.on('data', (c) => (stdout += c.toString()));
        p.stderr.on('data', (c) => (stderr += c.toString()));
        p.on('error', reject);
        p.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} ${code}: ${stderr.slice(0, 400)}`)));
    });
}
async function probeVideo(srcPath) {
    try {
        const { stdout } = await runCmd('ffprobe', [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height:format=duration:format_tags=creation_time',
            '-of', 'json', srcPath
        ]);
        const j = JSON.parse(stdout);
        const s = (j.streams && j.streams[0]) || {};
        const fmt = j.format || {};
        const ct = fmt.tags && (fmt.tags.creation_time || fmt.tags.com_apple_quicktime_creationdate);
        let date = null;
        if (ct) {
            const m = String(ct).match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (m) date = `${m[1]}-${m[2]}-${m[3]}`;
        }
        return {
            w: s.width || 0,
            h: s.height || 0,
            dur: fmt.duration ? Math.round(parseFloat(fmt.duration) * 10) / 10 : 0,
            date
        };
    } catch (e) {
        console.warn(`  ! ffprobe failed for ${srcPath}: ${e.message}`);
        return { w: 0, h: 0, dur: 0, date: null };
    }
}
async function extractVideoFrame(srcPath, duration, destPng) {
    const t = duration > 4 ? Math.min(duration / 2, 5) : 0.5;
    await runCmd('ffmpeg', ['-y', '-ss', String(t), '-i', srcPath, '-frames:v', '1', '-q:v', '3', destPng]);
}

// --- per-photo processing --------------------------------------------------

async function processPhoto({ srcPath, srcName, albumDir, stripExifOnFull }) {
    const ext = path.extname(srcName).toLowerCase();
    const isVideo = VIDEO_EXTS.has(ext);
    const hash = await sha256OfFile(srcPath);
    const id = hash.slice(0, 10);
    const fullDest = path.join(albumDir, `${id}${ext}`);
    const thumbDest = path.join(albumDir, `${id}.t.jpg`);
    await fs.mkdir(albumDir, { recursive: true });

    if (isVideo) {
        const probe = await probeVideo(srcPath);
        const { w, h, dur, date } = probe;

        if (!(await fileExists(fullDest))) await fs.copyFile(srcPath, fullDest);

        let tw = 0, th = 0;
        if (!(await fileExists(thumbDest))) {
            const tmpFrame = path.join(albumDir, `${id}.frame.png`);
            try {
                await extractVideoFrame(srcPath, dur, tmpFrame);
                const tmeta = await sharp(tmpFrame)
                    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
                    .toFile(thumbDest);
                tw = tmeta.width; th = tmeta.height;
            } finally { if (await fileExists(tmpFrame)) await fs.rm(tmpFrame).catch(() => {}); }
        } else {
            const tmeta = await sharp(thumbDest).metadata();
            tw = tmeta.width || 0; th = tmeta.height || 0;
        }

        const out = { id, src: srcName, ext, type: 'video', dur, w, h, tw, th };
        if (date) out.date = date;
        return out;
    }

    // IMAGE
    let w = 0, h = 0, date = null;
    try {
        const meta = await sharp(srcPath).metadata();
        w = meta.width || 0; h = meta.height || 0;
        if (meta.orientation && meta.orientation >= 5 && meta.orientation <= 8) [w, h] = [h, w];
        if (meta.exif) {
            try { date = parseExifDateTimeOriginal(meta.exif); } catch { /* ignore */ }
        }
    } catch (e) {
        console.warn(`  ! could not read metadata for ${srcName}: ${e.message}`);
    }
    if (!date) {
        // fallback: file mtime
        try {
            const st = await fs.stat(srcPath);
            const d = st.mtime;
            date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        } catch { /* ignore */ }
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
        tw = tmeta.width; th = tmeta.height;
    } else {
        const tmeta = await sharp(thumbDest).metadata();
        tw = tmeta.width || 0; th = tmeta.height || 0;
    }

    const out = { id, src: srcName, ext, type: 'image', w, h, tw, th };
    if (date) out.date = date;
    return out;
}

// --- per-album audio processing -------------------------------------------

async function processAudio({ srcPath, srcName, albumDir }) {
    const ext = path.extname(srcName).toLowerCase();
    const hash = await sha256OfFile(srcPath);
    const id = hash.slice(0, 10);
    const dest = path.join(albumDir, `${id}${ext}`);
    await fs.mkdir(albumDir, { recursive: true });
    if (!(await fileExists(dest))) await fs.copyFile(srcPath, dest);
    return `${id}${ext}`;
}

// --- album dateLabel -------------------------------------------------------

function computeDateLabel(album) {
    const dates = (album.photos || []).map((p) => p.date).filter(Boolean).sort();
    if (!dates.length) return null;
    const median = dates[Math.floor(dates.length / 2)];
    const m = median.match(/^(\d{4})-(\d{2})/);
    if (!m) return null;
    const monthIdx = parseInt(m[2], 10) - 1;
    if (monthIdx < 0 || monthIdx > 11) return m[1];
    return `${MONTHS_FULL[monthIdx]} ${m[1]}`;
}

// --- cover helpers ---------------------------------------------------------

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
    return byName ? byName.id : undefined;
}

async function promptCover(albumEntry) {
    const rl = readline.createInterface({ input, output });
    try {
        console.log(`\n📸 Album "${albumEntry.title}" — pick a cover photo:`);
        albumEntry.photos.slice(0, 50).forEach((p, i) => console.log(`   ${String(i + 1).padStart(2)}) ${p.src}`));
        if (albumEntry.photos.length > 50) console.log(`   … and ${albumEntry.photos.length - 50} more`);
        const ans = (await rl.question(`   Enter number / filename / 'random' [default: 1]: `)).trim();
        const choice = ans === '' ? '1' : ans;
        const id = findCoverIdInAlbum(albumEntry, choice);
        if (!id) {
            console.warn(`   Could not match "${choice}", defaulting to first photo.`);
            return albumEntry.photos[0].id;
        }
        return id;
    } finally { rl.close(); }
}

async function chooseAlbumInteractively(manifest) {
    const rl = readline.createInterface({ input, output });
    try {
        console.log('\nAlbums in manifest:');
        manifest.albums.forEach((a, i) => console.log(`   ${String(i + 1).padStart(2)}) ${a.title}  (cover: ${a.cover || 'unset'})`));
        const ans = (await rl.question('   Pick a number or type the album title: ')).trim();
        if (!ans) return null;
        const n = Number.parseInt(ans, 10);
        if (!Number.isNaN(n) && n >= 1 && n <= manifest.albums.length) return manifest.albums[n - 1];
        return manifest.albums.find((a) => a.title.toLowerCase() === ans.toLowerCase()) || null;
    } finally { rl.close(); }
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
            if (!album.id || !album.title) { console.error(`✗ Album missing id/title`); ok = false; continue; }
            const albumDir = path.join(ASSETS_DIR, album.id);
            for (const p of (album.photos || [])) {
                const full = path.join(albumDir, `${p.id}${p.ext}`);
                const thumb = path.join(albumDir, `${p.id}.t.jpg`);
                seen.add(path.posix.join(album.id, `${p.id}${p.ext}`));
                seen.add(path.posix.join(album.id, `${p.id}.t.jpg`));
                if (!(await fileExists(full))) { console.error(`✗ Missing full: ${full}`); ok = false; }
                if (!(await fileExists(thumb))) { console.error(`✗ Missing thumb: ${thumb}`); ok = false; }
            }
            if (album.cover && !(album.photos || []).some((p) => p.id === album.cover)) {
                console.error(`✗ Album "${album.title}" cover ${album.cover} not in photos[]`); ok = false;
            }
            if (album.song) {
                const songPath = path.join(albumDir, album.song);
                seen.add(path.posix.join(album.id, album.song));
                if (!(await fileExists(songPath))) { console.error(`✗ Missing song: ${songPath}`); ok = false; }
            }
        }
        const onDisk = await listAssetFiles();
        for (const f of onDisk) {
            if (f === 'manifest.json') continue;
            if (!seen.has(f)) console.warn(`! Orphan asset (not in manifest): assets/${f}`);
        }
        if (!ok) { console.error('\nValidation FAILED.'); exit(1); }
        const totalPhotos = manifest.albums.reduce((n, a) => n + (a.photos || []).length, 0);
        console.log(`✓ Validation passed: ${manifest.albums.length} albums, ${totalPhotos} photos.`);
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
    if (!sourceAlbums.length) console.warn(`(no albums found in ${PHOTOS_DIR}; nothing to do)`);

    let totalNew = 0, totalSkipped = 0;
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
        const knownBySrc = new Map((album.photos || []).map((p) => [p.src, p]));
        let added = 0, skipped = 0;

        for (const file of src.files) {
            const hash = await sha256OfFile(file.full);
            const photoId = hash.slice(0, 10);
            // Match either by content hash OR by original filename so a user
            // re-saving / re-downloading the same photo (different bytes,
            // same name) doesn't create a duplicate manifest entry.
            let existing = knownById.get(photoId) || knownBySrc.get(file.name);
            if (existing) {
                if (!existing.date) {
                    try {
                        const assetPath = path.join(albumDir, `${existing.id}${existing.ext}`);
                        const probeSrc = await fileExists(assetPath) ? assetPath : file.full;
                        if (existing.type === 'video') {
                            const probe = await probeVideo(probeSrc);
                            if (probe.date) existing.date = probe.date;
                        } else {
                            const meta = await sharp(probeSrc).metadata();
                            const d = meta.exif ? parseExifDateTimeOriginal(meta.exif) : null;
                            if (d) existing.date = d;
                        }
                        if (!existing.date) {
                            const st = await fs.stat(probeSrc);
                            existing.date = `${st.mtime.getFullYear()}-${String(st.mtime.getMonth() + 1).padStart(2, '0')}-${String(st.mtime.getDate()).padStart(2, '0')}`;
                        }
                    } catch { /* ignore */ }
                }
                skipped++;
                continue;
            }
            const entry = await processPhoto({
                srcPath: file.full, srcName: file.name, albumDir,
                stripExifOnFull: args.stripExifOnFulls
            });
            album.photos = album.photos || [];
            album.photos.push(entry);
            knownById.set(entry.id, entry);
            knownBySrc.set(entry.src, entry);
            added++;
        }

        // Audio: pick first audio file in the folder.
        if (src.audio.length) {
            const audio = src.audio[0];
            const fname = await processAudio({ srcPath: audio.full, srcName: audio.name, albumDir });
            // Preserve manual override only if it points at an existing file.
            if (!album.song || !(await fileExists(path.join(albumDir, album.song)))) {
                album.song = fname;
                console.log(`  song: ${fname}`);
            }
        }

        // Compute dateLabel (preserve manual override).
        if (!album.dateLabel) {
            const dl = computeDateLabel(album);
            if (dl) album.dateLabel = dl;
        }

        // Cover handling.
        const setCoverEntry = args.setCover.find((s) => s.title.toLowerCase() === src.title.toLowerCase());
        if (setCoverEntry) {
            const coverId = findCoverIdInAlbum(album, setCoverEntry.match);
            if (!coverId) console.warn(`  ! --set-cover did not match any photo`);
            else { album.cover = coverId; console.log(`  cover (--set-cover): ${album.cover}`); }
        }
        if (!album.cover && album.photos.length) {
            album.cover = await promptCover(album);
            console.log(`  cover: ${album.cover}`);
        }

        totalNew += added;
        totalSkipped += skipped;
        console.log(`Album "${album.title}" (${id}): +${added} new, ${skipped} unchanged${album.dateLabel ? ` · ${album.dateLabel}` : ''}`);
    }

    // Orphan handling.
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
            for (const a of orphans) console.warn(`! Orphan in manifest: "${a.title}" (${a.id}). Use --prune to remove.`);
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

main().catch((e) => { console.error('Build failed:', e); exit(1); });
