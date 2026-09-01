/* imaging.js — client-side image downscale to small data URLs.
 *
 * Certificates and photos are stored inline on the Firestore caregiver document
 * (no Firebase Storage), so they MUST stay tiny — Firestore caps a document at
 * ~1 MB total. These helpers downscale + JPEG-compress an image file and reject
 * anything still too large after compression.
 */

/** Downscale an image File/Blob to a JPEG data URL. */
export function fileToDataUrl(file, { maxSize = 256, quality = 0.8 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Not a readable image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/** Approx byte size of a data URL string. */
export function dataUrlBytes(dataUrl) {
  const i = String(dataUrl || '').indexOf(',');
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : '';
  return Math.floor(b64.length * 3 / 4);
}

/**
 * Compress a certificate image aggressively and guarantee it stays under
 * `maxBytes`. Retries at lower quality/size, then rejects if still too big.
 * @returns {Promise<string>} a small JPEG data URL
 */
export async function compressCertificate(file, maxBytes = 120 * 1024) {
  const attempts = [
    { maxSize: 900, quality: 0.6 },
    { maxSize: 700, quality: 0.5 },
    { maxSize: 500, quality: 0.45 },
    { maxSize: 400, quality: 0.4 }
  ];
  let last = null;
  for (const opt of attempts) {
    last = await fileToDataUrl(file, opt);
    if (dataUrlBytes(last) <= maxBytes) return last;
  }
  throw new Error('Certificate image is too large even after compression — use a smaller/clearer scan.');
}

/** Compress a profile photo to a small square-ish thumbnail. */
export function compressPhoto(file) {
  return fileToDataUrl(file, { maxSize: 256, quality: 0.8 });
}
