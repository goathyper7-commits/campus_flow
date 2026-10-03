'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Pembungkus tipis di atas node:sqlite.
 *
 * Keputusan: memakai modul bawaan Node (>= 22.5) alih-alih sqlite3 /
 * better-sqlite3. Alasannya sesuai cetak biru "Zero Overhead": tidak ada
 * native compilation (yang butuh Visual Studio Build Tools di Windows),
 * tidak ada binding tambahan yang membengkak, dan RSS proses tetap di bawah
 * anggaran 80 MB.
 */

let db = null;
let stmtCache = new Map();

function open(file) {
  if (db) return db;

  fs.mkdirSync(path.dirname(file), { recursive: true });

  db = new DatabaseSync(file);

  // PRAGMA ini wajib, bukan opsional:
  // - foreign_keys default-nya OFF di SQLite, jadi ON DELETE CASCADE di
  //   skema akan diam-diam tidak berjalan tanpa baris ini.
  // - WAL membuat pembacaan tidak terblokir saat cron sedang menulis.
  // - busy_timeout mencegah SQLITE_BUSY saat dua request datang bersamaan.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
  `);

  return db;
}

function get() {
  if (!db) throw new Error('Database belum dibuka. Panggil open() lebih dulu.');
  return db;
}

/**
 * node:sqlite hanya menerima null/number/bigint/string/Uint8Array.
 * Kirim boolean apa adanya ke SQLite akan melempar TypeError, jadi setiap
 * nilai dinormalisasi di satu tempat.
 */
function normalize(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function normalizeArgs(args) {
  return args.map(normalize);
}

/** Statement di-cache: kompilasi SQL per panggilan mahal untuk cron 15 menit. */
function stmt(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = get().prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

function run(sql, ...args) {
  return stmt(sql).run(...normalizeArgs(args));
}

function get_(sql, ...args) {
  return stmt(sql).get(...normalizeArgs(args));
}

function all(sql, ...args) {
  return stmt(sql).all(...normalizeArgs(args));
}

/** fn => hasil | undefined, dibungkus transaksi. Rollback bila fn melempar. */
let txDepth = 0;
function transaction(fn) {
  const handle = get();
  // Re-entrant: SQLite tidak mengizinkan BEGIN di dalam BEGIN. Repository
  // boleh memanggil transaction() dari dalam transaction() lain.
  if (txDepth > 0) {
    txDepth += 1;
    try { return fn(); } finally { txDepth -= 1; }
  }
  handle.exec('BEGIN');
  txDepth = 1;
  try {
    const result = fn();
    handle.exec('COMMIT');
    return result;
  } catch (err) {
    try { handle.exec('ROLLBACK'); } catch { /* transaksi sudah tertutup */ }
    throw err;
  } finally {
    txDepth = 0;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function close() {
  if (!db) return;
  stmtCache.clear();
  try {
    // Merging WAL ke file utama supaya file .db bisa langsung dicadangkan.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch { /* database mungkin sudah ditutup */ }
  db.close();
  db = null;
}

module.exports = { open, get, run, all, getOne: get_, getMany: all, transaction, nowIso, close };
