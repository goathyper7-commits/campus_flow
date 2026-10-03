'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

require('dotenv').config({ path: path.join(ROOT, '.env') });

/**
 * Environment validation yang fail-fast.
 * Server TIDAK boleh boot dengan konfigurasi setengah jadi: bot token yang
 * hilang atau timezone yang keliru menghasilkan notifikasi yang salah,
 * dan itu jauh lebih sulit dideteksi daripada crash saat start.
 */
function fail(msg, hint) {
  process.stderr.write(`\n[campusflow] KONFIGURASI INVALID: ${msg}\n`);
  if (hint) process.stderr.write(`  -> ${hint}\n`);
  process.stderr.write('\nSalin .env.example menjadi .env lalu lengkapi.\n\n');
  process.exit(1);
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) fail(`${name} harus berupa bilangan bulat, ditemukan "${raw}".`);
  return n;
}

function listEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n <= 0)) {
    fail(`${name} harus berisi daftar jam positif, ditemukan "${raw}".`, 'Contoh: 24,3,1');
  }
  if (parts.length > 5) fail(`${name} maksimal 5 tingkat notifikasi.`);
  return [...parts].sort((a, b) => b - a); // terbesar ke terkecil: H-24, H-3, H-1
}

const PIN_HASH = (process.env.ADMIN_PIN_HASH || '').trim();
if (!PIN_HASH) {
  fail('ADMIN_PIN_HASH belum diisi.',
    'Buat hash PIN dulu:  npm run hash-pin -- <pin-anda>');
}
const PIN_PARTS = PIN_HASH.split('$');
if (PIN_PARTS.length !== 3 || PIN_PARTS[0] !== 'scrypt') {
  fail('Format ADMIN_PIN_HASH tidak valid.',
    'Harus berformat scrypt$saltHex$hashHex. Buat ulang dengan: npm run hash-pin -- <pin>');
}

// Validasi timezone sekarang, bukan saat notifikasi dikirim. Salah zona waktu
// = notifikasi meleset, dan itu bug senyap yang mahal.
const NOTIFY_TIMEZONE = (process.env.NOTIFY_TIMEZONE || 'Asia/Jakarta').trim();
try {
  new Intl.DateTimeFormat('id-ID', { timeZone: NOTIFY_TIMEZONE });
} catch {
  fail(`NOTIFY_TIMEZONE "${NOTIFY_TIMEZONE}" tidak dikenali oleh ICU.`,
    'Gunakan nama IANA, contoh: Asia/Jakarta');
}

const CRON_EXPRESSION = (process.env.NOTIFY_CRON || '*/15 * * * *').trim();
const CRON_OK = /^(\*|[0-9]+|[0-9]+-[0-9]+)(\/([0-9]+))?(,(\*|[0-9]+|[0-9]+-[0-9]+)(\/([0-9]+))?)*\s+(\*|[0-9]+|[0-9]+-[0-9]+)(\/([0-9]+))?(,(\*|[0-9]+|[0-9]+-[0-9]+)(\/([0-9]+))?)*\s+(\*|[0-9]+|[0-9]+-[0-9]+)(\/([0-9]+))?(,(\*|[0-9]+|[0-9]+-[0-9]+)(\/([0-9]+))?)*\s+(\*|[0-9]+|[0-9]+-[0-9]+)(\/([0-9]+))?(,(\*|[0-9]+|[0-9]+-[0-9]+)(\/([0-9]+))?)*\s+(\*|[0-9]+|[0-9]+-[0-9]+)(\/([0-9]+))?(,(\*|[0-9]+|[0-9]+-[0-9]+)(\/([0-9]+))?)*$/.exec(CRON_EXPRESSION);
if (!CRON_OK) {
  fail(`NOTIFY_CRON "${CRON_EXPRESSION}" bukan ekspresi cron 5-field yang valid.`,
    'Contoh: */15 * * * *');
}

const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
if (TELEGRAM_BOT_TOKEN && !/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(TELEGRAM_BOT_TOKEN)) {
  fail('TELEGRAM_BOT_TOKEN tidak berpola seperti token BotFather.',
    'Format: 123456789:AA... (teka-tekaan akan ditolak Telegram)');
}

const config = {
  root: ROOT,
  env: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  logLevel: (process.env.LOG_LEVEL || 'info').trim(),

  host: (process.env.HOST || '127.0.0.1').trim(),
  port: intEnv('PORT', 3000),

  dbFile: path.isAbsolute(process.env.DB_FILE || '')
    ? process.env.DB_FILE
    : path.join(ROOT, process.env.DB_FILE || 'data/campusflow.db'),
  publicDir: path.join(ROOT, 'public'),

  auth: {
    pinHash: PIN_HASH,
    sessionTtlMs: intEnv('SESSION_TTL_MS', 30 * 24 * 60 * 60 * 1000),
    loginRateLimit: intEnv('LOGIN_RATE_LIMIT', 8),
    loginRateWindowMs: intEnv('LOGIN_RATE_WINDOW_MS', 15 * 60 * 1000),
  },

  telegram: {
    token: TELEGRAM_BOT_TOKEN,
    chatId: (process.env.TELEGRAM_CHAT_ID || '').trim(),
    enabled: TELEGRAM_BOT_TOKEN.length > 0,
    apiBase: 'https://api.telegram.org',
    linkCodeTtlMs: 5 * 60 * 1000,
    maxRetries: 3,
    retryBaseDelayMs: 1000,
  },

  notify: {
    timezone: NOTIFY_TIMEZONE,
    cron: CRON_EXPRESSION,
    thresholdsHours: listEnv('NOTIFY_THRESHOLDS', [24, 3, 1]),
  },
};

/** Verifikasi PIN dengan perbandingan waktu-konstan. */
function verifyPin(pin) {
  const [scheme, saltHex, hashHex] = config.auth.pinHash.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  let actual;
  try {
    actual = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), expected.length);
  } catch {
    return false;
  }
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = { config, verifyPin, ROOT };
