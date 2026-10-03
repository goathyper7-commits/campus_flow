'use strict';

/**
 * Escaper untuk Telegram MarkdownV2.
 *
 * Blueprint menyebut "Format Pesan Markdown" tanpa detail lanjutan. Kalau
 * teks judul tugas dipakai mentah-mentah dengan parse_mode, karakter
 * seperti _ * [ ( dipakai sebagai penanda format dan Telegram membalas
 * HTTP 400 "can't parse entities". Karena isi pesan sepenuhnya berasal dari
 * input pengguna, satu judul "_UTS_"] sudah cukup untuk membuat notifikasi
 * gagal terus-menerus. Jadi semua teks pengguna wajib di-escape, dan pesan
 * pun punya fallback tanpa parse_mode.
 */
const MARKDOWN_V2_SPECIALS = '_*[]()~`>#+-=|{}.!\\';

/** Escape teks pengguna agar aman dipakai di dalam MarkdownV2. */
function escapeMarkdownV2(text) {
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (ch) => `\\${ch}`);
}

/** Escape untuk mode plain text (tidak ada karakter khusus, cukup apa adanya). */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Nama file aman untuk log: buang karakter yang menyulitkan di Windows. */
function safeSlug(text, max = 40) {
  return String(text ?? '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, max) || 'item';
}

module.exports = { escapeMarkdownV2, escapeHtml, safeSlug, MARKDOWN_V2_SPECIALS };
