/**
 * Registrasi Service Worker + prompt instalasi PWA.
 *
 * Tidak ada <script> inline dan tidak ada event handler inline di HTML
 * (dilarang oleh CSP), jadi handler beforeinstallprompt harus ditangkap di
 * sini lalu dipakai ulang lewat window.__campusflowPwa.
 */

const status = {
  canInstall: false,
  installPrompt: null,
  updateReady: false,
};

window.__campusflowPwa = status;

export function registerPwa({ onUpdateReady } = {}) {
  if (!('serviceWorker' in navigator)) {
    console.info('[pwa] Service Worker tidak didukung browser ini.');
    return;
  }

  // Service Worker butuh HTTPS, atau http://localhost. Melihat halaman
  // dari IP LAN (mis. 192.168.1.5) tanpa TLS akan ditolak browser.
  if (!window.isSecureContext) {
    console.warn('[pwa] Konteks tidak aman - Service Worker akan dinonaktifkan oleh browser. Gunakan HTTPS atau akses via localhost/tunnel.');
    return;
  }

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // Ada worker baru yang sudah aktif sementara yang lama masih melayani
          // halaman. Minta pengguna memutuskan kapan memuat ulang.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            status.updateReady = true;
            onUpdateReady?.();
          }
        });
      });

      // Kalau ada worker yang menunggu, tawarkan langsung.
      if (registration.waiting && navigator.serviceWorker.controller) {
        status.updateReady = true;
        onUpdateReady?.();
      }

      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
      });
    } catch (err) {
      console.warn('[pwa] registrasi Service Worker gagal:', err);
    }
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    // Cegah banner bawaan browser agar bisa memicu dari UI sendiri.
    event.preventDefault();
    status.installPrompt = event;
    status.canInstall = true;
    window.dispatchEvent(new CustomEvent('campusflow:installable'));
  });

  window.addEventListener('appinstalled', () => {
    status.canInstall = false;
    status.installPrompt = null;
    window.dispatchEvent(new CustomEvent('campusflow:installed'));
  });
}
