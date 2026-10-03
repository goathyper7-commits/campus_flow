'use strict';

const db = require('../db');

const KEYS = {
  TELEGRAM_CHAT_ID: 'telegram_chat_id',
  TELEGRAM_BOT_USERNAME: 'telegram_bot_username',
  TELEGRAM_CHAT_LABEL: 'telegram_chat_label',
  TELEGRAM_LINK_CODE: 'telegram_link_code',
  TELEGRAM_LINK_EXPIRES: 'telegram_link_expires',
  NOTIFY_TIMEZONE: 'notify_timezone',
  USERNAME: 'username',
};

function get(key) {
  const row = db.getOne('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : null;
}

function set(key, value) {
  db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value == null ? '' : String(value),
    db.nowIso()
  );
}

function remove(key) {
  db.run('DELETE FROM settings WHERE key = ?', key);
}

function removeMany(keys) {
  db.transaction(() => {
    for (const key of keys) remove(key);
  });
}

function getMany(keys) {
  const out = {};
  for (const key of keys) out[key] = get(key);
  return out;
}

/**
 * Status Telegram untuk UI. Sengaja TIDAK pernah menyertakan chat_id mentah,
 * hanya bentuk tersamar - chat_id adalah PII yang tidak perlu tampil di layar.
 */
function telegramStatus() {
  const values = getMany([
    KEYS.TELEGRAM_CHAT_ID,
    KEYS.TELEGRAM_BOT_USERNAME,
    KEYS.TELEGRAM_CHAT_LABEL,
    KEYS.USERNAME,
  ]);
  const chatId = values[KEYS.TELEGRAM_CHAT_ID];

  return {
    linked: Boolean(chatId),
    botUsername: values[KEYS.TELEGRAM_BOT_USERNAME] || null,
    chatLabel: values[KEYS.TELEGRAM_CHAT_LABEL] || null,
    chatHint: chatId ? maskChatId(chatId) : null,
  };
}

function maskChatId(chatId) {
  const s = String(chatId);
  if (s.length <= 4) return '*'.repeat(s.length);
  return `${s.slice(0, 3)}${'*'.repeat(Math.max(3, s.length - 6))}${s.slice(-2)}`;
}

module.exports = {
  KEYS,
  get,
  set,
  remove,
  removeMany,
  getMany,
  telegramStatus,
  maskChatId,
};
