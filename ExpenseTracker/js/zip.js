/* Minimal dependency-free ZIP writer (STORE mode - no compression).
 *
 * JPEG/PNG attachments are already compressed, so we store them verbatim in a
 * standard .zip container. Produces a Blob that any unzip tool can open.
 *
 * Implements just enough of the ZIP spec: local file headers, central
 * directory, and end-of-central-directory record, with CRC-32 per entry.
 */

// --- CRC-32 (precomputed table) ---
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// DOS date/time from a JS Date.
function dosDateTime(date) {
  const d = date || new Date();
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const dt =
    (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: dt & 0xffff };
}

/**
 * Build a ZIP Blob from an array of files.
 * @param {Array<{name:string, data:Uint8Array}>} files
 * @returns {Blob} application/zip
 */
export function createZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];        // Uint8Array pieces of the whole archive
  const central = [];       // central directory records
  let offset = 0;           // running offset of local headers

  const push = (arr) => {
    chunks.push(arr);
    offset += arr.length;
  };

  const { time, date } = dosDateTime(new Date());

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const localOffset = offset;

    // ---- Local file header (30 bytes + name) ----
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // signature
    local.setUint16(4, 20, true);         // version needed
    local.setUint16(6, 0, true);          // flags
    local.setUint16(8, 0, true);          // method 0 = store
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);            // extra len
    push(new Uint8Array(local.buffer));
    push(nameBytes);
    push(data);

    // ---- Central directory record (46 bytes + name) ----
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);  // signature
    cd.setUint16(4, 20, true);          // version made by
    cd.setUint16(6, 20, true);          // version needed
    cd.setUint16(8, 0, true);           // flags
    cd.setUint16(10, 0, true);          // method
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);          // extra len
    cd.setUint16(32, 0, true);          // comment len
    cd.setUint16(34, 0, true);          // disk number
    cd.setUint16(36, 0, true);          // internal attrs
    cd.setUint32(38, 0, true);          // external attrs
    cd.setUint32(42, localOffset, true);
    central.push({ header: new Uint8Array(cd.buffer), name: nameBytes });
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    push(c.header);
    push(c.name);
    cdSize += c.header.length + c.name.length;
  }

  // ---- End of central directory ----
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);
  eocd.setUint16(20, 0, true);
  push(new Uint8Array(eocd.buffer));

  return new Blob(chunks, { type: 'application/zip' });
}
