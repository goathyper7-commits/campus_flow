'use strict';

const { config } = require('../config');

/**
 * Security headers tanpa dependency helmet.
 *
 * CSP sengaja ketat: tidak ada 'unsafe-inline' untuk script maupun style.
 * Konsekuensinya, index.html tidak boleh punya <script> inline atau
 * style="..." inline, dan warna harus lewat kelas CSS (lihat palet tertutup
 * di middleware/validate.js). Inilah yang membuat stored XSS benar-benar
 * sulit terjadi, bukan sekadar berharap CSP ada di response header.
 */
function securityHeaders(req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; ')
  );

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), camera=(), microphone=(), interest-cohort=()'
  );
  if (config.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

/**
 * sw.js dan manifest harus selalu divalidasi ulang oleh browser, kalau tidak
 * pengguna terjebak di versi lama selamanya karena SW di-cache.
 */
function noCacheForPwa(req, res, next) {
  if (/^\/(sw\.js|manifest\.json)$/.test(req.path)) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
  }
  next();
}

/** CORS dimatikan total: aplikasi single-origin, tidak ada yang butuh CORS. */
function noCors(req, res, next) {
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
}

module.exports = { securityHeaders, noCacheForPwa, noCors };
