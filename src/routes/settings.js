'use strict';

const express = require('express');
const crypto = require('node:crypto');
const { config } = require('../config');
const { asyncHandler } = require('../middleware/error');
const { AppError } = require('../middleware/error');
const settingsRepo = require('../repositories/settings');
const { TelegramClient } = require('../notifications/telegram');
const logger = require('../logger');

const router = express.Router();
const client = new TelegramClient();

// ---------------------------------------------------------------------------
// Bantu fungsi
// ---------------------------------------------------------------------------

function formatWIB(iso) {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Jakarta',
    }).format(new Date(iso));
  } catch {
    const d = new Date(iso);
    return `${d.toLocaleDateString('id-ID')} - ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
}

// ---------------------------------------------------------------------------
// GET /api/settings/public - status publik (tidak memerlukan auth)
// ---------------------------------------------------------------------------

router.get('/public', asyncHandler(async (req, res) => {
  const values = settingsRepo.getMany([
    settingsRepo.KEYS.TELEGRAM_CHAT_ID,
    settingsRepo.KEYS.TELEGRAM_BOT_USERNAME,
    settingsRepo.KEYS.TELEGRAM_CHAT_LABEL,
    settingsRepo.KEYS.USERNAME,
  ]);

  return res.json({
    telegram: {
      ...settingsRepo.telegramStatus(),
      configured: client.enabled,
      linkTtlMinutes: Math.round(config.telegram.linkCodeTtlMs / 60000),
    },
    notify: {
      timezone: config.notify.timezone,
      thresholdsHours: config.notify.thresholdsHours,
    },
    username: values[settingsRepo.KEYS.USERNAME] || null,
  });
}));

// ---------------------------------------------------------------------------
// PUT /api/settings - update settings (username, telegram config)
// ---------------------------------------------------------------------------

router.put('/', asyncHandler(async (req, res) => {
  const body = req.body || {};

  // Update username
  if (body.username !== undefined) {
    const name = String(body.username || '').trim();
    if (name.length === 0) {
      throw AppError.badRequest('Nama wajib diisi.');
    }
    if (name.length > 30) {
      throw AppError.badRequest('Nama maksimal 30 karakter.');
    }
    settingsRepo.set(settingsRepo.KEYS.USERNAME, name);
  }

  // Update Telegram config
  if (body.telegramChatId !== undefined) {
    settingsRepo.set(settingsRepo.KEYS.TELEGRAM_CHAT_ID, body.telegramChatId);
  }
  if (body.telegramLinkCode !== undefined) {
    settingsRepo.set(settingsRepo.KEYS.TELEGRAM_LINK_CODE, body.telegramLinkCode);
  }
  if (body.telegramLinkExpires !== undefined) {
    settingsRepo.set(settingsRepo.KEYS.TELEGRAM_LINK_EXPIRES, body.telegramLinkExpires);
  }

  // Update thresholdOffsets jika ada (untuk kompatibilitas mundur)
  if (body.notifTugas !== undefined) {
    // Simpan sebagai string terpisah koma
    settingsRepo.set(settingsRepo.KEYS.NOTIFY_TIMEZONE, body.notifTugas);
  }

  res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// POST /settings/telegram/link - buat kode tautan sekali pakai (5 menit)
// ---------------------------------------------------------------------------

router.post('/telegram/link', asyncHandler(async (req, res) => {
  if (!client.enabled) {
    throw AppError.internalServerError('Telegram belum dikonfigurasi. Isi TELEGRAM_BOT_TOKEN.');
  }

  const code = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);

  const expiresAt = Date.now() + config.telegram.linkCodeTtlMs;
  settingsRepo.set(
    settingsRepo.KEYS.TELEGRAM_LINK_CODE,
    JSON.stringify({ code, expires: expiresAt })
  );

  const bot = await client.getMe();
  const botUsername = bot?.ok ? bot.result?.username : null;

  return res.json({
    code,
    expiresAt,
    botUsername,
    instructions: [
      `Buka @${botUsername || 'Notifikasi_CampusFlow_Bot'} di Telegram.`,
      `Kirim /start ${code} ke bot.`,
      `Kode ini sekali pakai dan berlaku 5 menit.`,
    ],
  });
}));

// ---------------------------------------------------------------------------
// DELETE /settings/telegram - putuskan koneksi Telegram
// ---------------------------------------------------------------------------

router.delete('/telegram', asyncHandler(async (req, res) => {
  settingsRepo.remove(settingsRepo.KEYS.TELEGRAM_CHAT_ID);
  settingsRepo.remove(settingsRepo.KEYS.TELEGRAM_CHAT_LABEL);
  settingsRepo.remove(settingsRepo.KEYS.TELEGRAM_LINK_CODE);
  return res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// POST /api/telegram/test - kirim pesan uji
// ---------------------------------------------------------------------------

router.post('/test', asyncHandler(async (req, res) => {
  const chatId = settingsRepo.get(settingsRepo.KEYS.TELEGRAM_CHAT_ID);
  if (!chatId) {
    throw AppError.badRequest('Chat ID belum diatur. Isi dulu di halaman Pengaturan.');
  }

  const sample = [
    `⏰ *Pengingat Tugas*`,
    `📌 *Tugas:* Contoh: Esai Struktur Data`,
    `📚 *Matkul:* Matematika`,
    `⏳ *Tenggat:* Esok jam 23.00 (1 menit lagi)`, // akan diganti oleh engine
    ``,
    `_Dikirim otomatis oleh CampusFlow_`,
  ].join('\n');

  const result = await client.sendMessage(chatId, sample, { disableNotification: true });
  if (result.ok) {
    return res.json({ success: true, sent: true });
  }
  res.status(502).json({ success: false, error: { code: 'UPSTREAM_ERROR', message: result.description } });
}));

// ---------------------------------------------------------------------------
// GET /api/telegram/status - status Telegram
// ---------------------------------------------------------------------------

router.get('/status', asyncHandler(async (req, res) => {
  res.json({
    configured: client.enabled,
    linked: settingsRepo.telegramStatus().linked,
    botUsername: settingsRepo.telegramStatus().botUsername,
    chatHint: settingsRepo.telegramStatus().chatHint,
  });
}));

// ---------------------------------------------------------------------------
// GET /api/time - waktu server WIB
// ---------------------------------------------------------------------------

router.get('/time', asyncHandler(async (req, res) => {
  res.json({
    time: new Date().toISOString(), // Kirim ISO, frontend konversi ke WIB
    timezone: 'Asia/Jakarta',
  });
}));

// ---------------------------------------------------------------------------
// GET /api/notify/thresholds - ambat batas notifikasi
// ---------------------------------------------------------------------------

router.get('/notify/thresholds', asyncHandler(async (req, res) => {
  res.json({
    thresholds: config.notify.thresholdsHours,
  });
}));

module.exports = router;