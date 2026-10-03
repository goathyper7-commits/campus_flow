/**
 * Klien API CampusFlow.
 *
 * Semua respons error dari server mengikuti satu bentuk:
 *   { error: { code, message, details? } }
 * sehingga UI bisa bercabang pada `code` (stok, auth, validasi) alih-alih
 * mencocokkan string pesan.
 */

const BASE = '/api';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Pesan siap tampil, termasuk daftar allowed bila validasi enum gagal. */
  get panjangPesan() {
    const allowed = this.details?.allowed;
    if (Array.isArray(allowed) && this.details.received !== undefined) {
      return `${this.message} Pilihan yang tersedia: ${allowed.join(', ')}.`;
    }
    return this.message;
  }
}

/** Error jaringan: server mati atau perangkat offline. */
export class OfflineError extends ApiError {
  constructor(cause) {
    super(0, 'OFFLINE', 'Tidak ada koneksi ke server CampusFlow.');
    this.cause = cause;
  }
}

async function request(method, path, { body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new OfflineError(err);
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      response.status,
      error?.code || 'HTTP_ERROR',
      error?.message || `Permintaan gagal (HTTP ${response.status}).`,
      error?.details
    );
  }

  return payload;
}

export const api = {
  // --- Auth ---
  masuk: (pin) => request('POST', '/auth/login', { body: { pin } }),
  keluar: () => request('POST', '/auth/logout'),
  sesi: () => request('GET', '/auth/session'),

  // --- Courses ---
  daftarMataKuliah: () => request('GET', '/courses'),
  simpanMataKuliah: (data) => request('POST', '/courses', { body: data }),
  ubahMataKuliah: (id, data) => request('PATCH', `/courses/${id}`, { body: data }),
  hapusMataKuliah: (id) => request('DELETE', `/courses/${id}`),

  // --- Tasks ---
  daftarTugas: (params = {}) => request('GET', `/tasks${toQuery(params)}`),
  simpanTugas: (data) => request('POST', '/tasks', { body: data }),
  ubahTugas: (id, data) => request('PATCH', `/tasks/${id}`, { body: data }),
  ubahStatusTugas: (id, status) => request('POST', `/tasks/${id}/status`, { body: { status } }),
  hapusTugas: (id) => request('DELETE', `/tasks/${id}`),

  // --- Activities ---
  daftarAktivitas: (params = {}) => request('GET', `/activities${toQuery(params)}`),
  simpanAktivitas: (data) => request('POST', '/activities', { body: data }),
  ubahAktivitas: (id, data) => request('PATCH', `/activities/${id}`, { body: data }),
  alihAktivitas: (id) => request('POST', `/activities/${id}/toggle`),
  hapusAktivitas: (id) => request('DELETE', `/activities/${id}`),

  // --- Dashboard, settings, operasional ---
  ringkasan: () => request('GET', '/dashboard/summary'),
  pengaturan: () => request('GET', '/settings/public'),
  mintaKodeTelegram: () => request('POST', '/settings/telegram/link'),
  konfirmasiTelegram: (code) => request('POST', '/settings/telegram/confirm', { body: { code } }),
  putuskanTelegram: () => request('DELETE', '/settings/telegram'),
  jalankanNotifikasi: () => request('POST', '/notify/run'),
  kirimUji: () => request('POST', '/notify/test'),
  jadwal: () => request('GET', '/scheduler'),
  kesehatan: () => request('GET', '/health'),
};

function toQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}
