-- CampusFlow :: migrasi 001 - skema awal
-- Semua timestamp disimpan sebagai ISO-8601 UTC ("2026-10-02T09:00:00.000Z").
-- Konversi ke waktu lokal hanya terjadi di layer presentasi.

CREATE TABLE courses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nama         TEXT    NOT NULL,
  dosen        TEXT    NOT NULL DEFAULT '',
  sks          INTEGER NOT NULL DEFAULT 0 CHECK (sks BETWEEN 0 AND 12),
  hari         TEXT    NOT NULL DEFAULT '',
  jam_mulai    TEXT    NOT NULL DEFAULT '',
  jam_selesai  TEXT    NOT NULL DEFAULT '',
  warna        TEXT    NOT NULL DEFAULT '#6366f1',
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE TABLE tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  judul        TEXT    NOT NULL,
  deskripsi    TEXT    NOT NULL DEFAULT '',
  -- Disimpan UTC. Perbandingan string pada tanggal lokal akan menggeser notifikasi beberapa jam.
  deadline     TEXT    NOT NULL,
  prioritas    TEXT    NOT NULL DEFAULT 'sedang'
                 CHECK (prioritas IN ('rendah', 'sedang', 'tinggi')),
  status       TEXT    NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo', 'progress', 'selesai')),
  -- Escalation 3 tingkat (lihat NOTIFY_THRESHOLDS):
  --   0 = belum pernah dinotifikasi, 1 = H-24, 2 = H-3, 3 = H-1 (terminal)
  -- Direset ke 0 setiap kali deadline berubah.
  notify_stage INTEGER NOT NULL DEFAULT 0 CHECK (notify_stage >= 0),
  completed_at TEXT,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

-- Cron men-scan berdasarkan deadline + tingkat notifikasi tiap 15 menit.
CREATE INDEX idx_tasks_deadline      ON tasks(deadline);
CREATE INDEX idx_tasks_notify_scan   ON tasks(status, notify_stage, deadline);
CREATE INDEX idx_tasks_course        ON tasks(course_id);
CREATE INDEX idx_tasks_status        ON tasks(status);

CREATE TABLE activities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nama         TEXT    NOT NULL,
  kategori     TEXT    NOT NULL DEFAULT '',
  tanggal      TEXT    NOT NULL,
  lokasi       TEXT    NOT NULL DEFAULT '',
  selesai      INTEGER NOT NULL DEFAULT 0 CHECK (selesai IN (0, 1)),
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE INDEX idx_activities_tanggal ON activities(tanggal);
CREATE INDEX idx_activities_selesai ON activities(selesai);

-- Key/value. Token bot TIDAK BOLEH disimpan di sini: nilainya diekspos ke
-- browser lewat /api/settings/public.
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE INDEX idx_sessions_expires ON sessions(expires_at);
