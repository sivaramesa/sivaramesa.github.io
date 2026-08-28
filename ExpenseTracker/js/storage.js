/* Firebase Storage module - handles optional photo-proof uploads.
 * Images are downscaled client-side before upload to save bandwidth/storage.
 */
import { storage } from './firebase-config.js';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const MAX_DIMENSION = 1280; // px, longest edge
const JPEG_QUALITY = 0.82;

/** Downscale + re-encode an image File to a JPEG Blob. */
export function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      reject(new Error('Selected file is not an image.'));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > height && width > MAX_DIMENSION) {
        height = Math.round((height * MAX_DIMENSION) / width);
        width = MAX_DIMENSION;
      } else if (height > MAX_DIMENSION) {
        width = Math.round((width * MAX_DIMENSION) / height);
        height = MAX_DIMENSION;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Image processing failed.'))),
        'image/jpeg',
        JPEG_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the image.'));
    };
    img.src = url;
  });
}

export const PhotoStore = {
  /**
   * Upload proof photo for an expense.
   * @param {string} uid    owner uid (used in the storage path)
   * @param {string} expenseId
   * @param {File}   file
   * @returns {{path:string, url:string}}
   */
  async upload(uid, expenseId, file) {
    const blob = await compressImage(file);
    const path = `proofs/${uid}/${expenseId}.jpg`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
    const url = await getDownloadURL(storageRef);
    return { path, url };
  },

  async remove(path) {
    if (!path) return;
    try {
      await deleteObject(ref(storage, path));
    } catch (e) {
      // Missing object is fine; log anything else.
      if (!(e && e.code === 'storage/object-not-found')) {
        console.warn('Photo delete failed:', e && e.message);
      }
    }
  }
};
