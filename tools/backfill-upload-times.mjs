#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'assets', 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const output = execFileSync(
    'git',
    ['log', '--all', '--format=__COMMIT__%cI', '--name-status', '--', 'assets'],
    { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
);

let commitTime = '';
const addedAt = new Map();
for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('__COMMIT__')) {
        commitTime = new Date(line.slice('__COMMIT__'.length)).toISOString();
        continue;
    }
    const match = line.match(/^A\s+(assets\/.+)$/);
    if (match && commitTime && !addedAt.has(match[1])) {
        addedAt.set(match[1], commitTime);
    }
}

let photoCount = 0;
for (const album of manifest.albums || []) {
    let latest = album.updatedAt ? new Date(album.updatedAt).toISOString() : '';
    for (const photo of album.photos || []) {
        const assetPath = `assets/${album.id}/${photo.id}${photo.ext}`;
        const sourceTime = photo.uploadedAt || addedAt.get(assetPath)
            || (photo.date ? `${photo.date}T00:00:00Z` : undefined);
        photo.uploadedAt = sourceTime ? new Date(sourceTime).toISOString() : undefined;
        if (photo.uploadedAt) {
            photoCount++;
            if (photo.uploadedAt > latest) latest = photo.uploadedAt;
        }
    }
    if (latest) album.updatedAt = latest;
}

manifest.albums.sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    || a.title.localeCompare(b.title)
);

function orderedPhoto(photo) {
    const out = {};
    for (const key of ['id', 'src', 'ext', 'type', 'dur', 'date', 'uploadedAt', 'w', 'h', 'tw', 'th']) {
        if (photo[key] !== undefined) out[key] = photo[key];
    }
    return out;
}

function orderedAlbum(album) {
    const out = {};
    for (const key of ['id', 'title', 'featured', 'order', 'hidden', 'cover', 'dateLabel', 'updatedAt', 'song']) {
        if (album[key] !== undefined) out[key] = album[key];
    }
    out.photos = (album.photos || []).map(orderedPhoto);
    return out;
}

const outputManifest = {
    version: manifest.version || 1,
    generatedAt: manifest.generatedAt,
    albums: manifest.albums.map(orderedAlbum)
};

await fs.writeFile(manifestPath, `${JSON.stringify(outputManifest, null, 2)}\n`);
console.log(`Backfilled upload times for ${photoCount} photos across ${manifest.albums.length} albums.`);
