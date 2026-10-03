'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { config } = require('./config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

/**
 * Rotasi log sederhana per hari. Berhenti menulis ke file kalau tidak
 * ada folder logs - jadi di produksi log ke PM2, di development ke console.
 */
let stream = null;
let streamDay = '';

function logFile() {
  const dir = path.join(config.root, 'logs');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    if (!stream || streamDay !== day) {
      if (stream) stream.end();
      stream = fs.createWriteStream(path.join(dir, `campusflow-${day}.log`), { flags: 'a' });
      streamDay = day;
      pruneOldLogs(dir);
    }
    return stream;
  } catch {
    return null; // tidak bisa menulis ke disk: jangan sampai request ikut gagal
  }
}

function pruneOldLogs(dir, keep = 14) {
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => /^campusflow-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort()
      .reverse();
    for (const old of files.slice(keep)) fs.unlinkSync(path.join(dir, old));
  } catch { /* gagal Trash file lama: tidak kritis */ }
}

function write(level, message, meta) {
  if (LEVELS[level] > threshold) return;
  const line = {
    t: new Date().toISOString(),
    level,
    msg: message,
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  };
  const text = JSON.stringify(line);

  if (level === 'error' || level === 'warn') process.stderr.write(`${text}\n`);
  else process.stdout.write(`${text}\n`);

  const out = logFile();
  if (out) out.write(`${text}\n`);
}

module.exports = {
  error: (m, meta) => write('error', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  info: (m, meta) => write('info', m, meta),
  debug: (m, meta) => write('debug', m, meta),
  request: (req, status, ms) => write(
    status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
    `${req.method} ${req.originalUrl} ${status}`,
    { ms, ua: req.headers?.['user-agent']?.slice(0, 120) }
  ),
};
