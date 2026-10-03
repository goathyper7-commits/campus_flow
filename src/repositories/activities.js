'use strict';

const db = require('../db');

const FIELDS = {
  nama: 'nama',
  kategori: 'kategori',
  tanggal: 'tanggal',
  lokasi: 'lokasi',
  selesai: 'selesai',
};

const COLUMNS = 'id, nama, kategori, tanggal, lokasi, selesai, created_at, updated_at';

/** selesai disimpan sebagai 0/1 di DB, dikirim sebagai boolean ke client. */
function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    nama: row.nama,
    kategori: row.kategori ?? '',
    tanggal: row.tanggal,
    lokasi: row.lokasi ?? '',
    selesai: row.selesai === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function list(filters = {}) {
  const where = [];
  const args = [];

  if (filters.from) { where.push('tanggal >= ?'); args.push(filters.from); }
  if (filters.to) { where.push('tanggal < ?'); args.push(filters.to); }
  if (filters.done === true || filters.done === false) {
    where.push('selesai = ?');
    args.push(filters.done ? 1 : 0);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.all(`SELECT ${COLUMNS} FROM activities ${clause} ORDER BY tanggal ASC`, ...args);
  return rows.map(shape);
}

function findById(id) {
  return shape(db.getOne(`SELECT ${COLUMNS} FROM activities WHERE id = ?`, id));
}

function create(data) {
  const now = db.nowIso();
  const result = db.run(
    `INSERT INTO activities (nama, kategori, tanggal, lokasi, selesai, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    data.nama,
    data.kategori ?? '',
    data.tanggal,
    data.lokasi ?? '',
    data.selesai ? 1 : 0,
    now,
    now
  );
  return findById(Number(result.lastInsertRowid));
}

function update(id, data) {
  if (!findById(id)) return null;

  const entries = [];
  const values = [];
  for (const [key, column] of Object.entries(FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
      entries.push(`${column} = ?`);
      values.push(data[key]);
    }
  }
  if (entries.length === 0) return findById(id);

  db.run(
    `UPDATE activities SET ${entries.join(', ')}, updated_at = ? WHERE id = ?`,
    ...values,
    db.nowIso(),
    id
  );
  return findById(id);
}

function toggle(id) {
  const existing = findById(id);
  if (!existing) return null;
  db.run(
    'UPDATE activities SET selesai = ?, updated_at = ? WHERE id = ?',
    existing.selesai ? 0 : 1,
    db.nowIso(),
    id
  );
  return findById(id);
}

function remove(id) {
  const result = db.run('DELETE FROM activities WHERE id = ?', id);
  return Number(result.changes) > 0;
}

module.exports = { list, findById, create, update, toggle, remove };
