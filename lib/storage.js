import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { del, get, list, put } from '@vercel/blob';

/*
 * Image storage for chat notes.
 *  - Production: Vercel Blob with *private* access (BLOB_READ_WRITE_TOKEN). Images are never public;
 *    the app streams them through /api/files/... after checking board membership.
 *  - Local development without a token: files go to ./.uploads.
 * Swap this file to move to S3 / Cloudflare R2 later.
 */

// Vercel functions accept request bodies up to 4.5 MB; resized JPEGs are typically < 500 KB.
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const LOCAL_DIR = path.join(process.cwd(), '.uploads');
const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

function assertStorageConfigured() {
  if (!useBlob() && process.env.VERCEL) {
    throw new Error('Image storage is not set up yet: add a Vercel Blob store to this project.');
  }
}

/** Saves an uploaded image for a board and returns the app URL that serves it. */
export async function storeImage(roomId, file) {
  assertStorageConfigured();
  const ext = TYPES[file.type];
  if (!ext) throw new Error('Only JPEG, PNG, WebP or GIF images are allowed.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Image is larger than 4 MB.');

  const pathname = `boards/${roomId}/${randomUUID()}.${ext}`;
  if (useBlob()) {
    await put(pathname, file, { access: 'private', contentType: file.type, addRandomSuffix: false });
  } else {
    const target = path.join(LOCAL_DIR, pathname);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await file.arrayBuffer()));
  }
  return `/api/files/${pathname}`;
}

/** Returns { body, contentType } for a stored image, or null. */
export async function readImage(pathname) {
  const ext = pathname.split('.').pop();
  const contentType = Object.keys(TYPES).find((t) => TYPES[t] === ext) || 'application/octet-stream';
  if (useBlob()) {
    const result = await get(pathname, { access: 'private' });
    return result ? { body: result.stream, contentType: result.blob?.contentType || contentType } : null;
  }
  try {
    return { body: await readFile(path.join(LOCAL_DIR, pathname)), contentType };
  } catch {
    return null;
  }
}

/** Removes every image of a board (called when the owner deletes it). */
export async function deleteBoardImages(roomId) {
  const prefix = `boards/${roomId}/`;
  if (useBlob()) {
    let cursor;
    do {
      const page = await list({ prefix, cursor });
      if (page.blobs.length) await del(page.blobs.map((b) => b.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } else {
    await rm(path.join(LOCAL_DIR, prefix), { recursive: true, force: true });
  }
}
