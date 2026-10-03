'use strict';

const crypto = require('node:crypto');
const db = require('../db');
const { config } = require('../config');

/**
 * Sesi login untuk single-user: satu token acak 32 byte yang disimpan di DB
 * dan dikirim sebagai cookie httpOnly. Tidak ada tabel user/password karena
 * tidak ada lebih dari satu pengguna - PIN yang diverifikasi terhadap hash
 * scrypt di .env sudah cukup, dan menambah tabel user hanya menambah surface
 * serang tanpa manfaat.
 */

const COOKIE_NAME = 'cf_session';

function purgeExpired() {
  db.run('DELETE FROM sessions WHERE expires_at <= ?', db.nowIso());
}

function create(ttlMs = config.auth.sessionTtlMs) {
  const id = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  db.run(
    'INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?)',
    id,
    now.toISOString(),
    expires.toISOString()
  );
  return { token: id, expiresAt: expires.toISOString() };
}

function findValid(token) {
  if (!token || typeof token !== 'string' || token.length > 128) return null;
  const row = db.getOne('SELECT id, expires_at FROM sessions WHERE id = ?', token);
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.run('DELETE FROM sessions WHERE id = ?', token);
    return null;
  }
  return row;
}

function destroy(token) {
  if (!token) return;
  db.run('DELETE FROM sessions WHERE id = ?', token);
}

function destroyAll() {
  db.run('DELETE FROM sessions');
}

module.exports = { COOKIE_NAME, purgeExpired, create, findValid, destroy, destroyAll };
