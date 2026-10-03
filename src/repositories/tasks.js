'use strict';

const db = require('../db');

const PRIORITIES = ['rendah', 'sedang', 'tinggi'];
const STATUSES = ['todo', 'progress', 'selesai'];

// Kolom yang boleh masuk lewat API. Deadline tidak ada di sini karena perlu
// perlakuan khusus: format tervalidasi + auto-reset notify_stage.
const FIELDS = {
  course_id: 'course_id',
  judul: 'judul',
  deskripsi: 'deskripsi',
  prioritas: 'prioritas',
  status: 'status',
};

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    course_id: row.course_id,
    course_nama: row.course_nama ?? undefined,
    course_warna: row.course_warna ?? undefined,
    judul: row.judul,
    deskripsi: row.deskripsi ?? '',
    deadline: row.deadline,
    prioritas: row.prioritas,
    status: row.status,
    notify_stage: row.notify_stage,
    completed_at: row.completed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// JOIN statt SELECT * supaya tidak pernah ada kebocoran kolom tak terduga.
const BASE_SELECT = `
  SELECT t.id, t.course_id, t.judul, t.deskripsi, t.deadline, t.prioritas,
         t.status, t.notify_stage, t.completed_at, t.created_at, t.updated_at,
         c.nama AS course_nama, c.warna AS course_warna
    FROM tasks t
    JOIN courses c ON c.id = t.course_id
`;

function list(filters = {}) {
  const where = [];
  const args = [];

  if (filters.status && STATUSES.includes(filters.status)) {
    where.push('t.status = ?');
    args.push(filters.status);
  }
  if (filters.course_id != null) {
    where.push('t.course_id = ?');
    args.push(filters.course_id);
  }
  if (filters.from) {
    where.push('t.deadline >= ?');
    args.push(filters.from);
  }
  if (filters.to) {
    where.push('t.deadline < ?');
    args.push(filters.to);
  }
  if (filters.overdue) {
    where.push("t.status != 'selesai' AND t.deadline < ?");
    args.push(db.nowIso());
  }
  if (filters.open) {
    where.push("t.status != 'selesai'");
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.all(`${BASE_SELECT} ${clause} ORDER BY t.deadline ASC`, ...args);
  return rows.map(shape);
}

function findById(id) {
  return shape(db.getOne(`${BASE_SELECT} WHERE t.id = ?`, id));
}

function create(data) {
  const now = db.nowIso();
  const result = db.run(
    `INSERT INTO tasks
       (course_id, judul, deskripsi, deadline, prioritas, status, notify_stage, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    data.course_id,
    data.judul,
    data.deskripsi ?? '',
    data.deadline,
    data.prioritas ?? 'sedang',
    data.status ?? 'todo',
    now,
    now
  );
  return findById(Number(result.lastInsertRowid));
}

/**
 * Memperbarui satu tugas.
 *
 * notify_stage di-reset ke 0 kalau deadline berubah. Tanpa ini, flag yang
 * sudah terisi membuat engine notifikasi buta terhadap pergeseran jadwal -
 * persis kelemahan flag is_notified di blueprint asli.
 */
function update(id, data) {
  const existing = findById(id);
  if (!existing) return null;

  const deadlineChanged = Object.prototype.hasOwnProperty.call(data, 'deadline')
    && data.deadline !== existing.deadline;

  const entries = [];
  const values = [];

  for (const [key, column] of Object.entries(FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
      entries.push(`${column} = ?`);
      values.push(data[key]);
    }
  }

  if (deadlineChanged) {
    entries.push('notify_stage = 0');
  }

  const statusChanged = Object.prototype.hasOwnProperty.call(data, 'status')
    && data.status !== existing.status;
  if (statusChanged) {
    entries.push('completed_at = ?');
    values.push(data.status === 'selesai' ? db.nowIso() : null);
  }

  if (entries.length === 0) return existing;

  db.run(
    `UPDATE tasks SET ${entries.join(', ')}, updated_at = ? WHERE id = ?`,
    ...values,
    db.nowIso(),
    id
  );
  return findById(id);
}

function setStatus(id, status) {
  return update(id, { status });
}

function remove(id) {
  const result = db.run('DELETE FROM tasks WHERE id = ?', id);
  return Number(result.changes) > 0;
}

function advanceNotifyStage(id, stage) {
  db.run('UPDATE tasks SET notify_stage = ? WHERE id = ?', stage, id);
}

/**
 * Kandidat notifikasi untuk satu siklus cron.
 *
 * `maxTier` = indeks tier terakhir (jumlah threshold - 1). `maxHours` =
 * jendela terluar dalam jam sebelum deadline.
 *
 * Query memakai julianday, bukan perbandingan string ISO, supaya tidak
 * bergantung pada format dan tidak terkena kesalahan zona waktu.
 */
function findNotifyCandidates(maxTier, maxHours) {
  const rows = db.all(
    `SELECT t.id, t.course_id, t.judul, t.deskripsi, t.deadline, t.prioritas,
            t.status, t.notify_stage,
            c.nama AS course_nama, c.warna AS course_warna
       FROM tasks t
       JOIN courses c ON c.id = t.course_id
      WHERE t.status != 'selesai'
        AND t.notify_stage < ?
        AND julianday(t.deadline) > julianday('now')
        AND julianday(t.deadline) <= julianday('now', ?)`,
    maxTier,
    `+${maxHours} hours`
  );
  return rows.map((row) => ({
    ...shape(row),
    hours_left: (Date.parse(row.deadline) - Date.now()) / 3_600_000,
  }));
}

module.exports = {
  PRIORITIES,
  STATUSES,
  list,
  findById,
  create,
  update,
  setStatus,
  remove,
  advanceNotifyStage,
  findNotifyCandidates,
};
