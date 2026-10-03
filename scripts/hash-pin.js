'use strict';

/**
 * Buat hash PIN untuk .env.
 *
 *   npm run hash-pin -- 1234
 *
 * Output: ADMIN_PIN_HASH=scrypt$<saltHex>$<hashHex>
 *
 * PIN tidak pernah disimpan polos, dan scrypt (bukan md5/sha1) dipakai
 * karena kodenya purposefully lambat - itu satu-satunya defense PIN 4 digit
 * masih punya ruang brute force yang terlalu cepat di hash cepat.
 */

const crypto = require('node:crypto');

const KEYLEN = 64;

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

module.exports = { hashPin };

if (require.main === module) {
  const pin = process.argv[2];

  if (!pin) {
    process.stderr.write('Penggunaan: npm run hash-pin -- <pin>\n');
    process.stderr.write('Contoh  : npm run hash-pin -- 1234\n');
    process.exit(1);
  }
  if (!/^\d{4,8}$/.test(pin)) {
    process.stderr.write('PIN harus 4-8 digit angka.\n');
    process.exit(1);
  }

  process.stdout.write(`ADMIN_PIN_HASH=${hashPin(pin)}\n`);
  process.stdout.write('\nTempelkan baris di atas ke file .env, lalu jalankan ulang server.\n');
}
