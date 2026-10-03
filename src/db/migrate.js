'use strict';

const fs = require('node:fs');
const path = require('node:path');
const db = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Migrasi yang bisa dijalankan berulang kali.
 * Tiap file .sql dijalankan sekali, dicatat di tabel schema_migrations,
 * dan dibungkus transaksi supaya kegagalan di tengah tidak meninggalkan
 * database setengah jadi.
 */
function migrate({ silent = false } = {}) {
  db.get().exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.all('SELECT name FROM schema_migrations').map((r) => r.name)
  );

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.get().exec(sql);
      db.run(
        'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
        file,
        db.nowIso()
      );
    });

    ran.push(file);
    if (!silent) process.stdout.write(`[campusflow] migrasi diterapkan: ${file}\n`);
  }

  return ran;
}

module.exports = { migrate };

if (require.main === module) {
  const { config } = require('../config');
  db.open(config.dbFile);
  const ran = migrate();
  process.stdout.write(ran.length
    ? `[campusflow] ${ran.length} migrasi baru diterapkan.\n`
    : '[campusflow] skema sudah terbaru.\n');
  db.close();
}
