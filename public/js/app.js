import { api, ApiError, OfflineError } from './api.js';
import {
  el, mount, $, icon, ICON, toast, openModal, closeModal, initModal,
  emptyState, spinner, field, textareaField, selectField, waktuLokal, sisaWaktu,
} from './ui.js';
import { registerPwa } from './pwa-register.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  tab: 'dashboard',
  filterTugas: 'semua',
  ringkasan: null,
  tugas: [],
  mataKuliah: [],
  aktivitas: [],
  pengaturan: null,
  spice: 'memuat',
};

const TABS = ['dashboard', 'tugas', 'matkul', 'aktivitas', 'pengaturan'];

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------

function tampilkanLayar(nama) {
  for (const tab of TABS) {
    $(`#tab-${tab}`)?.classList.toggle('aktif', tab === nama);
  }
  $('.nav-item.aktif')?.classList.remove('aktif');
  document.querySelector(`.nav-item[data-tab="${nama}"]`)?.classList.add('aktif');
  state.tab = nama;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Bungkus setiap handler agar error tidak jadi unhandledRejection senyap. */
function jalan(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof OfflineError) {
        setStatus('offline', 'Mode offline - data mungkin kedaluwarsa');
        toast('Tidak bisa menghubungi server.', 'gagal');
      } else if (err instanceof ApiError) {
        toast(err.panjangPesan, 'gagal', 4200);
      } else {
        toast('Terjadi kesalahan tak terduga.', 'gagal');
        console.error(err);
      }
    }
  };
}

/**
 * Status online/offline ikut ditampilkan karena KPI blueprint menjanjikan
 * UI tetap hidup tanpa jaringan - pengguna perlu tahu apakah yang lihatnya
 * data live atau cache.
 */
function setStatus(jenis, pesan) {
  const node = $('#status-sinkron');
  if (!node) return;
  state.spice = jenis;
  node.textContent = pesan;
  node.className = `truncate text-[11px] font-medium ${
    jenis === 'offline' ? 'text-amber-600'
      : jenis === 'tersimpan' ? 'text-emerald-600'
      : 'text-slate-500'
  }`;
}

function waktuRelatif() {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

function keWarnaKelas(hex) {
  const palet = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899'];
  const index = palet.indexOf(String(hex || '').toLowerCase());
  return `k-warna-${index < 0 ? 0 : index}`;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function cekSesi() {
  try {
    const hasil = await api.sesi();
    if (hasil.authenticated) return true;
  } catch (err) {
    if (err instanceof OfflineError) {
      // Service worker bisa melayani shell, tapi status sesi tidak bisa
      // dipastikan. Perlakukan sebagai belum masuk supaya tidak menampilkan
      // data yang mungkin milik orang lain.
      return false;
    }
  }
  return false;
}

function tampilkanMasuk() {
  $('#layar-masuk').classList.remove('layar');
  $('#layar-masuk').classList.add('flex');
  $('#layar-utama').classList.remove('aktif');
  document.querySelector('#layar-masuk').style.display = 'flex';
  requestAnimationFrame(() => $('#input-pin')?.focus());
}

function tampilkanAplikasi() {
  $('#layar-masuk').style.display = 'none';
  $('#layar-utama').classList.add('aktif');
}

function initMasuk() {
  const form = $('#form-masuk');
  const input = $('#input-pin');
  const galat = $('#galat-masuk');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const pin = input.value.trim();

    galat.classList.add('hidden');
    input.classList.remove('input-salah');

    if (!pin) {
      galat.textContent = 'Masukkan PIN terlebih dahulu.';
      galat.classList.remove('hidden');
      return;
    }

    const tombol = form.querySelector('button[type=submit]');
    tombol.disabled = true;
    tombol.textContent = 'Memeriksa...';

    try {
      await api.masuk(pin);
      input.value = '';
      await mulaiAplikasi();
    } catch (err) {
      if (err instanceof OfflineError) {
        galat.textContent = 'Server tidak terjangkau. Pastikan CampusFlow sedang berjalan.';
      } else {
        galat.textContent = err instanceof ApiError ? err.message : 'PIN salah.';
        input.classList.add('input-salah');
        input.select();
      }
      galat.classList.remove('hidden');
    } finally {
      tombol.disabled = false;
      tombol.textContent = 'Masuk';
    }
  });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function kartuStatistik(label, nilai, warna = 'text-slate-900') {
  return el('div', { class: 'stat' },
    el('p', { class: 'stat-label', text: label }),
    el('p', { class: `stat-nilai ${warna}`, text: String(nilai) })
  );
}

function renderDashboard() {
  const data = state.ringkasan;
  if (!data) {
    mount('#kartu-statistik', spinner());
    return;
  }

  const s = data.stats;
  mount('#kartu-statistik',
    kartuStatistik('Belum selesai', s.openTotal),
    kartuStatistik('Jatuh tempo', s.dueToday, s.dueToday > 0 ? 'text-indigo-600' : ''),
    kartuStatistik('Terlambat', s.overdue, s.overdue > 0 ? 'text-rose-600' : ''),
    kartuStatistik('Aktivitas hari ini', `${s.activityTodayDone}/${s.activityToday}`)
  );

  const jam = new Date().getHours();
  const sapaan = jam < 11 ? 'Selamat pagi' : jam < 15 ? 'Selamat siang' : jam < 19 ? 'Selamat sore' : 'Selamat malam';
  $('#sapaan').textContent = `${sapaan} - zona waktu ${data.timezone}`;

  // --- Terlambat ---
  $('#badge-terlambat').textContent = String(data.overdue.length);
  const lewat = data.overdue;
  mount('#daftar-terlambat', lewat.length
    ? lewat.map((t) => barisTugasRingkas(t))
    : emptyState(ICON.cek, 'Tidak ada yang terlambat', 'Semua tugas masih di dalam jadwal.'));

  // --- Minggu ini ---
  const minggu = data.nextCourses || [];
  $('#badge-minggu').textContent = String(minggu.length);
  mount('#daftar-minggu', minggu.length
    ? minggu.map((t) => barisTugasRingkas(t))
    : emptyState(ICON.jam, 'Minggu ini kosong', 'Tidak ada deadline dalam 7 hari ke depan.'));

  // --- Aktivitas hari ini ---
  const hariIni = data.todayActivities || [];
  $('#badge-aktivitas').textContent = String(hariIni.length);
  mount('#daftar-aktivitas-hari-ini', hariIni.length
    ? hariIni.map((a) => barisAktivitasRingkas(a))
    : emptyState(ICON.lokasi, 'Belum ada aktivitas', 'Catat kegiatan harianmu di tab Aktivitas.'));
}

function barisTugasRingkas(task) {
  const sisa = sisaWaktu(task.deadline);
  return el('div', { class: 'baris-tugas !py-3' },
    el('span', { class: `mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${keWarnaKelas(task.course_warna)}-bulu` }),
    el('div', { class: 'min-w-0 flex-1' },
      el('p', { class: `judul-tugas truncate ${task.status === 'selesai' ? 'line-through text-slate-400' : ''}`, text: task.judul }),
      el('p', { class: 'truncate text-[11px] text-slate-500', text: `${task.course_nama} - ${waktuLokal(task.deadline)}` })
    ),
    task.status === 'selesai' ? null : el('span', { class: `${sisa.kelas} shrink-0`, text: sisa.teks })
  );
}

function barisAktivitasRingkas(akt) {
  return el('div', { class: 'baris-tugas !py-3' },
    el('span', { class: 'mt-0.5 shrink-0 text-slate-300' }, icon(ICON.cek, { size: 18 })),
    el('div', { class: 'min-w-0 flex-1' },
      el('p', { class: 'judul-tugas truncate', text: akt.nama }),
      el('p', { class: 'truncate text-[11px] text-slate-500', text: `${waktuLokal(akt.tanggal, { denganJam: false })}${akt.kategori ? ` - ${akt.kategori}` : ''}` })
    )
  );
}

// ---------------------------------------------------------------------------
// Tugas
// ---------------------------------------------------------------------------

const FILTER_TUGAS = [
  { value: 'semua', label: 'Semua' },
  { value: 'todo', label: 'Belum' },
  { value: 'progress', label: 'Dikerjakan' },
  { value: 'selesai', label: 'Selesai' },
  { value: 'lewat', label: 'Terlambat' },
];

function renderFilterTugas() {
  mount('#filter-tugas', ...FILTER_TUGAS.map((f) => el('button', {
    class: `chip ${state.filterTugas === f.value ? 'aktif' : ''}`,
    type: 'button',
    text: f.label,
    onclick: jalan(() => {
      state.filterTugas = f.value;
      renderFilterTugas();
      renderTugas();
    }),
  })));
}

function tugasTersaring() {
  const semua = state.tugas;
  switch (state.filterTugas) {
    case 'todo': return semua.filter((t) => t.status === 'todo');
    case 'progress': return semua.filter((t) => t.status === 'progress');
    case 'selesai': return semua.filter((t) => t.status === 'selesai');
    case 'lewat': return semua.filter((t) => t.status !== 'selesai' && Date.parse(t.deadline) < Date.now());
    default: return semua;
  }
}

function renderTugas() {
  const daftar = tugasTersaring();
  const belum = state.tugas.filter((t) => t.status !== 'selesai').length;
  $('#ringkasan-tugas').textContent = `${belum} belum selesai dari ${state.tugas.length} total`;

  if (!daftar.length) {
    mount('#daftar-tugas', state.tugas.length
      ? emptyState(ICON.cek, 'Kosong pada filter ini', 'Coba pilih filter lain.')
      : emptyState(ICON.tambah, 'Belum ada tugas', 'Tambahkan tugas pertama, lalu biar CampusFlow yang ingatkan.',
          el('button', { class: 'tombol-utama tombol-kecil mt-2', type: 'button', text: '+ Tambah tugas',
            onclick: jalan(() => bukaFormTugas()) })));
    return;
  }

  mount('#daftar-tugas', ...daftar.map(kartuTugas));
}

function kartuTugas(task) {
  const sisa = sisaWaktu(task.deadline);
  const selesai = task.status === 'selesai';

  const tombolStatus = el('button', {
    class: `mt-0.5 shrink-0 rounded-full border-2 transition ${
      selesai ? 'border-emerald-500 bg-emerald-500 text-white'
        : 'border-slate-300 text-transparent hover:border-indigo-400'
    }`,
    type: 'button',
    title: selesai ? 'Tandai belum selesai' : 'Tandai selesai',
    'aria-label': selesai ? 'Tandai belum selesai' : 'Tandai selesai',
    onclick: jalan(async () => {
      const next = selesai ? 'todo' : 'selesai';
      await api.ubahStatusTugas(task.id, next);
      toast(next === 'selesai' ? 'Tugas ditandai selesai.' : 'Tugas dikembalikan ke daftar.', 'sukses', 1800);
      await muatSemua();
    }),
  }, icon(ICON.cek, { size: 14, stroke: 3 }));

  return el('div', { class: `baris-tugas ${selesai ? 'selesai' : ''}` },
    tombolStatus,
    el('div', { class: 'min-w-0 flex-1' },
      el('p', { class: 'judul-tugas break-words', text: task.judul }),
      el('div', { class: 'mt-1 flex flex-wrap items-center gap-1.5' },
        el('span', { class: `${keWarnaKelas(task.course_warna)}-lembut k-warna-teks inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold`, text: task.course_nama }),
        el('span', { class: `lencana-${task.prioritas}`, text: task.prioritas }),
        !selesai ? el('span', { class: sisa.kelas, text: sisa.teks }) : null
      ),
      task.deskripsi
        ? el('p', { class: 'mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500', text: task.deskripsi })
        : null,
      el('p', { class: 'mt-1 flex items-center gap-1 text-[11px] text-slate-400' },
        icon(ICON.jam, { size: 12 }),
        `${waktuLokal(task.deadline)}${task.status === 'progress' ? ' - sedang dikerjakan' : ''}`
      )
    ),
    el('div', { class: 'flex shrink-0 gap-1' },
      el('button', { class: 'tombol-hantu tombol-bulat', type: 'button', title: 'Ubah', 'aria-label': 'Ubah tugas',
        onclick: jalan(() => bukaFormTugas(task)) }, icon(ICON.pensil, { size: 16 })),
      el('button', { class: 'tombol-hantu tombol-bulat hover:bg-rose-50 hover:text-rose-600', type: 'button', title: 'Hapus', 'aria-label': 'Hapus tugas',
        onclick: jalan(() => konfirmasiHapusTugas(task)) }, icon(ICON.sampah, { size: 16 }))
    )
  );
}

function waktuLokalUntukInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function bukaFormTugas(task = null) {
  if (!state.mataKuliah.length) {
    toast('Tambahkan mata kuliah dulu sebelum membuat tugas.', 'info', 4000);
    return;
  }

  const defaultDeadline = new Date(Date.now() + 24 * 3600 * 1000);
  defaultDeadline.setMinutes(0, 0, 0);

  const body = el('div', {},
    field({ label: 'Judul', name: 'judul', required: true, value: task?.judul ?? '', placeholder: 'Contoh: Esai Struktur Data', maxlength: 200 }),
    selectField({
      label: 'Mata kuliah', name: 'course_id', required: true,
      placeholder: 'Pilih mata kuliah',
      value: task?.course_id ?? '',
      options: state.mataKuliah.map((c) => ({ value: c.id, label: c.nama })),
    }),
    field({
      label: 'Deadline', name: 'deadline', type: 'datetime-local', required: true,
      value: waktuLokalUntukInput(task?.deadline) || waktuLokalUntukInput(defaultDeadline.toISOString()),
      hint: task ? 'Mengubah deadline akan mengaktifkan ulang pengingat dari H-24.' : 'Peringatan dikirim otomatis H-24, H-3, dan H-1.',
    }),
    selectField({
      label: 'Prioritas', name: 'prioritas',
      value: task?.prioritas ?? 'sedang',
      options: [{ value: 'tinggi', label: 'Tinggi' }, { value: 'sedang', label: 'Sedang' }, { value: 'rendah', label: 'Rendah' }],
    }),
    selectField({
      label: 'Status', name: 'status',
      value: task?.status ?? 'todo',
      options: [{ value: 'todo', label: 'Belum mulai' }, { value: 'progress', label: 'Sedang dikerjakan' }, { value: 'selesai', label: 'Selesai' }],
    }),
    textareaField({ label: 'Catatan', name: 'deskripsi', value: task?.deskripsi ?? '', placeholder: 'Opsional: instruksi, halaman, atau bahan baca.', maxlength: 2000 })
  );

  openModal({
    title: task ? 'Ubah tugas' : 'Tugas baru',
    body,
    submitLabel: task ? 'Simpan perubahan' : 'Tambah tugas',
    onSubmit: async (formData) => {
      const payload = {
        judul: formData.get('judul').trim(),
        course_id: Number(formData.get('course_id')),
        deadline: new Date(formData.get('deadline')).toISOString(),
        prioritas: formData.get('prioritas'),
        status: formData.get('status'),
        deskripsi: formData.get('deskripsi') || '',
      };

      if (!payload.judul) { toast('Judul tidak boleh kosong.', 'gagal'); return false; }
      if (!payload.course_id) { toast('Pilih mata kuliah.', 'gagal'); return false; }
      if (Number.isNaN(Date.parse(payload.deadline))) { toast('Deadline tidak valid.', 'gagal'); return false; }

      if (task) await api.ubahTugas(task.id, payload);
      else await api.simpanTugas(payload);

      toast(task ? 'Tugas diperbarui.' : 'Tugas ditambahkan.', 'sukses');
      await muatSemua();
      return true;
    },
  });
}

function konfirmasiHapusTugas(task) {
  openModal({
    title: 'Hapus tugas?',
    body: el('p', { class: 'text-sm leading-relaxed text-slate-600' },
      el('strong', { text: task.judul }),
      ' akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.'
    ),
    submitLabel: 'Hapus',
    danger: true,
    onSubmit: async () => {
      await api.hapusTugas(task.id);
      toast('Tugas dihapus.', 'sukses');
      await muatSemua();
      return true;
    },
  });
}

// ---------------------------------------------------------------------------
// Mata kuliah
// ---------------------------------------------------------------------------

function renderMataKuliah() {
  const daftar = state.mataKuliah;
  $('#ringkasan-matkul').textContent = `${daftar.length} mata kuliah terdaftar`;

  if (!daftar.length) {
    mount('#daftar-matkul', el('div', { class: 'sm:col-span-2' },
      emptyState(ICON.tambah, 'Belum ada mata kuliah',
        'Tambahkan mata kuliah supaya tugas bisa dikelompokkan dan jadwal tampil di dasbor.',
        el('button', { class: 'tombol-utama tombol-kecil mt-2', type: 'button', text: '+ Tambah mata kuliah',
          onclick: jalan(() => bukaFormMataKuliah()) }))
    ));
    return;
  }

  mount('#daftar-matkul', ...daftar.map((c) => {
    const jumlahTugas = state.tugas.filter((t) => t.course_id === c.id);
    const belum = jumlahTugas.filter((t) => t.status !== 'selesai').length;

    return el('div', { class: `kartu ${keWarnaKelas(c.warna)}` },
      el('div', { class: 'h-1.5 w-full rounded-t-2xl' }),
      el('div', { class: 'kartu-isi' },
        el('div', { class: 'flex items-start justify-between gap-2' },
          el('div', { class: 'min-w-0' },
            el('h3', { class: 'kartu-judul break-words', text: c.nama }),
            el('p', { class: 'mt-0.5 text-xs text-slate-500', text: [c.dosen, c.sks ? `${c.sks} SKS` : null].filter(Boolean).join(' - ') || 'Dosen belum diisi' })
          ),
          el('div', { class: 'flex shrink-0 gap-1' },
            el('button', { class: 'tombol-hantu tombol-bulat', type: 'button', title: 'Ubah', 'aria-label': `Ubah ${c.nama}`,
              onclick: jalan(() => bukaFormMataKuliah(c)) }, icon(ICON.pensil, { size: 16 })),
            el('button', { class: 'tombol-hantu tombol-bulat hover:bg-rose-50 hover:text-rose-600', type: 'button', title: 'Hapus', 'aria-label': `Hapus ${c.nama}`,
              onclick: jalan(() => konfirmasiHapusMataKuliah(c)) }, icon(ICON.sampah, { size: 16 }))
          )
        ),
        c.hari ? el('p', { class: 'mt-3 flex items-center gap-1.5 text-xs font-medium text-slate-600' },
          icon(ICON.jam, { size: 14, className: 'text-slate-400' }),
          [c.hari, [c.jam_mulai, c.jam_selesai].filter(Boolean).join('-')].filter(Boolean).join(' ')
        ) : null,
        el('p', { class: 'mt-3 text-[11px] font-semibold text-slate-500',
          text: belum ? `${belum} tugas belum selesai dari ${jumlahTugas.length}` : (jumlahTugas.length ? `${jumlahTugas.length} tugas selesai` : 'Belum ada tugas') })
      )
    );
  }));
}

function bukaFormMataKuliah(course = null) {
  const HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const warnaAwal = (course?.warna ?? PALET[0]).toLowerCase();

  const galeri = el('div', { class: 'flex flex-wrap gap-2', dataset: { pilihan: warnaAwal } },
    ...PALET.map((hex) => el('button', {
      class: `h-9 w-9 rounded-xl border-2 transition ${keWarnaKelas(hex)}-bulu ${
        hex === warnaAwal ? 'border-slate-900 ring-2 ring-offset-1 ring-slate-900' : 'border-transparent'
      }`,
      type: 'button',
      title: hex,
      'aria-label': `Pilih warna ${hex}`,
      onclick: (event) => {
        for (const btn of event.currentTarget.parentElement.children) {
          btn.classList.remove('border-slate-900', 'ring-2', 'ring-offset-1', 'ring-slate-900');
        }
        event.currentTarget.classList.add('border-slate-900', 'ring-2', 'ring-offset-1', 'ring-slate-900');
        event.currentTarget.parentElement.dataset.pilihan = hex;
      },
    }))
  );

  const body = el('div', {},
    field({ label: 'Nama mata kuliah', name: 'nama', required: true, value: course?.nama ?? '', placeholder: 'Contoh: Basis Data', maxlength: 120 }),
    field({ label: 'Dosen', name: 'dosen', value: course?.dosen ?? '', placeholder: 'Contoh: Dr. Budi Santoso', maxlength: 120 }),
    field({ label: 'SKS', name: 'sks', type: 'number', min: 0, max: 12, value: course?.sks ?? 3 }),
    el('div', { class: 'grid grid-cols-3 gap-3' },
      selectField({ label: 'Hari', name: 'hari', value: course?.hari ?? '', placeholder: '-', options: HARI.map((h) => ({ value: h, label: h })) }),
      field({ label: 'Mulai', name: 'jam_mulai', type: 'time', value: course?.jam_mulai ?? '' }),
      field({ label: 'Selesai', name: 'jam_selesai', type: 'time', value: course?.jam_selesai ?? '' })
    ),
    el('div', {},
      el('p', { class: 'label', text: 'Warna' }),
      galeri
    )
  );

  openModal({
    title: course ? 'Ubah mata kuliah' : 'Mata kuliah baru',
    body,
    submitLabel: course ? 'Simpan perubahan' : 'Tambah',
    onSubmit: async (formData) => {
      const payload = {
        nama: formData.get('nama').trim(),
        dosen: formData.get('dosen') || '',
        sks: Number(formData.get('sks') || 0),
        hari: formData.get('hari') || '',
        jam_mulai: formData.get('jam_mulai') || '',
        jam_selesai: formData.get('jam_selesai') || '',
        warna: galeri.dataset.pilihan,
      };

      if (!payload.nama) { toast('Nama mata kuliah wajib diisi.', 'gagal'); return false; }

      if (course) await api.ubahMataKuliah(course.id, payload);
      else await api.simpanMataKuliah(payload);

      toast(course ? 'Mata kuliah diperbarui.' : 'Mata kuliah ditambahkan.', 'sukses');
      await muatSemua();
      return true;
    },
  });
}

function konfirmasiHapusMataKuliah(course) {
  const jumlah = state.tugas.filter((t) => t.course_id === course.id).length;

  openModal({
    title: 'Hapus mata kuliah?',
    body: el('div', { class: 'space-y-2' },
      el('p', { class: 'text-sm leading-relaxed text-slate-600' },
        el('strong', { text: course.nama }), ' akan dihapus permanen.'),
      jumlah
        ? el('p', { class: 'rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-medium leading-relaxed text-amber-800' },
            `Perhatian: ${jumlah} tugas milik mata kuliah ini juga ikut terhapus.`)
        : null
    ),
    submitLabel: 'Hapus',
    danger: true,
    onSubmit: async () => {
      await api.hapusMataKuliah(course.id);
      toast('Mata kuliah dihapus.', 'sukses');
      await muatSemua();
      return true;
    },
  });
}

const PALET = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899'];

// ---------------------------------------------------------------------------
// Aktivitas
// ---------------------------------------------------------------------------

function renderAktivitas() {
  const selesai = state.aktivitas.filter((a) => a.selesai).length;
  $('#ringkasan-aktivitas').textContent = `${state.aktivitas.length} aktivitas - ${selesai} selesai`;

  if (!state.aktivitas.length) {
    mount('#daftar-aktivitas', emptyState(ICON.lokasi, 'Belum ada aktivitas',
      'Catat ceramah, rapat, atau operasi kuliah agar mudah diisi ulang hari berikutnya.',
      el('button', { class: 'tombol-utama tombol-kecil mt-2', type: 'button', text: '+ Tambah aktivitas',
        onclick: jalan(() => bukaFormAktivitas()) })));
    return;
  }

  // Kelompokkan per tanggal agar mudah dipindai.
  const grup = new Map();
  for (const akt of state.aktivitas) {
    const kunci = new Date(akt.tanggal).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (!grup.has(kunci)) grup.set(kunci, []);
    grup.get(kunci).push(akt);
  }

  mount('#daftar-aktivitas', ...[...grup.entries()].map(([tanggal, items]) =>
    el('section', { class: 'kartu overflow-hidden' },
      el('div', { class: 'flex items-center justify-between border-b border-slate-100 px-4 py-2.5' },
        el('h3', { class: 'text-xs font-bold uppercase tracking-wide text-slate-500', text: tanggal }),
        el('span', { class: 'text-[11px] font-semibold text-slate-400', text: `${items.filter((i) => i.selesai).length}/${items.length}` })
      ),
      ...items.map(kartuAktivitas)
    )
  ));
}

function kartuAktivitas(akt) {
  return el('div', { class: `baris-tugas ${akt.selesai ? 'selesai' : ''}` },
    el('button', {
      class: `mt-0.5 shrink-0 rounded-full border-2 transition ${
        akt.selesai ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-indigo-400'
      }`,
      type: 'button',
      title: akt.selesai ? 'Tandai belum selesai' : 'Tandai selesai',
      'aria-label': akt.selesai ? 'Tandai belum selesai' : 'Tandai selesai',
      onclick: jalan(async () => {
        await api.alihAktivitas(akt.id);
        toast(akt.selesai ? 'Ditandai belum selesai.' : 'Aktivitas selesai.', 'sukses', 1600);
        await muatSemua();
      }),
    }, icon(ICON.cek, { size: 14, stroke: 3 })),
    el('div', { class: 'min-w-0 flex-1' },
      el('p', { class: 'judul-tugas break-words', text: akt.nama }),
      el('div', { class: 'mt-1 flex flex-wrap items-center gap-1.5' },
        akt.kategori ? el('span', { class: 'lencana-indigo', text: akt.kategori }) : null,
        akt.lokasi ? el('span', { class: 'flex items-center gap-1 text-[11px] text-slate-500' },
          icon(ICON.lokasi, { size: 12 }), akt.lokasi) : null
      )
    ),
    el('div', { class: 'flex shrink-0 gap-1' },
      el('button', { class: 'tombol-hantu tombol-bulat', type: 'button', title: 'Ubah', 'aria-label': 'Ubah aktivitas',
        onclick: jalan(() => bukaFormAktivitas(akt)) }, icon(ICON.pensil, { size: 16 })),
      el('button', { class: 'tombol-hantu tombol-bulat hover:bg-rose-50 hover:text-rose-600', type: 'button', title: 'Hapus', 'aria-label': 'Hapus aktivitas',
        onclick: jalan(() => konfirmasiHapusAktivitas(akt)) }, icon(ICON.sampah, { size: 16 }))
    )
  );
}

function bukaFormAktivitas(akt = null) {
  const KATEGORI = ['Kuliah', 'Tugas', 'Organisasi', 'Karier', 'Kesehatan', 'Lainnya'];

  const body = el('div', {},
    field({ label: 'Nama aktivitas', name: 'nama', required: true, value: akt?.nama ?? '', placeholder: 'Contoh: Bimbingan skripsi', maxlength: 200 }),
    field({
      label: 'Tanggal & waktu', name: 'tanggal', type: 'datetime-local', required: true,
      value: waktuLokalUntukInput(akt?.tanggal) || waktuLokalUntukInput(new Date().toISOString()),
    }),
    el('div', { class: 'grid grid-cols-2 gap-3' },
      selectField({
        label: 'Kategori', name: 'kategori', value: akt?.kategori ?? '', placeholder: '-',
        options: KATEGORI.map((k) => ({ value: k, label: k })),
      }),
      field({ label: 'Lokasi', name: 'lokasi', value: akt?.lokasi ?? '', placeholder: 'Contoh: Ruang 302', maxlength: 160 })
    )
  );

  openModal({
    title: akt ? 'Ubah aktivitas' : 'Aktivitas baru',
    body,
    submitLabel: akt ? 'Simpan perubahan' : 'Tambah',
    onSubmit: async (formData) => {
      const payload = {
        nama: formData.get('nama').trim(),
        tanggal: new Date(formData.get('tanggal')).toISOString(),
        kategori: formData.get('kategori') || '',
        lokasi: formData.get('lokasi') || '',
      };
      if (!payload.nama) { toast('Nama aktivitas wajib diisi.', 'gagal'); return false; }
      if (Number.isNaN(Date.parse(payload.tanggal))) { toast('Tanggal tidak valid.', 'gagal'); return false; }

      if (akt) await api.ubahAktivitas(akt.id, payload);
      else await api.simpanAktivitas(payload);

      toast(akt ? 'Aktivitas diperbarui.' : 'Aktivitas ditambahkan.', 'sukses');
      await muatSemua();
      return true;
    },
  });
}

function konfirmasiHapusAktivitas(akt) {
  openModal({
    title: 'Hapus aktivitas?',
    body: el('p', { class: 'text-sm leading-relaxed text-slate-600' },
      el('strong', { text: akt.nama }), ' akan dihapus permanen.'),
    submitLabel: 'Hapus',
    danger: true,
    onSubmit: async () => {
      await api.hapusAktivitas(akt.id);
      toast('Aktivitas dihapus.', 'sukses');
      await muatSemua();
      return true;
    },
  });
}

// ---------------------------------------------------------------------------
// Pengaturan
// ---------------------------------------------------------------------------

function renderPengaturan() {
  const p = state.pengaturan;
  if (!p) {
    mount('#panel-telegram', el('p', { class: 'text-xs text-slate-500', text: 'Memuat status...' }));
    return;
  }

  const t = state.pengaturan.telegram;
  const deskripsi = t.configured
    ? `Peringatan deadline dikirim ke ${t.botUsername || 'bot CampusFlow'} pada H-24, H-3, dan H-1.`
    : 'Token bot belum diisi di file .env. Isi TELEGRAM_BOT_TOKEN lalu jalankan ulang server.';
  $('#deskripsi-telegram').textContent = deskripsi;

  if (t.linked) {
    mount('#panel-telegram',
      el('p', { class: 'flex items-center gap-2 text-sm font-semibold text-emerald-700' },
        icon(ICON.cek, { size: 16, stroke: 3 }), 'Terhubung'),
      t.chatLabel ? el('p', { class: 'text-xs text-slate-600 break-words', text: t.chatLabel }) : null,
      el('button', { class: 'tombol-bahaya tombol-kecil', type: 'button', text: 'Putuskan',
        onclick: jalan(async () => {
          await api.putuskanTelegram();
          toast('Telegram diputus.', 'sukses');
          await muatPengaturan();
        }) })
    );
  } else {
    const kodeArea = el('div', { class: 'space-y-2 mb-2', style: { display: 'none' } });

    mount('#panel-telegram',
      el('p', { class: 'flex items-center gap-2 text-sm font-semibold text-amber-700' },
        icon(ICON.info, { size: 16, stroke: 3 }), 'Belum terhubung'),
      kodeArea,
      el('button', { class: 'tombol-utama tombol-kecil', type: 'button', text: 'Buat kode tautan',
        onclick: jalan(async () => {
          try {
            const info = await api.mintaKodeTelegram();
            kodeArea.style.display = '';
            mount(kodeArea,
              el('p', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500', text: 'Kode sekali pakai' }),
              el('p', { class: 'kode-link text-center font-mono text-3xl font-black tracking-[0.3em] text-indigo-600', text: info.code }),
              el('p', { class: 'text-xs text-slate-600', text: `Kirim /start ${info.code} ke @Notifikasi_CampusFlow_Bot dalam 5 menit.` })
            );
            await mulaiPolling();
          } catch (err) {
            toast(err.panjangPesan || 'Gagal membuat kode.', 'gagal');
          }
        }) })
    );

    async function mulaiPolling() {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await api.pengaturan();
        if (status.telegram.linked) {
          toast('Telegram berhasil dihubungkan.', 'sukses');
          await muatPengaturan();
          return true;
        }
      }
      toast('Belum terdeteksi. Pastikan perintah /start sudah terkirim.', 'gagal', 5000);
      return false;
    }
  }

  // --- Jadwal ---
  $('#deskripsi-jadwal').textContent = `Zona waktu ${p.notify.timezone}. Pesan dikirim pada ${p.notify.thresholdsHours.map((h) => `H-${h}`).join(', ')} sebelum deadline.`;
  mount('#panel-jadwal',
    ...p.notify.thresholdsHours.map((h, i) => el('span', { class: 'lencana-indigo', text: `Tahap ${i + 1}: H-${h}` })),
    el('button', { class: 'tombol-sekunder tombol-kecil ml-1', type: 'button', text: 'Cek sekarang',
      onclick: jalan(async () => {
        const { summary } = await api.jalankanNotifikasi();
        const bagian = summary.checked < 0 ? 'engine tidak siap' : `${summary.checked} diperiksa, ${summary.sent} terkirim`;
        toast(`Cek notifikasi: ${bagian}.`, summary.failed ? 'gagal' : 'info', 4000);
        await muatSemua();
      }) })
  );

  renderPanelPwa();
  renderPanelKesehatan();
}

function renderPanelPwa() {
  const container = document.querySelector('#panel-pwa');
  if (!container) return;

  const node = window.__campusflowPwa;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  const baris = [];
  if (standalone) {
    baris.push(el('p', { class: 'flex items-center gap-2 text-sm font-semibold text-emerald-700' },
      icon(ICON.cek, { size: 16, stroke: 3 }), 'Sudah berjalan sebagai aplikasi'));
  } else if (node?.canInstall) {
    baris.push(el('button', { class: 'tombol-utama tombol-kecil', type: 'button', text: 'Pasang ke layar utama',
      onclick: async () => {
        try {
          await node.install();
          toast('Menunggu konfirmasi pemasangan.', 'info');
        } catch {
          toast('Pemasangan dibatalkan.', 'info');
        }
      } }));
  } else {
    baris.push(el('div', { class: 'space-y-2 text-xs leading-relaxed text-slate-500' },
      el('p', { text: 'Android/Chrome: menu browser > "Tambahkan ke layar utama".' }),
      el('p', { text: 'iPhone/iPad: Safari > Bagikan > "Add to Home Screen".' })
    ));
  }

  baris.push(el('p', { class: 'mt-3 flex items-center gap-1.5 text-[11px] font-medium text-slate-400' },
    icon(ICON.wifi, { size: 13 }),
    navigator.onLine ? 'Terhubung - data live' : 'Offline - menampilkan cache terakhir'
  ));

  mount(container, ...baris);
}

async function renderPanelKesehatan() {
  const container = document.querySelector('#panel-kesehatan');
  if (!container) return;

  try {
    const [h, s] = await Promise.all([api.kesehatan(), api.jadwal().catch(() => null)]);
    mount(container, el('dl', { class: 'grid grid-cols-2 gap-3 text-xs sm:grid-cols-4' },
      kotakStat('Status', h.status === 'ok' ? 'Sehat' : 'Bermasalah'),
      kotakStat('RAM proses', `${h.rssMb} MB`),
      kotakStat('Uptime', `${Math.floor(h.uptimeSeconds / 60)} menit`),
      kotakStat('Engine notifikasi', s ? (s.scheduler.stopped ? 'Berhenti' : 'Aktif') : '-')
    ));
  } catch {
    mount(container, el('p', { class: 'text-xs text-slate-400', text: 'Status server tidak bisa dibaca.' }));
  }
}

function kotakStat(label, nilai) {
  return el('div', { class: 'rounded-xl bg-slate-50 px-3 py-2' },
    el('dt', { class: 'text-[10px] font-bold uppercase tracking-wider text-slate-400', text: label }),
    el('dd', { class: 'mt-0.5 text-sm font-bold text-slate-700', text: nilai })
  );
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function muatSemua() {
  try {
    const [ringkasan, tugas, mataKuliah, aktivitas] = await Promise.all([
      api.ringkasan(),
      api.daftarTugas(),
      api.daftarMataKuliah(),
      api.daftarAktivitas(),
    ]);

    state.ringkasan = ringkasan;
    state.tugas = tugas.tasks;
    state.mataKuliah = mataKuliah.courses;
    state.aktivitas = aktivitas.activities;

    renderDashboard();
    renderTugas();
    renderMataKuliah();
    renderAktivitas();
    setStatus('live', `Sinkron ${waktuRelatif()}`);
  } catch (err) {
    if (err instanceof OfflineError) {
      setStatus('offline', 'Offline - menampilkan cache');
      renderTabelKosongOffline();
    }
    throw err;
  }
}

function renderTabelKosongOffline() {
  for (const sel of ['#daftar-tugas', '#daftar-matkul', '#daftar-aktivitas']) {
    const node = $(sel);
    if (node && !node.childElementCount) {
      mount(node, emptyState(ICON.wifi, 'Sedang offline', 'Data akan muncul lagi begitu koneksi kembali.'));
    }
  }
  if (!$('#kartu-statistik').childElementCount) mount('#kartu-statistik', spinner());
}

async function muatPengaturan() {
  state.pengaturan = await api.pengaturan();
  renderPengaturan();
}

async function mulaiAplikasi() {
  tampilkanAplikasi();
  setStatus('live', 'Memuat data...');
  renderFilterTugas();

  await Promise.allSettled([muatSemua(), muatPengaturan()]);
}

function initNavigasi() {
  for (const btn of document.querySelectorAll('.nav-item[data-tab]')) {
    btn.addEventListener('click', () => tampilkanLayar(btn.dataset.tab));
  }

  $('#btn-pengaturan').addEventListener('click', () => tampilkanLayar('pengaturan'));
  $('#btn-muat-ulang').addEventListener('click', jalan(async () => {
    setStatus('live', 'Memuat ulang...');
    await muatSemua();
    toast('Data dimuat ulang.', 'sukses', 1600);
  }));
  $('#btn-tambah-tugas').addEventListener('click', jalan(() => bukaFormTugas()));
  $('#btn-tambah-matkul').addEventListener('click', jalan(() => bukaFormMataKuliah()));
  $('#btn-tambah-aktivitas').addEventListener('click', jalan(() => bukaFormAktivitas()));
  $('#btn-keluar').addEventListener('click', jalan(async () => {
    await api.keluar();
    location.reload();
  }));

  window.addEventListener('online', () => { setStatus('live', 'Koneksi kembali'); jalan(muatSemua)(); });
  window.addEventListener('offline', () => setStatus('offline', 'Offline - menampilkan cache'));

  // Ulang kalender saat tanggal berganti, supaya label "hari ini" tetap benar.
  let hariTerakhir = new Date().getDate();
  setInterval(() => {
    if (new Date().getDate() !== hariTerakhir) {
      hariTerakhir = new Date().getDate();
      if (state.ringkasan) jalan(muatSemua)();
    }
  }, 60_000);
}

async function init() {
  initModal();
  initMasuk();
  initNavigasi();
  registerPwa({
    onUpdateReady: () => $('#wadah-pembaruan').classList.remove('hidden'),
  });
  $('#btn-perbarui').addEventListener('click', () => window.location.reload());

  if (await cekSesi()) {
    await mulaiAplikasi();
  } else {
    tampilkanMasuk();
  }
}

init();
