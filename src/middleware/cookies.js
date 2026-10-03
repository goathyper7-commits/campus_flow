'use strict';

/**
 * Parser cookie minimal (hanya yang dibutuhkan: satu cookie sesi).
 * Menulis ulang cookie-parser demi ini bukan demi performa - Express 4 tidak
 * menyertakan parser cookie, dan menarik satu dependency untuk membaca satu
 * header dengan format sederhana tidak sebanding dengan risikonya: parser
 * sendiri bisa jadi vektor parsing differs, sementara cookie-parser sudah
 * di-audit orang banyak.
 *
 * Header yang dibaca selalu dalam kondisi browser sudah meng-escape nilai,
 * dan decodeURIComponent dibungkus try/catch supaya value rusak tidak
 * menjatuhkan seluruh request.
 */
function cookieParser() {
  return (req, res, next) => {
    req.cookies = Object.create(null);

    const header = req.headers.cookie;
    if (!header) return next();

    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 1) continue;
      const key = part.slice(0, eq).trim();
      let value = part.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      try {
        req.cookies[key] = decodeURIComponent(value);
      } catch {
        req.cookies[key] = value;
      }
    }
    return next();
  };
}

module.exports = { cookieParser };
