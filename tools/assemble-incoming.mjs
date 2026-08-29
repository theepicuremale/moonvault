#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

const [, , sourceArg, outputArg] = process.argv;
if (!sourceArg || !outputArg) {
    throw new Error('Usage: node tools/assemble-incoming.mjs <large-uploads-dir> <output-dir>');
}

const sourceRoot = path.resolve(sourceArg);
const outputRoot = path.resolve(outputArg);
const SUPPORTED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif',
    '.mp4', '.mov', '.m4v', '.webm', '.mp3', '.m4a'
]);

async function exists(target) {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

function safeSegment(value, label) {
    if (typeof value !== 'string' || !value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
        throw new Error(`Invalid ${label} in chunk manifest`);
    }
    return value;
}

if (!(await exists(sourceRoot))) {
    console.log('No chunked large uploads to assemble.');
    process.exit(0);
}

const uploadDirs = (await fs.readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

for (const uploadDir of uploadDirs) {
    const root = path.join(sourceRoot, uploadDir.name);
    let tempPath = null;
    try {
        const metadata = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
        const album = safeSegment(metadata.album, 'album');
        const fileName = safeSegment(metadata.fileName, 'filename');
        if (!SUPPORTED_EXTENSIONS.has(path.extname(fileName).toLowerCase())) {
            throw new Error(`${fileName}: unsupported media extension`);
        }
        if (!Number.isSafeInteger(metadata.size) || metadata.size < 1
            || !Number.isSafeInteger(metadata.chunkCount) || metadata.chunkCount < 1) {
            throw new Error(`${fileName}: invalid size or chunk count`);
        }
        const partsDir = path.join(root, 'parts');
        const parts = (await fs.readdir(partsDir))
            .filter((name) => name.endsWith('.chunk'))
            .sort();

        if (parts.length !== metadata.chunkCount) {
            throw new Error(`${fileName}: expected ${metadata.chunkCount} chunks, found ${parts.length}`);
        }

        const albumDir = path.join(outputRoot, album);
        const outputPath = path.join(albumDir, fileName);
        tempPath = path.join(albumDir, `.${uploadDir.name}.assembling`);
        await fs.mkdir(albumDir, { recursive: true });
        await fs.writeFile(tempPath, Buffer.alloc(0));
        for (const part of parts) {
            await fs.appendFile(tempPath, await fs.readFile(path.join(partsDir, part)));
        }

        const assembled = await fs.stat(tempPath);
        if (assembled.size !== metadata.size) {
            throw new Error(`${fileName}: expected ${metadata.size} bytes, assembled ${assembled.size}`);
        }
        await fs.rm(outputPath, { force: true });
        await fs.rename(tempPath, outputPath);
        tempPath = null;
        console.log(`Assembled ${fileName}: ${parts.length} chunks, ${(assembled.size / 1024 / 1024).toFixed(1)} MiB.`);
    } catch (error) {
        if (tempPath) await fs.rm(tempPath, { force: true });
        console.warn(`Skipping invalid chunked upload ${uploadDir.name}: ${error.message}`);
    }
}
