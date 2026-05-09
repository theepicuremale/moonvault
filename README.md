# moonvault 🌙

This is a personal, private little corner of the internet — built by me, for me and mine. It is **not** a template, not a tutorial, and not meant to be reused.

**Live (gated):** https://theepicuremale.github.io/moonvault/

## What this is

A tiny interactive page that opens up only for a small allowlist of people. Anyone else lands on a polite "not for you" wall. Inside lives **OURFLIX** (`ourflix.html`) — a Netflix-style photo gallery of our memories: albums, covers, lightbox viewer, video player, the works.

## Please don't copy this

If you stumbled here from search or a link:

- **Don't fork it.** The text, music, GIFs, allowlist, and overall vibe are tailored for one specific person. Cloning it just hands them somebody else's love letter with the name changed.
- **Don't lift the code wholesale.** It's intentionally simple — if you want to make something for someone, make *your* version, not mine.
- **Don't try to bypass the gate.** It's there on purpose.

If you genuinely want to build something similar for someone you care about, build it yourself from scratch. The whole point is that it's *yours*.

---

## Adding photos to OurNetflix

This is the workflow you'll actually run.

### 1. Drop photos and videos
On your machine, in this repo:
```
photos/
  Goa Dec 2025/
    DSC_0001.JPG
    DSC_0002.JPG
    IMG_4421.HEIC
    clip.mp4
    sunset.mov
```
The folder name = the album title. `photos/` is **gitignored** — these never leave your laptop.
Supported images: `.jpg/.jpeg/.png/.webp/.heic/.heif/.gif`.
Supported videos: `.mp4/.mov/.m4v/.webm` (originals are copied byte-for-byte; a still-frame thumbnail is generated via `ffmpeg`, install once with `winget install Gyan.FFmpeg` on Windows or `brew install ffmpeg` on macOS).

### 2. First time only
```
npm install
```

### 3. Build
```
npm run build
```
- New albums → script asks you to pick a cover photo.
- Existing albums → never re-asks; new photos appended; existing IDs untouched.
- Originals are copied **byte-for-byte** to `assets/<albumId>/<photoId><ext>` (random IDs). Resolution, quality, and EXIF preserved.
- Thumbnails generated alongside (`<photoId>.t.jpg`, ~480 px, EXIF stripped). Used in cards/grid only.
- `assets/manifest.json` updated, preserving any manual edits.

### 4. Commit & push
```
git add assets manifest.json
git commit -m "Add Goa album"
git push
```
Pages rebuilds. Live in ~30 s.

### Useful scripts
| Command | What it does |
|---|---|
| `npm run build` | Default; processes new photos, prompts for cover on new albums. |
| `npm run build:prune` | Same, plus deletes orphan album entries (whose source folder is gone). |
| `npm run set-cover` | Lists existing albums and lets you re-pick a cover. |
| `npm run validate` | Verifies manifest ↔ assets consistency without writing anything. |
| `node tools/build-gallery.mjs --set-cover "Goa Dec 2025=IMG_4421.HEIC"` | Non-interactive cover change. |
| `node tools/build-gallery.mjs --strip-exif-on-fulls` | One-shot: re-encode full files without EXIF (preserves resolution; slight quality loss). |

### Manifest hand-edits
Open `assets/manifest.json` in any editor. These fields are yours; the build won't overwrite them:
- `title` — rename without touching files.
- `featured: true` — include album in hero rotation.
- `order: 1` — pin to top of grid (lower = earlier).
- `hidden: true` — hide an album.
- `cover` — photo ID *or* original filename of the cover.

Photo entries also store `src` (the original filename) so you can reference photos by friendly name when editing.

---

## Notes to future me

- IP allowlist + passcode escape hatch live in `blocked.html`. `auth.js` only checks `localStorage`; if missing, it redirects to `blocked.html?next=<path>` synchronously so gated pages never render for unauthorized visitors.
- Initial `<title>` on every gated page is the "not for you" wall; `auth.js` flips it to the real title (read from `data-real-title` on `<html>`) only after auth passes.
- Music in `music/` is the one *we* know. Don't replace casually. `<audio preload="none">` everywhere; `prefetch.js` warms cache after `window.load`.
- Service worker `sw.js` precaches the app shell, runtime caches `*.mp3` and `assets/<albumId>/<photoId>.*`. Bump `CACHE_VERSION` whenever a precached asset changes meaningfully.
- Pages source: `main` branch, `/` (root). Public repo (Free plan) — anything in `assets/` is technically world-readable if URLs are guessed. Random IDs make that infeasible in practice. **Don't put anything truly secret in here.**

## License

All rights reserved. Personal project — no license granted to copy, redistribute, or reuse.
