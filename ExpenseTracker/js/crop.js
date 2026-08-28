/* Lightweight, dependency-free image crop modal.
 *
 * Cropper.open(file) shows the image with an adjustable crop rectangle and
 * resolves with a cropped image Blob (or null if the user cancels / skips).
 * Pointer events handle both mouse and touch.
 */

const $ = (sel) => document.querySelector(sel);

export const Cropper = {
  _state: null,

  init() {
    // Wire the modal buttons once.
    $('#crop-cancel').addEventListener('click', () => this._finish(null));
    $('#crop-skip').addEventListener('click', () => this._finish('skip'));
    $('#crop-apply').addEventListener('click', () => this._apply());

    const overlay = $('#crop-box');
    overlay.addEventListener('pointerdown', (e) => this._onDown(e));
    window.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', () => this._onUp());
  },

  /**
   * @param {File|Blob} file
   * @returns {Promise<Blob|null|'skip'>} cropped blob, null (cancel), or 'skip'
   */
  open(file) {
    return new Promise((resolve) => {
      const modal = $('#crop-modal');
      const img = $('#crop-image');
      const url = URL.createObjectURL(file);

      img.onload = () => {
        modal.hidden = false;
        // Default crop box: centered, 80% of the displayed image.
        requestAnimationFrame(() => {
          const stage = $('#crop-stage');
          const iw = img.clientWidth, ih = img.clientHeight;
          const w = Math.round(iw * 0.8), h = Math.round(ih * 0.8);
          const x = Math.round((iw - w) / 2), y = Math.round((ih - h) / 2);
          // position stage-relative (image is centered in stage)
          const ox = img.offsetLeft, oy = img.offsetTop;
          this._state = { resolve, url, img, iw, ih, ox, oy, box: { x: ox + x, y: oy + y, w, h }, drag: null };
          this._draw();
        });
      };
      img.src = url;
    });
  },

  _draw() {
    const s = this._state; if (!s) return;
    const b = s.box;
    const el = $('#crop-box');
    el.style.left = b.x + 'px';
    el.style.top = b.y + 'px';
    el.style.width = b.w + 'px';
    el.style.height = b.h + 'px';
  },

  _onDown(e) {
    const s = this._state; if (!s) return;
    const isHandle = e.target.classList.contains('crop-handle');
    s.drag = {
      mode: isHandle ? 'resize' : 'move',
      startX: e.clientX,
      startY: e.clientY,
      box: { ...s.box }
    };
    e.preventDefault();
  },

  _onMove(e) {
    const s = this._state; if (!s || !s.drag) return;
    const dx = e.clientX - s.drag.startX;
    const dy = e.clientY - s.drag.startY;
    const start = s.drag.box;
    const minX = s.ox, minY = s.oy, maxX = s.ox + s.iw, maxY = s.oy + s.ih;

    if (s.drag.mode === 'move') {
      let nx = start.x + dx, ny = start.y + dy;
      nx = Math.max(minX, Math.min(nx, maxX - start.w));
      ny = Math.max(minY, Math.min(ny, maxY - start.h));
      s.box.x = nx; s.box.y = ny;
    } else {
      let nw = start.w + dx, nh = start.h + dy;
      nw = Math.max(40, Math.min(nw, maxX - start.x));
      nh = Math.max(40, Math.min(nh, maxY - start.y));
      s.box.w = nw; s.box.h = nh;
    }
    this._draw();
  },

  _onUp() {
    if (this._state) this._state.drag = null;
  },

  async _apply() {
    const s = this._state; if (!s) return;
    const img = s.img;
    // Map displayed crop box back to natural image pixels.
    const scaleX = img.naturalWidth / s.iw;
    const scaleY = img.naturalHeight / s.ih;
    const cropX = (s.box.x - s.ox) * scaleX;
    const cropY = (s.box.y - s.oy) * scaleY;
    const cropW = s.box.w * scaleX;
    const cropH = s.box.h * scaleY;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cropW));
    canvas.height = Math.max(1, Math.round(cropH));
    canvas.getContext('2d').drawImage(
      img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height
    );
    canvas.toBlob((blob) => this._finish(blob || null), 'image/jpeg', 0.9);
  },

  _finish(result) {
    const s = this._state;
    $('#crop-modal').hidden = true;
    if (s && s.url) URL.revokeObjectURL(s.url);
    this._state = null;
    if (s && s.resolve) s.resolve(result);
  }
};
