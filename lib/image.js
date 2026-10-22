// Client-side image preparation for chat notes: downscale + re-encode before upload.

const MAX_SIDE = 1600;
const QUALITY = 0.82;

function loadViaImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This image format is not supported by your browser.'));
    };
    img.src = url;
  });
}

/** Returns { blob, width, height } ready to upload (JPEG, or the original GIF to keep animation). */
export async function prepareImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image.');
  const source =
    (await createImageBitmap?.(file, { imageOrientation: 'from-image' }).catch(() => null)) ??
    (await loadViaImageElement(file));
  const width = source.width;
  const height = source.height;

  if (file.type === 'image/gif') {
    if (file.size > 4 * 1024 * 1024) throw new Error('GIF is larger than 4 MB.');
    return { blob: file, width, height };
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs would otherwise turn black as JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  source.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('Could not process this image.');
  return { blob, width: w, height: h };
}

export async function uploadImage(roomId, prepared) {
  const form = new FormData();
  form.append('room', roomId);
  form.append('file', new File([prepared.blob], prepared.blob.type === 'image/gif' ? 'image.gif' : 'photo.jpg', { type: prepared.blob.type }));
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return { url: data.url, width: prepared.width, height: prepared.height };
}
