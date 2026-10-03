-- CampusFlow :: migrasi 002 - tabel notifikasi
-- Menyimpan catatan pengiriman notifikasi Telegram.
-- Setiap baris = satu catatan pending/sent/failed.
-- Unique key (chat_id, scheduled_at) mencegah pengiriman duplikat.

CREATE TABLE notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL,           -- 'task', 'course', 'activity', 'daily_digest', 'overdue'
  ref_id      INTEGER NOT NULL,           -- id tugas/mata kuliah/aktivitas
  chat_id     TEXT    NOT NULL,           -- chat_id Telegram yang menerima
  message     TEXT    NOT NULL,           -- pesan yang akan dikirim (sudah di-escape MarkdownV2)
  scheduled_at TEXT   NOT NULL,           -- waktu pengiriman (ISO-8601 WIB)
  status      TEXT    NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  UNIQUE (chat_id, scheduled_at)
);

CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_at);
CREATE INDEX idx_notifications_status    ON notifications(status);
CREATE INDEX idx_notifications_type_ref  ON notifications(type, ref_id);

-- Migrasi versi: 002