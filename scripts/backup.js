'use strict';

/**
 * Cadangan database memakai VACUUM INTO.
 *
 * Menyalin file .db mentah dengan fs.copyFile saat server masih berjalan
 * bisa menghasilkan salinan yang rusak - sedang ada penulisan di halaman
 * WAL yang belum di-merge. VACUUM INTO membuat salinan yang konsisten
 * dalam satu operasi baca snapshot, tanpa menghentikan server.
 *
 *   npm run backup
 */

const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/db');
const { config } = require('../src/config');
const logger = require('../src/logger');

const KEEP = Number(process.env.BACKUP_KEEP || 7);

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function prune(dir, keep = KEEP) {
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => /^campusflow-\d{4}-\d{2}-\d{2}T.*\.db$/.test(f))
      .sort()
      .reverse();
    const removed = files.slice(keep);
    for (const old of removed) fs.unlinkSync(path.join(dir, old));
    return removed.length;
  } catch {
    return 0;
  }
}

function backup({ dir, keep = KEEP, logger: log = logger } = {}) {
  const target = dir || path.join(config.root, 'data', 'backups');
  fs.mkdirSync(target, { recursive: true });

  const file = path.join(target, `campusflow-${stamp()}.db`);
  // VACUUM INTO menolak menimpa file yang sudah ada.
  if (fs.existsSync(file)) fs.unlinkSync(file);

  db.get().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

  const size = fs.statSync(file).size;
  const pruned = prune(target, keep);
  log.info('backup database selesai', {
    file: path.basename(file),
    sizeKb: Math.round(size / 1024),
    pruned,
  });

  return { file, size, pruned };
}

module.exports = { backup };

if (require.main === module) {
  db.open(config.dbFile);
  try {
    const result = backup({ dir: process.argv[2] });
    process.stdout.write(`[campusflow] backup: ${result.file}\n`);
    process.stdout.write(`[campusflow] ukuran: ${(result.size / 1024).toFixed(0)} KB\n`);
  } catch (err) {
    process.stderr.write(`[campusflow] backup gagal: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
