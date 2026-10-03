'use strict';

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

const { config } = require('./src/config');
const db = require('./src/db');
const { migrate } = require('./src/db/migrate');
const logger = require('./src/logger');

const { cookieParser } = require('./src/middleware/cookies');
const { securityHeaders, noCacheForPwa, noCors } = require('./src/middleware/security');
const { authenticate } = require('./src/middleware/auth');
const { AppError } = require('./src/middleware/error');
const validate = require('./src/middleware/validate');

const sessionsRepo = require('./src/repositories/sessions');
const settingsRepo = require('./src/repositories/settings');
const { NotificationEngine } = require('./src/notifications/engine');
const { TelegramClient } = require('./src/notifications/telegram');
const { createScheduler } = require('./src/scheduler');

const client = new TelegramClient();

const authRoutes = require('./src/routes/auth');
const courseRoutes = require('./src/routes/courses');
const taskRoutes = require('./src/routes/tasks');
const activityRoutes = require('./src/routes/activities');
const dashboardRoutes = require('./src/routes/dashboard');
const healthRoutes = require('./src/routes/health');
const settingsRoutes = require('./src/routes/settings');

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

db.open(config.dbFile);
const applied = migrate({ silent: true });
if (applied.length) logger.info('migrasi dijalankan', { applied });
sessionsRepo.purgeExpired();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use(securityHeaders);
app.use(noCors);
app.use(noCacheForPwa);
app.use(express.json({ limit: validate.MAX_BODY }));
app.use(cookieParser());

// Log request ringkas. Sengaja tanpa query string untuk tidak membocorkan
// nilai sensitif ke file log.
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    logger.request({ method: req.method, originalUrl: req.path }, res.statusCode, Math.round(ms));
  });
  next();
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

app.use('/api/auth', authRoutes);
app.use('/api/health', healthRoutes);

app.get('/api/time', (req, res) => {
  res.json({
    time: new Date().toISOString(),
    timezone: 'Asia/Jakarta',
  });
});

app.use('/api', authenticate);

app.use('/api/courses', courseRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);

// Endpoint operasional: jalankan satu siklus notifikasi di luar jadwal.
const engine = new NotificationEngine();
const scheduler = createScheduler({
  everyMinutes: 15,
  timezone: config.notify.timezone,
  job: () => engine.runOnce(),
});

app.post('/api/notify/run', async (req, res, next) => {
  try {
    const summary = await scheduler.runNow();
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

app.post('/api/notify/test', async (req, res, next) => {
  try {
    const result = await engine.sendTest();
    res.status(result.ok ? 200 : 502).json(result.ok
      ? { sent: true }
      : { error: { code: 'UPSTREAM_ERROR', message: result.description } });
  } catch (err) {
    next(err);
  }
});

app.get('/api/scheduler', (req, res) => {
  res.json({ scheduler: scheduler.status(), overdue: engine.overdueCount() });
});

// 404 untuk API: jawaban HTML untuk /api/* membuat debugging jauh lebih sulit.
app.use('/api', (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Endpoint ${req.method} ${req.path} tidak ada.` },
  });
});

// ---------------------------------------------------------------------------
// Static + fallback SPA
// ---------------------------------------------------------------------------

const staticOptions = {
  etag: true,
  maxAge: '1y',        // aset punya nama ber-hash / versi; aman di-cache lama
  index: 'index.html',
  setHeaders(res, filePath) {
    // index.html tidak boleh di-cache: PWA harus selalu dapat shell terbaru,
    // kalau tidak Service Worker bisa mengunci pengguna di UI versi lama.
    if (filePath.endsWith('index.html') || filePath.endsWith('offline.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
};

app.use(express.static(config.publicDir, staticOptions));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(config.publicDir, 'index.html'), (err) => {
    if (err) next(err);
  });
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  // SyntaxError dari express.json() = body JSON rusak.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'BAD_JSON', message: 'Body permintaan bukan JSON yang valid.' },
    });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Body permintaan terlalu besar.' },
    });
  }

  // SQLite: pesan error mentah bisa membocorkan nama kolom dan struktur
  // tabel, jadi yang dikirim ke client dibuat generik. Detailnya tetap
  // dicatat di log server.
  const isSqlite = /SQLITE_|database is locked|UNIQUE constraint|FOREIGN KEY/i.test(err.message || '');
  if (isSqlite) {
    logger.error('kesalahan database', { error: err.message, sql: err.sql });
    return res.status(500).json({
      error: { code: 'DB_ERROR', message: 'Operasi database gagal.' },
    });
  }

  logger.error('error tidak tertangani', { error: err.message, stack: err.stack, path: req.path });
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: config.isProduction
        ? 'Terjadi kesalahan pada server.'
        : `Kesalahan: ${err.message}`,
    },
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let shuttingDown = false;
let server = null;
let poller = null;

/**
 * Konsumsi sekali pakai kode tautan yang dikirim lewat /start <kode>.
 * Kode yang terdaftar (via PUT /api/settings) disimpan sebagai JSON
 * { code, expires }. Setelah cocok, kode dihapus agar tidak dipakai lagi.
 *
 * @param {number|undefined} chatId
 * @param {string} code
 * @param {string} label
 * @returns {Promise<boolean>}
 */
async function consumeLinkCode(chatId, code, label) {
  if (!chatId) return false;

  const stored = settingsRepo.get(settingsRepo.KEYS.TELEGRAM_LINK_CODE);
  if (!stored) return false;

  let payload;
  try {
    payload = JSON.parse(stored);
  } catch {
    return false;
  }

  const expiresAt = Number(payload.expires) || 0;
  if (Date.now() > expiresAt) {
    settingsRepo.remove(settingsRepo.KEYS.TELEGRAM_LINK_CODE);
    logger.warn('kode tautan Telegram kadaluwarsa', { label });
    return false;
  }

  if (String(payload.code) !== String(code)) {
    logger.warn('kode tautan Telegram salah', {
      label,
      provided: (code || '').slice(0, 2) + '****',
    });
    return false;
  }

  settingsRepo.set(settingsRepo.KEYS.TELEGRAM_CHAT_ID, String(chatId));
  settingsRepo.set(settingsRepo.KEYS.TELEGRAM_CHAT_LABEL, label);
  settingsRepo.remove(settingsRepo.KEYS.TELEGRAM_LINK_CODE);
  logger.info('Telegram terhubung', { chatLabel: label });
  return true;
}

async function startTelegramPoller() {
  if (!client.enabled) {
    logger.warn('Telegram nonaktif: TELEGRAM_BOT_TOKEN kosong, notifikasi dinonaktifkan.');
    return;
  }

  let offset = 0;
  let active = false;

  const poll = async () => {
    if (active) {
      logger.warn('polling Telegram: request sebelumnya belum selesai, lewatkan cycle ini');
      return;
    }
    active = true;
    try {
      const updates = await client.getUpdates({ offset, timeoutSeconds: 30, limit: 10, waitTime: true });
      if (!updates.ok || !Array.isArray(updates.result)) {
        logger.warn('getUpdates merespons dengan', updates.ok ? updates.result?.length : updates.description);
        return;
      }

      for (const update of updates.result) {
        const timestamp = Date.now();
        offset = update.update_id + 1;
        const message = update.message || update.edited_message;
        const text = (message?.text || '').trim();
        const match = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9]{4,16}))?$/.exec(text);
        if (!match || !message?.chat) continue;

        const linked = await consumeLinkCode(
          message.chat.id,
          (match[1] || '').toUpperCase(),
          [message.chat.title, message.chat.username, message.from?.first_name]
            .filter(Boolean).join(' / ')
        );

        const reply = linked
          ? '\u{2705} CampusFlow terhubung. Notifikasi deadline akan dikirim ke sini.'
          : '\u{274C} Kode tidak dikenal atau sudah kedaluwarsa. Buat kode baru di halaman Pengaturan.';

        const sent = await client.sendMessage(message.chat.id, reply, {
          disableNotification: !linked,
        });
        logger.info('reply /start dikirim', {
          ok: sent.ok,
          description: sent.description,
          delayMs: timestamp ? Date.now() - timestamp : 'n/a',
        });
        if (!sent.ok && sent.description) {
          logger.warn('sendMessage ke Telegram gagal', { description: sent.description });
        }
      }
    } catch (err) {
      logger.warn('polling Telegram gagal', { error: err.name, message: err.message });
    } finally {
      active = false;
    }
  };

  const loop = async () => {
    await poll();
    if (!shuttingDown) {
      poller = setTimeout(loop, 5000);
    }
  };

  loop();
  logger.info('polling Telegram aktif (long-polling, timeout=30, wait_time=true)');
}

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown diminta', { signal });

  scheduler.stop();
  if (poller) clearInterval(poller);

  const hardExit = setTimeout(() => {
    logger.error('shutdown paksa setelah 10 detik');
    process.exit(1);
  }, 10_000);
  hardExit.unref();

  const finish = () => {
    try {
      db.close();
      logger.info('database ditutup dengan bersih');
    } catch (err) {
      logger.error('gagal menutup database', { error: err.message });
    }
    process.exit(0);
  };

  if (server) server.close(finish);
  else finish();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});

if (!fs.existsSync(path.join(config.publicDir, 'index.html'))) {
  logger.error('public/index.html tidak ditemukan - build PWA dulu.');
}

server = app.listen(config.port, config.host, () => {
  logger.info('CampusFlow siap', {
    url: `http://${config.host}:${config.port}`,
    env: config.env,
    db: config.dbFile,
    telegram: client.enabled ? 'aktif' : 'nonaktif',
    notifikasi: config.notify.thresholdsHours.map((h) => `H-${h}`).join(' / '),
    timezone: config.notify.timezone,
  });
  if (config.host === '0.0.0.0') {
    logger.warn('HOST=0.0.0.0: aplikasi terekspos ke jaringan. Pastikan hanya jaringan rumah/kampus yang terhubung.');
  }
});

scheduler.start();
startTelegramPoller();

module.exports = { app, engine, scheduler, settingsRepo, client };