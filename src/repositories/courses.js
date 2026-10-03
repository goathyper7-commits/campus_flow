'use strict';

const db = require('../db');

const COLUMNS = 'id, nama, dosen, sks, hari, jam_mulai, jam_selesai, warna, created_at, updated_at';

const FIELDS = {
  nama: 'nama',
  dosen: 'dosen',
  sks: 'sks',
  hari: 'hari',
  jam_mulai: 'jam_mulai',
  jam_selesai: 'jam_selesai',
  warna: 'warna',
};

/**
 * Kolom dipetakan lewat objek FIELDS, bukan lewat interpolasi nama kolom
 * dari request. Menyisipkan nama kolom mentah ke SQL adalah lubang SQL
 * injection; whitelist menutupnya secara struktural.
 */
function mapColumns(input) {
  const entries = [];
  const values = [];
  for (const [key, column] of Object.entries(FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) {
      entries.push(`${column} = ?`);
      values.push(input[key]);
    }
  }
  return { entries, values };
}

function list() {
  return db.all(`SELECT ${COLUMNS} FROM courses ORDER BY nama COLLATE NOCASE ASC`);
}

function findById(id) {
  return db.getOne(`SELECT ${COLUMNS} FROM courses WHERE id = ?`, id);
}

function create(data) {
  const now = db.nowIso();
  const result = db.run(
    `INSERT INTO courses (nama, dosen, sks, hari, jam_mulai, jam_selesai, warna, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    data.nama,
    data.dosen ?? '',
    data.sks ?? 0,
    data.hari ?? '',
    data.jam_mulai ?? '',
    data.jam_selesai ?? '',
    data.warna ?? '#6366f1',
    now,
    now
  );
  return findById(Number(result.lastInsertRowid));
}

function update(id, data) {
  const { entries, values } = mapColumns(data);
  if (entries.length === 0) return findById(id);

  return db.transaction(() => {
    db.run(
      `UPDATE courses SET ${entries.join(', ')}, updated_at = ? WHERE id = ?`,
      ...values,
      db.nowIso(),
      id
    );
    return findById(id);
  });
}

/**
 * ON DELETE CASCADE di skema ikut menghapus tugas. Ini keputusan yang
 * disengaja: Blueprint menyebut "Kelola Data Mata Kuliah", dan tugas tanpa
 * induk mata kuliah adalah data yatim yang tidak bisa ditampilkan tanpa
 * tebakan.
 */
function remove(id) {
  const result = db.run('DELETE FROM courses WHERE id = ?', id);
  return Number(result.changes) > 0;
}

module.exports = { list, findById, create, update, remove };
