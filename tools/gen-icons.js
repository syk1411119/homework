// 生成透明多尺寸 APP 图标（PNG）：node tools/gen-icons.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets');

// ---- PNG 编码 ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const tb = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0); return Buffer.concat([len, tb, data, crc]); }
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4 + 1; const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const C1 = hex('#2563eb'), C2 = hex('#7c3aed');

function distSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay, apx = px - ax, apy = py - ay;
  const den = abx * abx + aby * aby;
  let t = den ? (apx * abx + apy * aby) / den : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * abx - px, ay + t * aby - py);
}
function inRR(px, py, size, r) {
  const hw = size / 2, qx = Math.abs(px - hw), qy = Math.abs(py - hw);
  const dx = qx - (hw - r), dy = qy - (hw - r);
  if (dx <= 0 || dy <= 0) return true;
  return (dx * dx + dy * dy) <= r * r;
}

function render(size, opts) {
  const rgba = Buffer.alloc(size * size * 4);
  const r = Math.round(size * 0.21875);
  const A = [0.305 * size, 0.531 * size], B = [0.4375 * size, 0.664 * size], C = [0.703 * size, 0.383 * size];
  const th = 0.1016 * size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x + 0.5, py = y + 0.5;
    const inside = opts.full ? true : inRR(px, py, size, r);
    const i = (y * size + x) * 4;
    if (!inside) { rgba[i + 3] = 0; continue; }
    const g = (x + y) / (2 * (size - 1));
    rgba[i] = Math.round(C1[0] + (C2[0] - C1[0]) * g);
    rgba[i + 1] = Math.round(C1[1] + (C2[1] - C1[1]) * g);
    rgba[i + 2] = Math.round(C1[2] + (C2[2] - C1[2]) * g);
    rgba[i + 3] = 255;
    const d = Math.min(distSeg(px, py, A[0], A[1], B[0], B[1]), distSeg(px, py, B[0], B[1], C[0], C[1]), Math.hypot(px - A[0], py - A[1]), Math.hypot(px - C[0], py - C[1]));
    if (d <= th) { rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255; }
  }
  return encodePNG(size, size, rgba);
}

const jobs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { full: true }],
  ['apple-touch-icon.png', 180, { full: true }],
  ['favicon-32.png', 32, {}],
  ['favicon-16.png', 16, {}],
];
for (const [name, size, opts] of jobs) {
  fs.writeFileSync(path.join(OUT, name), render(size, opts));
  console.log('✅', name, `${size}x${size}`);
}
