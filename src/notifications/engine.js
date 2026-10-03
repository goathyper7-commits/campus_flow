'use strict';

const { config } = require('../config');
const logger = require('../logger');
const tasksRepo = require('../repositories/tasks');
const settingsRepo = require('../repositories/settings');
const { TelegramClient } = require('./telegram');
const { formatTaskAlert, formatDailyDigest } = require('./formatter');

/**
 * Engine notifikasi deadline 3 tingkat.
 *
 * Mekanisme blueprint hanya punya flag is_notified biner: sekali terkirim,
 * selamanya. Akibatnya tugas yang di-reschedule tidak pernah diperingatkan
 * lagi, dan tugas yang sudah selesai masih bisa mendapat peringatan. Di sini
 * flag diganti notify_stage bertingkat yang di-reset setiap kali deadline
 * berubah (lihat repositories/tasks.js).
 */

/**
 * Tentukan tingkat mana yang harus dikirim untuk sebuah tugas.
 * thresholds = [24, 3, 1] -> H-24, H-3, H-1.
 * Mengembalikan 0 kalau tugas belum masuk jendela manapun.
 */
function resolveTier(hoursLeft, thresholds) {
  let tier = 0;
  for (let i = 0; i < thresholds.length; i += 1) {
    if (hoursLeft <= thresholds[i]) tier = i + 1;
  }
  return tier;
}

class NotificationEngine {
  constructor(options = {}) {
    this.client = options.client ?? new TelegramClient();
    this.thresholds = options.thresholds ?? config.notify.thresholdsHours;
    this.timezone = options.timezone ?? config.notify.timezone;
    this.tasks = options.tasks ?? tasksRepo;
    this.settings = options.settings ?? settingsRepo;
    this.logger = options.logger ?? logger;
    this.now = options.now ?? (() => Date.now());
  }

  get maxTier() {
    return this.thresholds.length;
  }

  get maxHours() {
    return this.thresholds[0];
  }

  /** chat_id tujuan: dari settings, atau fallback dari .env. */
  resolveChatId() {
    return this.settings.get(settingsRepo.KEYS.TELEGRAM_CHAT_ID) || config.telegram.chatId || null;
  }

  /**
   * Satu siklus pemeriksaan.
   * Idempoten: tugas yang tahapnya sudah cocok dilewati, jadi cron yang jalan
   * setiap 15 menit tidak akan mengirim pesan berulang.
   */
  async runOnce() {
    const summary = { checked: 0, sent: 0, skipped: 0, failed: 0, errors: [] };

    if (!this.client.enabled) {
      summary.skipped = -1;
      this.logger.warn('notifikasi dilewati: TELEGRAM_BOT_TOKEN belum diisi');
      return summary;
    }

    const chatId = this.resolveChatId();
    if (!chatId) {
      summary.skipped = -1;
      this.logger.warn('notifikasi dilewati: Telegram belum terhubung');
      return summary;
    }

    const candidates = this.tasks.findNotifyCandidates(this.maxTier, this.maxHours);
    summary.checked = candidates.length;

    for (const task of candidates) {
      const tier = resolveTier(task.hours_left, this.thresholds);

      // 0 = belum time-nya; atau sudah lewat tingkat yang pernah dikirim.
      if (tier === 0 || tier <= task.notify_stage) {
        summary.skipped += 1;
        continue;
      }

      const text = formatTaskAlert(task, { tier, timezone: this.timezone });
      const result = await this.client.sendMessage(chatId, text);

      if (result.ok) {
        // Tandai sukses SETELAH terkirim. Kalau ditandai lebih dulu lalu
        // proses mati di tengah, tugas itu akan hilang dari radar
        // notifikasi selamanya.
        this.tasks.advanceNotifyStage(task.id, tier);
        summary.sent += 1;
        this.logger.info('notifikasi terkirim', {
          task_id: task.id, tier, sisa_jam: Number(task.hours_left.toFixed(2)),
        });
      } else {
        summary.failed += 1;
        summary.errors.push({ task_id: task.id, error: result.description });
        this.logger.error('notifikasi gagal', { task_id: task.id, error: result.description });

        // Token salah tidak akan membaik dengan mencoba lagi di siklus
        // berikutnya; hentikan agar tidak membanjiri log setiap 15 menit.
        if (result.fatal) break;
      }
    }

    return summary;
  }

  /** Uji coba pesan (dipakai tombol "Kirim pesan uji" di UI). */
  async sendTest() {
    const chatId = this.resolveChatId();
    if (!this.client.enabled || !chatId) {
      return { ok: false, description: 'Telegram belum siap. Isi token dan hubungkan akun dulu.' };
    }

    const sample = {
      judul: 'Contoh: Esai Struktur Data',
      course_nama: 'Basis Data',
      deskripsi: 'Ini pesan uji. Notifikasi deadline CampusFlow berjalan normal.',
      deadline: new Date(this.now() + 2 * 3_600_000).toISOString(),
      prioritas: 'tinggi',
      hours_left: 2,
    };
    return this.client.sendMessage(
      chatId,
      formatTaskAlert(sample, { tier: 3, timezone: this.timezone })
    );
  }

  async sendDigest() {
    const chatId = this.resolveChatId();
    if (!this.client.enabled || !chatId) return { ok: false, description: 'Telegram belum siap.' };
    const open = this.tasks.list({ open: true }).slice(0, 40);
    return this.client.sendMessage(
      chatId,
      formatDailyDigest(open, { timezone: this.timezone })
    );
  }

  /** Kunjungi setiap tugas yang lewat deadline (untuk status "terlambat"). */
  overdueCount() {
    return this.tasks.list({ overdue: true }).length;
  }
}

module.exports = { NotificationEngine, resolveTier };
