'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/error');
const tasks = require('../repositories/tasks');
const activities = require('../repositories/activities');
const coursesRepo = require('../repositories/courses');
const { config } = require('../config');

const router = express.Router();

const DAY = 86_400_000;

function startOfLocalDay(offsetDays = 0, timezone = config.notify.timezone) {
  // "Hari ini" harus dihitung di timezone pengguna, bukan UTC. Kalau dihitung
  // dengan UTC, tugas jam 2 pagi WIB akan terbaca sebagai besok.
  const now = new Date(Date.now() + offsetDays * DAY);
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Ringkasan untuk kartu dashboard. Dihitung server-side supaya client tidak
 * perlu menarik seluruh tabel hanya untuk membuat 4 angka.
 */
router.get('/summary', asyncHandler(async (req, res) => {
  const tz = config.notify.timezone;
  const todayStart = startOfLocalDay(0, tz);
  const tomorrowStart = startOfLocalDay(1, tz);
  const weekAhead = new Date(Date.now() + 7 * DAY);

  const open = tasks.list({ open: true });
  const overdue = open.filter((t) => Date.parse(t.deadline) < Date.now());
  const dueToday = open.filter((t) => {
    const ts = Date.parse(t.deadline);
    return ts >= todayStart.getTime() && ts < tomorrowStart.getTime();
  });

  const byPriority = { tinggi: 0, sedang: 0, rendah: 0 };
  for (const task of open) byPriority[task.prioritas] = (byPriority[task.prioritas] || 0) + 1;

  const week = open
    .filter((t) => Date.parse(t.deadline) <= weekAhead.getTime())
    .slice(0, 8);

  const todayActivities = activities.list({
    from: todayStart.toISOString(),
    to: tomorrowStart.toISOString(),
  });

  const nextCourse = coursesRepo.list()
    .filter((c) => c.hari && c.hari.trim())
    .slice(0, 1)[0] || null;

  res.json({
    generatedAt: new Date().toISOString(),
    timezone: tz,
    stats: {
      openTotal: open.length,
      dueToday: dueToday.length,
      overdue: overdue.length,
      weekAhead: week.length,
      doneTotal: tasks.list({ status: 'selesai' }).length,
      courseTotal: coursesRepo.list().length,
      activityToday: todayActivities.length,
      activityTodayDone: todayActivities.filter((a) => a.selesai).length,
    },
    byPriority,
    nextCourses: week,
    overdue,
    todayActivities,
    nextCourse,
  });
}));

module.exports = router;
