'use strict';

const { config } = require('./config');
const logger = require('./logger');

/**
 * Penjadwal ringan untuk satu cron saja (notifikasi deadline).
 *
 * Pakai node-cron akan menambah dependency untuk satu pola "setiap N menit".
 * Untuk kebutuhan ini cukup mencocokkan menit dalam satu jam dengan
 * timezone yang dikonfigurasi - sederhana, bisa diuji, dan tidak menambah
 * dependensi produksi.
 */

/**
 * Hitung delay milidetik sampai menit ke-`everyMinutes` berikutnya.
 * Perhitungan memakai bagian menit pada waktu lokal timezone, jadi
 * jadwal tetap "Setiap kelipatan 15 menit" walaupun host berjalan di UTC.
 */
function msUntilNextSlot(now, timezone, everyMinutes) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);

  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const minute = get('minute');
  const second = get('second');

  const minutesIntoHour = minute % everyMinutes;
  const untilNextSlot = (everyMinutes - minutesIntoHour) * 60_000;
  return untilNextSlot - second * 1000;
}

function createScheduler({ everyMinutes = 15, timezone = config.notify.timezone, job, logger: log = logger } = {}) {
  let timer = null;
  let running = false;
  let stopped = false;
  let nextAt = null;

  async function tick() {
    // Cron firing setiap 15 menit tapi job bisa makan waktu lebih lama dari
    // itu (retry Telegram). Tanpa guard, run kedua bisa menimpa notify_stage
    // dan mengirim pesan duplikat.
    if (running) {
      log.warn('siklus notifikasi sebelumnya masih jalan, dilewati');
      return;
    }
    running = true;
    const started = Date.now();
    try {
      const summary = await job();
      if (summary && (summary.sent || summary.failed)) {
        log.info('siklus notifikasi selesai', { ...summary, ms: Date.now() - started });
      } else {
        log.debug('siklus notifikasi selesai', { ms: Date.now() - started });
      }
    } catch (err) {
      log.error('siklus notifikasi melempar error', { error: err.message, stack: err.stack });
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (stopped) return;
    const delay = msUntilNextSlot(Date.now(), timezone, everyMinutes);
    nextAt = new Date(Date.now() + delay).toISOString();
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, Math.max(delay, 1000));
  }

  return {
    start() {
      stopped = false;
      schedule();
      log.info('scheduler notifikasi aktif', { everyMinutes, timezone, nextAt });
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    /** Jalankan sekarang, di luar jadwal (dipakai tombol "Cek sekarang"). */
    runNow: tick,
    status() {
      return { running, nextAt, everyMinutes, timezone, stopped };
    },
  };
}

module.exports = { createScheduler, msUntilNextSlot };
