/* make-icons.js — one-off generator for the PWA icons.
 * Writes valid PNGs (brand-blue rounded square + white medical cross) with a
 * hand-rolled PNG encoder so it needs zero dependencies. Run: node make-icons.js
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let c, table = crc32._t || (crc32._t = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const brand = [26, 115, 232];   // #1a73e8
  const white = [255, 255, 255];
  const r = Math.round(size * 0.22);            // corner radius
  const armT = Math.round(size * 0.16);         // cross thickness
  const inset = Math.round(size * 0.28);        // cross bounding inset
  const cx = size / 2, cy = size / 2;

  // raw RGBA rows with a 1-byte filter prefix each
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const inRounded = (x, y) => {
    const nx = Math.min(x, size - 1 - x), ny = Math.min(y, size - 1 - y);
    if (nx >= r || ny >= r) return true;
    const dx = r - nx, dy = r - ny;
    return dx * dx + dy * dy <= r * r;
  };
  const inCross = (x, y) => {
    const vert = x >= cx - armT / 2 && x <= cx + armT / 2 && y >= inset && y <= size - inset;
    const horiz = y >= cy - armT / 2 && y <= cy + armT / 2 && x >= inset && x <= size - inset;
    return vert || horiz;
  };

  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const o = y * stride + 1 + x * 4;
      if (!inRounded(x, y)) { raw[o] = 0; raw[o+1] = 0; raw[o+2] = 0; raw[o+3] = 0; continue; }
      const c = inCross(x, y) ? white : brand;
      raw[o] = c[0]; raw[o+1] = c[1]; raw[o+2] = c[2]; raw[o+3] = 255;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [192, 512]) {
  const out = path.join(__dirname, `icon-${size}.png`);
  fs.writeFileSync(out, png(size));
  console.log('wrote', out);
}
