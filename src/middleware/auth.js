'use strict';

const { AppError, asyncHandler } = require('./error');
const sessions = require('../repositories/sessions');
const logger = require('../logger');

const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/health']);

/**
 * Autentikasi single-user: cookie sesi httpOnly, atau Authorization: Bearer
 * untuk klien non-browser (uji otomatis, CLI).
 *
 * Ini titik paling kritis di aplikasi. Tanpa gerbang ini, siapa pun yang bisa
 * menjangkau port bisa menghapus seluruh tugas lewat DELETE /api/tasks.
 */
function authenticate(req, res, next) {
  if (PUBLIC_PATHS.has(req.path) || !req.path.startsWith('/api/')) return next();

  const bearer = req.headers.authorization;
  const token = (bearer && bearer.startsWith('Bearer ') ? bearer.slice(7) : '')
    || req.cookies?.[sessions.COOKIE_NAME];

  const session = sessions.findValid(token);
  if (!session) {
    return next(AppError.unauthorized(
      token ? 'Sesi sudah berakhir. Silakan masuk lagi.' : 'Belum masuk. Silakan masuk terlebih dahulu.'
    ));
  }

  req.session = session;
  req.sessionToken = token;
  next();
}

function setSessionCookie(res, token, expiresAt) {
  res.cookie(sessions.COOKIE_NAME, token, {
    httpOnly: true,          // tidak terbaca JavaScript => mitigate XSS
    sameSite: 'strict',      // menahan CSRF lintas situs
    secure: require('../config').config.isProduction, // butuh HTTPS
    expires: new Date(expiresAt),
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(sessions.COOKIE_NAME, { path: '/' });
}

/**
 * Rate limit login berbasis memory. Tahan brute force PIN tanpa menambah
 * dependency atau tabel baru; single-user jadi counters global cukup.
 */
function loginRateLimiter() {
  const attempts = new Map();

  // Buang entri basi agar Map tidak tumbuh tanpa batas.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (now - entry.first > entry.windowMs * 4) attempts.delete(key);
    }
  }, 10 * 60 * 1000);
  timer.unref();

  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const windowMs = require('../config').config.auth.loginRateWindowMs;
    const max = require('../config').config.auth.loginRateLimit;

    const entry = attempts.get(key);
    if (!entry || now - entry.first > windowMs) {
      attempts.set(key, { count: 1, first: now, windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      logger.warn('rate limit login', { ip: key, count: entry.count });
      const retrySec = Math.ceil((entry.windowMs - (now - entry.first)) / 1000);
      res.set('Retry-After', String(retrySec));
      return next(AppError.tooMany(
        `Terlalu banyak percobaan masuk. Coba lagi dalam ${Math.ceil(retrySec / 60)} menit.`
      ));
    }
    return next();
  };
}

module.exports = { authenticate, setSessionCookie, clearSessionCookie, loginRateLimiter, asyncHandler };
