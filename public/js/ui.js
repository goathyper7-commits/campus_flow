/**
 * Pembuat elemen DOM.
 *
 * Semua tampilan dibangun lewat el()/mount(), tidak pernah lewat innerHTML.
 * Tugas, mata kuliah, dan aktivitas adalah input pengguna yang kembali ke
 * browser apa adanya; merangkai HTML dari string berarti satu judul berisi
 * <img onerror=...> sudah cukup untuk mencuri cookie sesi (kalau tidak
 * httpOnly) atau menyamar sebagai UI CampusFlow. Dengan membuat node secara
 * programatis dan mengisi teks lewat textContent, XSS tersimpan tidak punya
 * jalan masuk sama sekali - bukan bergantung pada fungsi escape().
 */

/**
 * @param {string} tag
 * @param {object} [props] class, text, html (khusus ikon statis internal),
 *   dataset, style, dan atribut lain; prefix "on" untuk event listener.
 * @param {...(Node|string|null|false|Array)} children
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;

    if (key === 'class' || key === 'className') {
      node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value)) {
        if (dv !== undefined && dv !== null) node.dataset[dk] = String(dv);
      }
    } else if (key === 'style' && typeof value === 'object') {
      for (const [sk, sv] of Object.entries(value)) node.style.setProperty(sk, sv);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  append(node, children);
  return node;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

export function mount(target, ...children) {
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  if (!node) return null;
  node.replaceChildren();
  append(node, children);
  return node;
}

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/** Ikon SVG statis milik aplikasi (bukan input pengguna), aman lewat innerHTML. */
export function icon(pathData, { size = 18, stroke = 2, className = '' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);

  for (const d of [].concat(pathData)) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

export const ICON = {
  tambah: 'M12 5v14M5 12h14',
  cek: 'M20 6L9 17l-5-5',
  pensil: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  sampah: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6M14 11v6'],
  jam: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  lokasi: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z', 'M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  wifi: ['M5 12.5a10 10 0 0 1 14 0', 'M8.5 16a5 5 0 0 1 7 0', 'M2 9a15 15 0 0 1 20 0', 'M12 20h.01'],
  unggah: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
  wifi: ['M5 12.5a10 10 0 0 1 14 0', 'M8.5 16a5 5 0 0 1 7 0', 'M2 9a15 15 0 0 1 20 0', 'M12 20h.01'],
  telegram: ['M21 5 3 11l5 2 2 6 3-4 5 3z'],
};

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export function toast(message, kind = 'info', ms = 3200) {
  const wrap = document.querySelector('#wadah-toast');
  if (!wrap) return;

  const glyph = kind === 'sukses' ? ICON.cek : kind === 'gagal' ? 'M12 8v5M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' : 'M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z';

  const node = el('div', { class: `toast toast-${kind}` },
    icon(glyph, { size: 18, className: 'mt-0.5 shrink-0' }),
    el('span', { class: 'flex-1', text: message })
  );

  wrap.appendChild(node);

  setTimeout(() => {
    node.style.transition = 'opacity .2s, transform .2s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(-6px)';
    setTimeout(() => node.remove(), 220);
  }, ms);
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

let onSubmitHandler = null;

/**
 * Buka modal dan isi dengan konten yang sudah dibangun lewat el().
 * Fokus, Escape, dan focus trap ditangani <dialog> bawaan browser.
 */
export function openModal({ title, body, submitLabel = 'Simpan', onSubmit, danger = false }) {
  const dialog = document.querySelector('#modal');
  const form = document.querySelector('#modal-form');

  document.querySelector('#modal-judul').textContent = title;
  document.querySelector('#modal-isi').replaceChildren(body);

  const submitBtn = document.querySelector('#modal-simpan');
  submitBtn.textContent = submitLabel;
  submitBtn.className = danger ? 'tombol-bahaya' : 'tombol-utama';

  onSubmitHandler = onSubmit;
  form.onsubmit = async (event) => {
    event.preventDefault();
    submitBtn.disabled = true;
    try {
      const result = await onSubmit?.(new FormData(form), form);
      if (result !== false) closeModal();
    } finally {
      submitBtn.disabled = false;
    }
  };

  dialog.showModal();
  const firstField = dialog.querySelector('input:not([type=hidden]), select, textarea');
  if (firstField) requestAnimationFrame(() => firstField.focus());
}

export function closeModal() {
  const dialog = document.querySelector('#modal');
  onSubmitHandler = null;
  if (dialog?.open) dialog.close();
}

export function initModal() {
  const dialog = document.querySelector('#modal');
  document.querySelector('#modal-tutup').addEventListener('click', closeModal);
  document.querySelector('#modal-batal').addEventListener('click', closeModal);

  // Klik di luar area dialog menutupnya.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeModal();
  });
}

// ---------------------------------------------------------------------------
// Potongan tampilan yang sering dipakai
// ---------------------------------------------------------------------------

export function emptyState(ikonPath, judul, teks, aksi) {
  return el('div', { class: 'kosong' },
    el('div', { class: 'kosong-ikon text-slate-300' }, icon(ikonPath, { size: 40, stroke: 1.5 })),
    el('p', { class: 'kosong-judul', text: judul }),
    teks ? el('p', { class: 'kosong-teks', text: teks }) : null,
    aksi || null
  );
}

export function spinner() {
  return el('div', { class: 'flex items-center justify-center py-10' },
    el('div', {
      class: 'h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600',
      role: 'status', 'aria-label': 'Memuat',
    })
  );
}

export function field({ label, name, type = 'text', value = '', required = false, placeholder = '', hint, autocomplete, inputmode, min, max, step }) {
  const input = el('input', {
    class: 'input', id: `f-${name}`, name, type, required,
    value: value ?? '', placeholder, autocomplete, inputmode, min, max, step,
  });
  return el('div', {},
    el('label', { class: 'label', for: `f-${name}`, text: label }),
    input,
    hint ? el('p', { class: 'mt-1 text-[11px] text-slate-400', text: hint }) : null
  );
}

export function textareaField({ label, name, value = '', placeholder = '', rows = 3, maxlength = 2000 }) {
  return el('div', {},
    el('label', { class: 'label', for: `f-${name}`, text: label }),
    el('textarea', { class: 'input resize-y', id: `f-${name}`, name, rows, placeholder, maxlength }, value ?? '')
  );
}

export function selectField({ label, name, options, value = '', required = false, placeholder }) {
  const select = el('select', { class: 'select', id: `f-${name}`, name, required },
    placeholder ? el('option', { value: '', text: placeholder }) : null,
    ...options.map((opt) => el('option', {
      value: String(opt.value),
      text: opt.label,
      selected: String(opt.value) === String(value),
    }))
  );
  return el('div', {},
    el('label', { class: 'label', for: `f-${name}`, text: label }),
    select
  );
}

/**
 * Ubah timestamp UTC menjadi teks waktu lokal di browser.
 * Nilai dari server sengaja tidak diubah - konversi hanya terjadi di sini.
 */
export function waktuLokal(iso, { denganJam = true, denganTanggal = true } = {}) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('id-ID', {
    ...(denganTanggal ? { day: '2-digit', month: 'short' } : {}),
    ...(denganJam ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date);
}

export function sisaWaktu(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return { teks: '-', kelas: 'lencana-netral', lewat: false };

  const menit = Math.round(ms / 60000);
  const lewat = ms < 0;
  const abs = Math.abs(menit);

  let teks;
  if (abs >= 1440) teks = `${Math.floor(abs / 1440)}h ${Math.floor((abs % 1440) / 60)}m`;
  else if (abs >= 60) teks = `${Math.floor(abs / 60)}j ${abs % 60}m`;
  else teks = `${abs}m`;

  if (abs < 60) teks = `lewat ${teks}`;

  let kelas = 'lencana-netral';
  if (lewat) kelas = 'lencana-tinggi';
  else if (abs < 180) kelas = 'lencana-tinggi';
  else if (abs < 1440) kelas = 'lencana-sedang';

  return { teks, kelas, lewat };
}


