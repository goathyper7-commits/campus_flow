'use strict';

/**
 * Generator ikon PWA tanpa dependency gambar.
 *
 * Menulis PNG dari nol lebih masuk akal daripada menarik sharp/canvas: yang
 * dibutuhkan cuma segitiga würstel + satu glyph checklist, dan zlib sudah
 * ada di Node. Ikon di-render 4x lalu di-downsample (supersampling), jadi
 * tepinya halus tanpa perlu filter.
 *
 *   npm run icons
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');
const SS = 4; // faktor supersampling

// ---------------------------------------------------------------------------
// Encoder PNG (RGB, 8-bit)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgb) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type 2 = truecolor RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Setiap baris scanline diawali byte filter (0 = None).
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Bentuk dasar (semua di koordinat 0..1)
// ---------------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function inRoundRect(x, y, rx, ry, rw, rh, radius) {
  if (x < rx || y < ry || x > rx + rw || y > ry + rh) return false;
  const cx = Math.min(Math.max(x, rx + radius), rx + rw - radius);
  const cy = Math.min(Math.max(y, ry + radius), ry + rh - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
}

/** Garis tebal dari (ax,ay) ke (bx,by); dipakai untuk gambar centang. */
function nearSegment(x, y, ax, ay, bx, by, halfWidth) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : clamp01(((x - ax) * dx + (y - ay) * dy) / lenSq);
  const px = ax + t * dx;
  const py = ay + t * dy;
  return (x - px) ** 2 + (y - py) ** 2 <= halfWidth * halfWidth;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Render ikon
// ---------------------------------------------------------------------------

const GRADIENT_FROM = [99, 102, 241];  // indigo-500
const GRADIENT_TO = [139, 92, 246];    // violet-500

/**
 * @param {number} size      ukuran akhir (piksel)
 * @param {boolean} maskable true -> latar penuh, konten di dalam safe zone 80%
 */
function renderIcon(size, { maskable = false } = {}) {
  const big = size * SS;
  const acc = new Float32Array(big * big * 3);

  // Untuk maskable, ikon boleh terpotong tepi, jadi latar menutup 100% dan
  // konten dikecilkan ke 78% (safe zone yang disarankan Android).
  const bgSize = maskable ? 1 : 0.94;
  const bgRadius = maskable ? 0 : 0.235;
  const contentScale = maskable ? 0.62 : 1;

  // Tiga baris checklist; baris pendek meniru hierarki.
  const rows = [
    { y: 0.335, barEnd: 0.775, check: 1 },
    { y: 0.500, barEnd: 0.700, check: 1 },
    { y: 0.665, barEnd: 0.790, check: 0 },
  ];

  const glyph = {
    boxX: 0.235,
    boxSize: 0.098,
    barX: 0.385,
    barH: 0.052,
    stroke: 0.026,
  };

  for (let py = 0; py < big; py += 1) {
    const y = (py + 0.5) / big;
    for (let px = 0; px < big; px += 1) {
      const x = (px + 0.5) / big;
      const i = (py * big + px) * 3;

      // Latar: rounded square dengan gradien diagonal.
      const inBg = maskable
        ? true
        : inRoundRect(x, y, (1 - bgSize) / 2, (1 - bgSize) / 2, bgSize, bgSize, bgRadius);
      if (!inBg) {
        acc[i] = acc[i + 1] = acc[i + 2] = 0;
        continue;
      }

      const t = clamp01((x + y) / 2);
      let r = lerp(GRADIENT_FROM[0], GRADIENT_TO[0], t);
      let g = lerp(GRADIENT_FROM[1], GRADIENT_TO[1], t);
      let b = lerp(GRADIENT_FROM[2], GRADIENT_TO[2], t);

      // Konten digeser ke tengah dan diperkecil untuk mode maskable.
      const cx = 0.5 + (x - 0.5) / contentScale;
      const cy = 0.5 + (y - 0.5) / contentScale;

      if (cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1) {
        const white = 255;

        for (const row of rows) {
          const boxY = row.y - glyph.boxSize / 2;
          // Kotak centang: outline tebal, isian mengikuti latar.
          if (inRoundRect(cx, cy, glyph.boxX, boxY, glyph.boxSize, glyph.boxSize, 0.022)) {
            const inner = inRoundRect(
              cx, cy,
              glyph.boxX + glyph.stroke, boxY + glyph.stroke,
              glyph.boxSize - glyph.stroke * 2, glyph.boxSize - glyph.stroke * 2,
              0.012
            );
            if (!inner) { r = g = b = white; }
          }

          // Garis judul di sebelah kanan.
          const barY = row.y - glyph.barH / 2;
          if (inRoundRect(cx, cy, glyph.barX, barY, row.barEnd - glyph.barX, glyph.barH, glyph.barH / 2)) {
            r = g = b = white;
          }

          // Tanda centang di dalam kotak.
          if (row.check) {
            const ax = glyph.boxX + glyph.boxSize * 0.24;
            const ay = boxY + glyph.boxSize * 0.52;
            const mx = glyph.boxX + glyph.boxSize * 0.44;
            const my = boxY + glyph.boxSize * 0.74;
            const bx = glyph.boxX + glyph.boxSize * 0.80;
            const by = boxY + glyph.boxSize * 0.24;
            if (nearSegment(cx, cy, ax, ay, mx, my, glyph.stroke * 0.42)
              || nearSegment(cx, cy, mx, my, bx, by, glyph.stroke * 0.42)) {
              r = g = b = white;
            }
          }
        }
      }

      acc[i] = r;
      acc[i + 1] = g;
      acc[i + 2] = b;
    }
  }

  // Downsample SS x SS -> 1 piksel (rata-rata = antialiasing).
  const out = Buffer.alloc(size * size * 3);
  const area = SS * SS;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0; let g = 0; let b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * big + (x * SS + sx)) * 3;
          r += acc[i]; g += acc[i + 1]; b += acc[i + 2];
        }
      }
      const o = (y * size + x) * 3;
      out[o] = Math.round(r / area);
      out[o + 1] = Math.round(g / area);
      out[o + 2] = Math.round(b / area);
    }
  }

  return encodePng(size, size, out);
}

function generate() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const targets = [
    { file: 'icon-192.png', size: 192, options: {} },
    { file: 'icon-512.png', size: 512, options: {} },
    { file: 'icon-maskable-512.png', size: 512, options: { maskable: true } },
    { file: 'apple-touch-icon.png', size: 180, options: {} },
    { file: 'favicon.png', size: 64, options: {} },
  ];

  const written = [];
  for (const { file, size, options } of targets) {
    const png = renderIcon(size, options);
    const dest = path.join(OUT_DIR, file);
    fs.writeFileSync(dest, png);
    written.push({ file, size, kb: Math.round(png.length / 1024) });
    process.stdout.write(`  ${file.padEnd(26)} ${size}x${size}  ${Math.round(png.length / 1024)} KB\n`);
  }
  return written;
}

module.exports = { renderIcon, encodePng, generate };

if (require.main === module) {
  process.stdout.write('Membuat ikon PWA...\n');
  generate();
  process.stdout.write('Selesai.\n');
}
