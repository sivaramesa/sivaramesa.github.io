/* Firebase Storage module - handles optional entry attachments.
 *
 * An entry can have MULTIPLE attachments (photos from the camera or files
 * picked from disk). All attachments for an entry are compressed to a low
 * quality JPEG, bundled into a single .zip, and uploaded as one object.
 */
import { storage } from './firebase-config.js';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { createZip } from './zip.js';

// Attachment limits (kept small on purpose per requirements).
export const ATTACH_LIMITS = {
  MAX_DIMENSION: 900,          // px, longest edge (starting point)
  TARGET_BYTES: 150 * 1024,    // aim for <= 150 KB per image
  HARD_MAX_BYTES: 250 * 1024,  // never exceed this
  MAX_ATTACHMENTS: 10          // per entry
};

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed.'))), 'image/jpeg', quality)
  );
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the image.')); };
    img.src = url;
  });
}

function drawScaled(img, longestEdge) {
  let { width, height } = img;
  if (width >= height && width > longestEdge) {
    height = Math.round((height * longestEdge) / width);
    width = longestEdge;
  } else if (height > longestEdge) {
    width = Math.round((width * longestEdge) / height);
    height = longestEdge;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

/**
 * Compress an image File/Blob to a low-quality JPEG that fits a byte budget.
 * Strategy: step JPEG quality down; if still over budget at the floor, shrink
 * dimensions and retry. Returns a Blob guaranteed <= HARD_MAX_BYTES (best effort).
 */
export async function compressImage(file, opts = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    throw new Error('Selected file is not an image.');
  }
  const target = opts.targetBytes || ATTACH_LIMITS.TARGET_BYTES;
  const hardMax = opts.hardMaxBytes || ATTACH_LIMITS.HARD_MAX_BYTES;
  const img = await loadImage(file);

  let edge = opts.maxDimension || ATTACH_LIMITS.MAX_DIMENSION;
  let best = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = drawScaled(img, edge);
    // Sweep quality from 0.7 down to 0.3.
    for (let q = 0.7; q >= 0.3; q -= 0.1) {
      const blob = await canvasToBlob(canvas, q);
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= target) return blob;
    }
    // Still too big at this size: shrink the longest edge and try again.
    edge = Math.round(edge * 0.8);
    if (edge < 300) break;
  }

  // Couldn't hit the soft target; return the smallest we produced if it's
  // within the hard ceiling, otherwise one more aggressive pass.
  if (best && best.size <= hardMax) return best;
  const tiny = drawScaled(img, 400);
  return canvasToBlob(tiny, 0.3);
}

async function blobToUint8(blob) {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

export const AttachmentStore = {
  /**
   * Compress each image, zip them together, and upload one .zip for an entry.
   * Non-image files are stored as-is inside the zip.
   * @param {string} uid
   * @param {string} entryId
   * @param {File[]} files
   * @returns {{path:string, url:string, count:number}|null}
   */
  async uploadZip(uid, entryId, files) {
    if (!files || !files.length) return null;

    const zipFiles = [];
    let idx = 1;
    for (const file of files) {
      try {
        if (file.type && file.type.startsWith('image/')) {
          const blob = await compressImage(file);
          zipFiles.push({
            name: `attachment-${String(idx).padStart(2, '0')}.jpg`,
            data: await blobToUint8(blob)
          });
        } else {
          // Keep original name for non-images.
          const safe = (file.name || `file-${idx}`).replace(/[^\w.\-]+/g, '_');
          zipFiles.push({ name: `${String(idx).padStart(2, '0')}-${safe}`, data: await blobToUint8(file) });
        }
        idx++;
      } catch (e) {
        console.warn('Skipping unreadable attachment:', e && e.message);
      }
    }
    if (!zipFiles.length) return null;

    const zipBlob = createZip(zipFiles);
    const path = `attachments/${uid}/${entryId}.zip`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, zipBlob, { contentType: 'application/zip' });
    const url = await getDownloadURL(storageRef);
    return { path, url, count: zipFiles.length };
  },

  async remove(path) {
    if (!path) return;
    try {
      await deleteObject(ref(storage, path));
    } catch (e) {
      if (!(e && e.code === 'storage/object-not-found')) {
        console.warn('Attachment delete failed:', e && e.message);
      }
    }
  }
};
