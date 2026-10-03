'use strict';

const express = require('express');
const db = require('../db');
const { config } = require('../config');
const { asyncHandler } = require('../middleware/error');
const { TelegramClient } = require('../notifications/telegram');

const router = express.Router();
const startedAt = Date.now();

/**
 * Health check. RSS ikut dilaporkan karena blueprint punya KPI "RAM < 80 MB",
 * jadi angka itu harus bisa dipantau tanpa membuka Task Manager.
 */
router.get('/', asyncHandler(async (req, res) => {
  let database = 'ok';
  try {
    db.getOne('SELECT 1 AS ok');
  } catch (err) {
    database = `error: ${err.message}`;
  }

  const mem = process.memoryUsage();
  res.json({
    status: database === 'ok' ? 'ok' : 'degraded',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
    heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
    database,
    telegramConfigured: new TelegramClient().enabled,
    node: process.version,
    env: config.env,
    time: new Date().toISOString(),
  });
}));

module.exports = router;
