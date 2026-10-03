/* eslint-env serviceworker */
/**
 * Service Worker CampusFlow.
 *
 * Prinsip yang dipegang:
 * 1. Aset statis memakai Stale-While-Revalidate (blueprint §2) - tampilkan
 *    versi cache seketika, perbarui diam-diam di belakang.
 * 2. API TIDAK PERNAH di-cache untuk request yang menulis. Menyimpan respons
 *    POST lalu memainkannya kembali saat offline berarti perubahan data
 *    hilang tanpa jejak - jauh lebih buruk daripada error.
 * 3. Hanya GET /api yang boleh fallback ke cache, dan ditandai kedaluwarsa
 *    supaya UI bisa jujur memberi tahu pengguna.
 * 4. Cache berversi: cache lama dihapus saat activate, jadi pengguna tidak
 *    terjebak di versi lawas selamanya.
 */

const VERSION = 'v1.0.0';
const CACHE_ASET = `campusflow-aset-${VERSION}`;
const CACHE_API = `campusflow-api-${VERSION}`;

/** App shell: cukup untuk merender UI tanpa jaringan sama sekali. */
const APP_SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/app.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/pwa-register.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon.png',
  '/icons/apple-touch-icon.png',
];

/** Hanya response 200 yang boleh masuk cache; 206/opaq akan merusak cache. */
function cacheable(response) {
  return response && response.status === 200 && response.type !== 'opaque';
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_ASET);
    // cache.addAll bersifat atomik: satu aset gagal, seluruh precache gagal.
    // Di sini itu tidak dapat diterima - aplikasi yang tidak bisa dibuka
    // offline sama sekali sama dengan tidak punya Service Worker.
    await Promise.all(APP_SHELL.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] gagal menyimpan app shell:', url, err);
      }
    }));
    // skipWaiting() sengaja tidak dipanggil di sini. Versi baru menunggu
    // koordinasi: pengguna diberi tombol "Muat ulang" supaya pergantian tidak
    // terjadi di tengah mereka mengisi formulir.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const allowed = new Set([CACHE_ASET, CACHE_API]);
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith('campusflow-') && !allowed.has(name))
        .map((name) => caches.delete(name))
    );
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/** Cache-aset: SWR. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_ASET);
  const cached = await cache.match(request);

  const network = fetch(request).then((response) => {
    if (cacheable(response)) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  if (cached) {
    network.catch(() => {}); // tidak perlu menunggu saat sudah ada cache
    return cached;
  }

  const response = await network;
  if (response) return response;

  // Tidak ada cache dan tidak ada jaringan.
  if (request.mode === 'navigate') return caches.match('/offline.html');
  return new Response('', { status: 504, statusText: 'Offline' });
}

/** Navigasi: Network First supaya update frontend cepat terlihat. */
async function handleNavigation(request, preload) {
  try {
    const response = preload || await fetch(request);
    if (cacheable(response)) {
      const cache = await caches.open(CACHE_ASET);
      cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    return (await caches.match('/index.html'))
      || (await caches.match('/offline.html'))
      || new Response('Offline', { status: 503 });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return; // biarkan network menangani tulis

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // jangan sentuh CDN/lain

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, event.preloadResponse));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

/**
 * API: Network First dengan fallback cache, hanya untuk GET.
 * Fallback diberi header X-CampusFlow-Cache: 1 supaya UI bisa menandai data
 * sebagai "mungkin kedaluwarsa" alih-alih menyodorkan angka basi tanpa
 * penjelasan.
 */
async function networkFirstApi(request) {
  try {
    const response = await fetch(request);
    if (cacheable(response) && new URL(request.url).pathname === '/api/tasks') {
      const cache = await caches.open(CACHE_API);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-CampusFlow-Cache', '1');
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
    return new Response(JSON.stringify({
      error: { code: 'OFFLINE', message: 'Tidak ada koneksi. Data tidak bisa dimuat.' },
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
