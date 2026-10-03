'use strict';

const { config } = require('../config');
const logger = require('../logger');

/**
 * Klien tipis Telegram Bot API.
 *
 * Dipakai tanpa SDK resmi: yang dibutuhkan hanya satu endpoint (sendMessage)
 * dan yang hilang dari SDK adalah kontrol atas retry dan fallback parse_mode.
 * Menarik library yang besar untuk satu request HTTP tidak sebanding dengan
 * "~20 baris fetch dengan timeout eksplisit".
 */

class TelegramClient {
  constructor(options = {}) {
    this.token = options.token ?? config.telegram.token;
    this.apiBase = options.apiBase ?? config.telegram.apiBase;
    this.maxRetries = options.maxRetries ?? config.telegram.maxRetries;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? config.telegram.retryBaseDelayMs;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get enabled() {
    return Boolean(this.token);
  }

  async call(method, payload) {
    if (!this.enabled) {
      return { ok: false, description: 'TELEGRAM_BOT_TOKEN belum dikonfigurasi.' };
    }

    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchImpl(
          `${this.apiBase}/bot${this.token}/${method}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(this.timeoutMs),
          }
        );

        const data = await response.json().catch(() => null);

        if (response.ok && data?.ok) return data;

        lastError = new Error(
          data?.description || `HTTP ${response.status} dari Telegram`
        );

        // 400 = payload salah (mis. parse_mode tidak valid). Mengulangi tidak akan
        // menolong; percobaan berikutnya mengirim ulang sebagai teks polos.
        if (response.status === 400 && /can't parse entities/i.test(lastError.message)) {
          logger.warn('parse_mode ditolak, mencoba ulang tanpa format', {
            attempt, description: lastError.message,
          });
          return this.call(method, { ...payload, parse_mode: undefined, text: stripFormatting(payload.text) });
        }

        // 401/403 tidak akan pernah berhasil dengan token yang sama.
        if (response.status === 401 || response.status === 403) {
          logger.error('Telegram menolak kredensial', { status: response.status, description: lastError.message });
          return { ok: false, description: lastError.message, fatal: true };
        }

        // 429 = rate limit; hormati retry_after bila ada.
        if (response.status === 429) {
          const waitMs = (data?.parameters?.retry_after ?? 5) * 1000;
          logger.warn('Telegram rate limit', { attempt, waitMs });
          await this.sleep(waitMs);
          continue;
        }
      } catch (err) {
        lastError = err;
        logger.warn('request ke Telegram gagal', {
          attempt, error: err.name, message: err.message,
        });
      }

      if (attempt < this.maxRetries) {
        // Backoff eksponensial: 1s, 2s, 4s.
        await this.sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }

    return { ok: false, description: lastError?.message || 'Gagal menghubungi Telegram.' };
  }

  /**
   * Kirim pesan. Kalau Telegram menolak MarkdownV2, dicoba ulang sebagai teks
   * polos supaya notifikasi penting tetap sampai meski ada karakter aneh di
   * judul tugas.
   */
  async sendMessage(chatId, text, { parseMode = 'MarkdownV2', disableNotification = false } = {}) {
    const payload = {
      chat_id: chatId,
      text,
      disable_notification: disableNotification,
      disable_web_page_preview: true,
    };
    if (parseMode) payload.parse_mode = parseMode;

    return this.call('sendMessage', payload);
  }

  async getMe() {
    return this.call('getMe', {});
  }

  async getUpdates({ offset = 0, timeoutSeconds = 0, limit = 10 } = {}) {
    const response = await this.fetchImpl(
      `${this.apiBase}/bot${this.token}/getUpdates?offset=${offset}&timeout=${timeoutSeconds}&limit=${limit}`,
      { signal: AbortSignal.timeout(this.timeoutMs + (timeoutSeconds * 1000) + 2000) }
    ).catch(() => null);

    if (!response || !response.ok) {
      return { ok: false, description: `Gagal getUpdates (${response ? response.status : 'timeout'})` };
    }
    return response.json().catch(() => ({ ok: false, description: 'Respons getUpdates tidak valid.' }));
  }
}

/** Buang penanda MarkdownV2 untuk fallback plain text. */
function stripFormatting(text) {
  return String(text ?? '')
    .replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1')
    .replace(/[_*[\]`]/g, '');
}

module.exports = { TelegramClient, stripFormatting };
