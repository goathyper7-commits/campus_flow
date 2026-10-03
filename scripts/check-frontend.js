'use strict';

/**
 * Pemeriksaan konsistensi untuk aset frontend.
 *
 * Menangkap kelas-kesalahan yang lolos dari build Tailwind dan Selective
 * Test tapi fatal saat dipakai: CJK nyasar, inline script/style yang dilarang
 * CSP, kelas k-warna yang tidak ada di CSS, dan handler tanpa catcher.
 *
 *   node scripts/check-frontend.js
 */

const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const problems = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
}

const files = {
  html: read('index.html'),
  sw: read('sw.js'),
  css: fs.existsSync(path.join(PUBLIC, 'css/styles.css')) ? read('css/styles.css') : '',
  src: read('css/tailwind.src.css'),
  manifest: read('manifest.json'),
  js: fs.existsSync(path.join(PUBLIC, 'js'))
    ? fs.readdirSync(path.join(PUBLIC, 'js'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => ({ name: `js/${f}`, text: read(`js/${f}`) }))
    : [],
};

// --- 1. Karakter CJK / replacement, tanda penulisan yang terputus ---------
for (const [name, text] of [['index.html', files.html], ...files.js.map((f) => [f.name, f.text])]) {
  text.split(/\r?\n/).forEach((line, i) => {
    if (/[\u4e00-\u9fff\ufffd]/.test(line)) {
      problems.push(`${name}:${i + 1} karakter CJK/replacement: ${line.trim().slice(0, 90)}`);
    }
  });
}

// --- 2. CSP: tidak boleh ada script/style inline --------------------------
const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>/.exec(files.html);
if (inlineScript) problems.push(`index.html: <script> inline melanggar CSP: ${inlineScript[0]}`);
if (/\son\w+\s*=/.test(files.html)) {
  problems.push('index.html: atribut event handler inline (onclick=) melanggar CSP');
}
if (/\sstyle\s*=\s*"/.test(files.html)) {
  problems.push('index.html: style inline melanggar CSP (warna harus lewat kelas k-warna-N)');
}

// --- 3. Aset yang dirujuk harus benar-benar ada --------------------------
const refs = [...files.html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
for (const ref of new Set(refs)) {
  if (!fs.existsSync(path.join(PUBLIC, ref))) {
    problems.push(`index.html: aset ${ref} tidak ditemukan`);
  }
}

// --- 4. Manifest harus konsisten dengan file ikon -----------------------
try {
  const manifest = JSON.parse(files.manifest);
  for (const icon of manifest.icons || []) {
    if (!fs.existsSync(path.join(PUBLIC, icon.src))) {
      problems.push(`manifest.json: ikon ${icon.src} tidak ditemukan`);
    }
  }
  if (!manifest.start_url || !manifest.display) {
    problems.push('manifest.json: start_url atau display wajib diisi');
  }
} catch (err) {
  problems.push(`manifest.json tidak valid: ${err.message}`);
}

// --- 5. Kelas k-warna-N harus lengkap di CSS ----------------------------
// Kelas dipakai lewat template literal (`k-warna-${i}`) jadi tidak terlihat
// sebagai string utuh di sumber; yang diperiksa adalah kelengkapan 0..7.
if (files.css) {
  for (let i = 0; i < 8; i += 1) {
    if (!new RegExp(`\\.k-warna-${i}\\b`).test(files.css)) {
      problems.push(`styles.css: kelas .k-warna-${i} tidak ada, tapi dipakai untuk warna mata kuliah`);
    }
  }
  for (const name of ['k-warna-bulu', 'k-warna-teks', 'k-warna-lembut']) {
    if (!files.css.includes(`.${name}`)) problems.push(`styles.css: kelas .${name} tidak ada`);
  }
} else {
  problems.push('public/css/styles.css belum ada - jalankan: npm run build:css');
}

// --- 6. Service worker harus menyertakan app shell ----------------------
if (!files.sw) {
  problems.push('public/sw.js tidak ditemukan');
} else {
  if (!/APP_SHELL|app-shell|precache/i.test(files.sw)) {
    problems.push('sw.js: tidak ada daftar precache - offline akan gagal');
  }
  if (/['"]\s*(GET|POST)['"]\s*,\s*['"]\/api/.test(files.sw) === false && !/apiIsNeverCached|skipApi|!/i.test(files.sw)) {
    warnings.push('sw.js: pastikan request /api tidak pernah masuk cache tulis');
  }
if (/self\.skipWaiting\(\)/.test(files.sw)
      && !/addEventListener\(\s*['"]message['"]/.test(files.sw)) {
    problems.push('sw.js: skipWaiting() dipanggil tanpa handler message - versi bisa menimpa form yang sedang diisi');
  }
}

// --- 7. Pola rawan di JS ----------------------------------------------
for (const { name, text } of files.js) {
  if (/\.innerHTML\s*=/.test(text)) {
    problems.push(`${name}: memakai innerHTML - gunakan el() dari ui.js untuk mencegah XSS`);
  }
  for (const m of text.matchAll(/addEventListener\((['"])([a-z]+)\1/g)) {
    const handler = text.slice(m.index, m.index + 300);
    if (!/async|then|\.catch|try\s*\{/.test(handler) && /await|fetch\(/.test(text.slice(0, m.index).slice(-200))) {
      warnings.push(`${name}: handler ${m[2]} memanggil await tanpa catcher`);
    }
  }
  if (/innerText\s*=/.test(text)) warnings.push(`${name}: gunakan textContent, bukan innerText`);
}

// --- Laporan --------------------------------------------------------------
console.log('\nPemeriksaan frontend\n' + '-'.repeat(46));
if (warnings.length) {
  console.log('\nPeringatan:');
  warnings.forEach((w) => console.log('  ~ ' + w));
}
if (problems.length) {
  console.log('\nMasalah:');
  problems.forEach((p) => console.log('  x ' + p));
  console.log(`\nGAGAL: ${problems.length} masalah.\n`);
  process.exitCode = 1;
} else {
  console.log('\nOK: tidak ada masalah yang terdeteksi.\n');
}
