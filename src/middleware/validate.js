'use strict';

const { AppError } = require('./error');

const MAX_BODY = '32kb';

// ---------------------------------------------------------------------------
// Primitif validasi
//
// Semua request divalidasi di server, bukan hanya di client. Validasi
// client-side pada Activity Diagram blueprint bisa dilewati siapa saja yang
// memanggil API secara langsung, jadi setiap aturan di sini adalah batas
// yang benar-benar ditegakkan.
// ---------------------------------------------------------------------------

function str(value, field, { min = 0, max = 500, trim = true } = {}) {
  if (value === undefined || value === null) throw AppError.badRequest(`${field} wajib diisi.`);
  if (typeof value !== 'string') throw AppError.badRequest(`${field} harus berupa teks.`);
  const out = trim ? value.trim() : value;
  if (out.length < min) throw AppError.badRequest(`${field} minimal ${min} karakter.`);
  if (out.length > max) throw AppError.badRequest(`${field} maksimal ${max} karakter.`);
  // Tolak karakter kontrol: sumber klasik XSS dan tidak pernah dibutuhkan di sini.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(out)) {
    throw AppError.badRequest(`${field} mengandung karakter yang tidak diizinkan.`);
  }
  return out;
}

function optionalStr(value, field, opts = {}) {
  if (value === undefined || value === null) return '';
  return str(value, field, { min: 0, ...opts });
}

function enumOf(value, field, allowed, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw AppError.badRequest(`${field} wajib diisi.`);
  }
  if (!allowed.includes(value)) {
    throw AppError.badRequest(`${field} tidak valid.`, { received: value, allowed });
  }
  return value;
}

function int(value, field, { min = -Infinity, max = Infinity, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw AppError.badRequest(`${field} wajib diisi.`);
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n)) throw AppError.badRequest(`${field} harus berupa bilangan bulat.`);
  if (n < min || n > max) {
    throw AppError.badRequest(`${field} harus antara ${min} dan ${max}.`);
  }
  return n;
}

function idParam(value, field = 'id') {
  return int(value, field, { min: 1, max: Number.MAX_SAFE_INTEGER });
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Menerima input tanggal lalu mengembalikan ISO-8601 UTC.
 * Semua nilai disimpan UTC; konversi ke waktu lokal hanya di presentation.
 */
function isoDate(value, field, { allowPast = false } = {}) {
  if (value === undefined || value === null || value === '') {
    throw AppError.badRequest(`${field} wajib diisi.`);
  }
  if (typeof value !== 'string' && !(value instanceof Date)) {
    throw AppError.badRequest(`${field} harus berupa tanggal.`);
  }
  const raw = typeof value === 'string' ? value.trim() : value.toISOString();
  if (!ISO_RE.test(raw)) {
    throw AppError.badRequest(`${field} tidak valid. Gunakan format YYYY-MM-DDTHH:MM.`);
  }
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) throw AppError.badRequest(`${field} tidak valid.`);
  if (!allowPast && ts < Date.now() - 60_000) {
    throw AppError.badRequest(`${field} tidak boleh di masa lalu.`);
  }
  return new Date(ts).toISOString();
}

// ---------------------------------------------------------------------------
// Palet warna tertutup
//
// Bukan sekadar soal estetika: CSP ketat melarang atribut style inline,
// sehingga warna harus datang dari kelas CSS yang sudah ada di build.
// Menerima hex bebas berarti harus melonggarkan CSP atau menyuntikkan style
// inline, dan keduanya lebih buruk daripada membatasi ke 8 pilihan warna.
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899',
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function hexColor(value, field, fallback = COLOR_PALETTE[0]) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !HEX_COLOR.test(value.trim())) {
    throw AppError.badRequest(`${field} harus format warna #rrggbb.`);
  }
  const normalized = value.trim().toLowerCase();
  if (!COLOR_PALETTE.includes(normalized)) {
    throw AppError.badRequest(`${field} harus salah satu dari palet CampusFlow.`, {
      allowed: COLOR_PALETTE,
    });
  }
  return normalized;
}

/** Indeks palet untuk kelas CSS, mis. '#0ea5e9' -> 'k-warna-1'. */
function colorClass(hex) {
  const index = COLOR_PALETTE.indexOf(String(hex || '').toLowerCase());
  return `k-warna-${index < 0 ? 0 : index}`;
}

/** Body harus berupa object. Menolak array/string/null mencegah mass-assign. */
function objectBody(req) {
  if (req.body === undefined || req.body === null) return {};
  if (typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw AppError.badRequest('Body permintaan harus berupa objek JSON.');
  }
  return req.body;
}

function rejectUnknownKeys(body, allowed, label) {
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw AppError.badRequest(`Field tidak dikenal: ${unknown.join(', ')}.`, { allowed, label });
  }
}

module.exports = {
  AppError,
  MAX_BODY,
  COLOR_PALETTE,
  colorClass,
  str,
  optionalStr,
  enumOf,
  int,
  idParam,
  isoDate,
  hexColor,
  objectBody,
  rejectUnknownKeys,
};
