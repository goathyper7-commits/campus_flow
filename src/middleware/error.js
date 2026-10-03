'use strict';

/**
 * Error domain dengan kode stabil. Client bercabang pada `code`, bukan pada
 * pesan teks, sehingga pesan boleh diubah tanpa merusak UI.
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }

  static badRequest(message, details) { return new AppError(400, 'BAD_REQUEST', message, details); }
  static unauthorized(message = 'Sesi tidak valid atau sudah berakhir.') { return new AppError(401, 'UNAUTHORIZED', message); }
  static notFound(message = 'Data tidak ditemukan.') { return new AppError(404, 'NOT_FOUND', message); }
  static conflict(message, details) { return new AppError(409, 'CONFLICT', message, details); }
  static tooMany(message) { return new AppError(429, 'TOO_MANY_REQUESTS', message); }
  static upstream(message) { return new AppError(502, 'UPSTREAM_ERROR', message); }
}

/** Bungkus handler async supaya rejection tersalur ke error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { AppError, asyncHandler };
