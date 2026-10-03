'use strict';

const { escapeMarkdownV2 } = require('./escape');

const EMOJI = {
  tinggi: '\u{1F534}',
  sedang: '\u{1F7E1}',
  rendah: '\u{1F7E2}',
};

const TIER_LABEL = {
  1: '\u{1F552} H-24',
  2: '\u{26A1} H-3',
  3: '\u{1F525} H-1',
};

/**
 * Format tanggal ke waktu lokal pengguna.
 * Semua data disimpan UTC; tanpa konversi ini, pesan akan menyebut jam yang
 * berbeda dari yang terlihat di UI PWA.
 */
function formatLocal(iso, timezone) {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: timezone,
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 16);
  }
}

/** Desimal jam -> "23 jam 45 menit", jauh lebih enak dibaca. */
function humanRemaining(hoursLeft) {
  if (!Number.isFinite(hoursLeft)) return 'segera';
  const totalMinutes = Math.max(0, Math.round(hoursLeft * 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days) parts.push(`${days} hari`);
  if (hours) parts.push(`${hours} jam`);
  if (minutes && !days) parts.push(`${minutes} menit`);
  return parts.length ? parts.join(' ') : 'kurang dari 1 menit';
}

/**
 * Susun pesan peringatan tugas.
 *
 * Setiap nilai yang berasal dari pengguna melewati escapeMarkdownV2 - inilah
 * yang mencegah Telegram membalas 400 "can't parse entities" ketika judul
 * tugas mengandung _, *, [ atau (.
 */
function formatTaskAlert(task, { tier, timezone }) {
  const e = escapeMarkdownV2;
  const lines = [];

  const tierLabel = TIER_LABEL[tier] || TIER_LABEL[1];
  const priorityEmoji = EMOJI[task.prioritas] || EMOJI.sedang;

  lines.push(`${priorityEmoji} *${tierLabel} \u{2014} ${e(task.course_nama || 'Tanpa mata kuliah')}*`);
  lines.push('');
  lines.push(`*Judul:* ${e(task.judul)}`);

  if (task.deskripsi) {
    const desc = task.deskripsi.length > 300
      ? `${task.deskripsi.slice(0, 300)}\u{2026}`
      : task.deskripsi;
    lines.push('');
    lines.push(`*Catatan:* ${e(desc)}`);
  }

  lines.push('');
  lines.push(`*Deadline:* ${e(formatLocal(task.deadline, timezone))}`);
  lines.push(`*Sisa waktu:* ${e(humanRemaining(task.hours_left))}`);

  // Kalimat penekanan memakai blockquote (>), bukan paragraf biasa.
  if (tier >= 3) {
    lines.push('');
    lines.push('> \u{1F525} Kurang dari satu jam. Jangan sampai telat!');
  } else if (tier === 2) {
    lines.push('');
    lines.push('> \u{26A0} Tiga jam lagi. Mulai dari yang paling sulit.');
  } else {
    lines.push('');
    lines.push('> \u{1F552} Masih ada sehari. Rencanakan sekarang.');
  }

  lines.push('');
  lines.push('_Dikirim otomatis oleh CampusFlow_');

  return lines.join('\n');
}

/** Ringkasan seluruh tugas terbuka - dipakai untuk pesan ringkasan harian. */
function formatDailyDigest(tasks, { timezone }) {
  const e = escapeMarkdownV2;

  if (!tasks.length) {
    return [
      '*CampusFlow* \u{1F4C5}',
      '',
      'Tidak ada tugas yang belum selesai.',
      '',
      '_Dikirim otomatis oleh CampusFlow_',
    ].join('\n');
  }

  const byCourse = new Map();
  for (const task of tasks) {
    const key = task.course_nama || 'Tanpa mata kuliah';
    if (!byCourse.has(key)) byCourse.set(key, []);
    byCourse.get(key).push(task);
  }

  const lines = [`*CampusFlow* \u{1F4C5} *Ringkasan tugas*`, ''];

  for (const [course, items] of byCourse) {
    lines.push(`\u{1F4CB} *${e(course)}* (${items.length})`);
    for (const task of items.slice(0, 8)) {
      const when = e(formatLocal(task.deadline, timezone));
      const prio = EMOJI[task.prioritas] || EMOJI.sedang;
      lines.push(`${prio} ${e(task.judul)} \u{2014} ${when}`);
    }
    if (items.length > 8) lines.push(`_\u{2026} dan ${items.length - 8} lainnya_`);
    lines.push('');
  }

  lines.push(`_Dikirim otomatis oleh CampusFlow_`);
  return lines.join('\n');
}

module.exports = { formatTaskAlert, formatDailyDigest, formatLocal, humanRemaining };
