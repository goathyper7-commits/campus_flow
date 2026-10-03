'use strict';

const express = require('express');
const v = require('../middleware/validate');
const { asyncHandler } = require('../middleware/error');
const { config, verifyPin } = require('../config');
const sessions = require('../repositories/sessions');
const { setSessionCookie, clearSessionCookie, loginRateLimiter } = require('../middleware/auth');
const logger = require('../logger');

const router = express.Router();

router.post('/login', loginRateLimiter(), asyncHandler(async (req, res) => {
  const body = v.objectBody(req);
  v.rejectUnknownKeys(body, ['pin'], 'login');
  const pin = v.str(body.pin, 'PIN', { min: 1, max: 128, trim: false });

  if (!verifyPin(pin)) {
    logger.warn('login gagal', { ip: req.ip, ua: req.headers['user-agent']?.slice(0, 80) });
    // Pesan sengaja tidak membedakan "PIN salah" dari "tidak ada PIN".
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'PIN salah.' },
    });
  }

  sessions.purgeExpired();
  const session = sessions.create();
  setSessionCookie(res, session.token, session.expiresAt);
  logger.info('login berhasil', { ip: req.ip });
  return res.json({
    authenticated: true,
    expiresAt: session.expiresAt,
    ttlMs: config.auth.sessionTtlMs,
  });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  sessions.destroy(req.sessionToken || req.cookies?.[sessions.COOKIE_NAME]);
  clearSessionCookie(res);
  res.status(204).end();
}));

router.get('/session', asyncHandler(async (req, res) => {
  res.json({
    authenticated: Boolean(req.session),
    expiresAt: req.session?.expires_at ?? null,
  });
}));

module.exports = router;
