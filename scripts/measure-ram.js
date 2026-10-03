'use strict';

/**
 * Cek anggaran memori: blueprint menuntut backend di bawah 80 MB RAM.
 *
 *   npm run measure:ram
 *
 * Mengukur RSS proses setelah dipanaskan lalu setelah tiap rangkaian
 * request. Yang diukur adalah resident set size, karena itu angka yang
 * terlihat di Task Manager dan yang jadi acuan KPI.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const LIMIT_MB = Number(process.env.RAM_LIMIT_MB || 80);
const WARMUP_MS = 1500;
const SAMPLES = 8;
const GAP_MS = 250;

function rssMb(pid) {
  return new Promise((resolve) => {
    require('node:child_process').execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`],
      (err, stdout) => {
        if (err) return resolve(null);
        const bytes = Number(String(stdout).trim());
        resolve(Number.isFinite(bytes) ? bytes / 1024 / 1024 : null);
      }
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')],
    {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: process.env.MEASURE_PORT || '3199' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const base = `http://127.0.0.1:${process.env.MEASURE_PORT || 3199}`;
  child.stdout.on('data', (d) => process.stdout.write(`  [server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`  [server!] ${d}`));

  const results = [];
  try {
    await sleep(WARMUP_MS);

    const warm = await rssMb(child.pid);
    results.push({ tahap: 'setelah boot', rss: warm });
    process.stdout.write(`\n  setelah boot      : ${warm?.toFixed(1)} MB\n`);

    // Sequence request yang meniru pemakaian nyata: dashboard + daftar penuh
    // beberapa kali. Widget yang tidak bisa(load) setelah dipanggil berulang
    // akan menunjukkan usage membengkak.
    for (let i = 1; i <= SAMPLES; i += 1) {
      for (const endpoint of [
        '/api/health',
        '/api/dashboard/summary',
        '/api/tasks?open=1',
        '/api/courses',
        '/api/activities',
      ]) {
        await fetch(`${base}${endpoint}`).catch(() => {});
      }
      await sleep(GAP_MS);
      const mb = await rssMb(child.pid);
      results.push({ tahap: `${i}/${SAMPLES} rangkaian request`, rss: mb });
      process.stdout.write(`  ${String(i).padStart(2)}/${SAMPLES} request  : ${mb?.toFixed(1)} MB\n`);
    }

    const measured = results.map((r) => r.rss).filter((v) => typeof v === 'number');
    const peak = measured.length ? Math.max(...measured) : null;

    process.stdout.write('\n  --------------------------------------------------\n');
    process.stdout.write(`  puncak RSS : ${peak?.toFixed(1)} MB\n`);
    process.stdout.write(`  anggaran   : ${LIMIT_MB} MB\n`);

    if (peak !== null && peak > LIMIT_MB) {
      process.stdout.write(`  HASIL      : GAGAL - melewati anggaran\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`  HASIL      : LOLOS (${LIMIT_MB - peak.toFixed(1)} MB di bawah anggaran)\n`);
    }
  } finally {
    child.kill('SIGTERM');
    await sleep(600);
    if (!child.killed) child.kill('SIGKILL');
  }
}

main().catch((err) => {
  process.stderr.write(`measure-ram gagal: ${err.message}\n`);
  process.exitCode = 1;
});
