'use strict';

const express = require('express');
const v = require('../middleware/validate');
const { AppError, asyncHandler } = require('../middleware/error');
const activities = require('../repositories/activities');

const router = express.Router();

const FIELDS = ['nama', 'kategori', 'tanggal', 'lokasi', 'selesai'];

function parseBody(body, { partial = false } = {}) {
  v.rejectUnknownKeys(body, FIELDS, 'activity');
  if (!partial && body.nama === undefined) throw AppError.badRequest('nama wajib diisi.');
  if (!partial && body.tanggal === undefined) throw AppError.badRequest('tanggal wajib diisi.');

  const out = {};
  if (body.nama !== undefined) out.nama = v.str(body.nama, 'Nama aktivitas', { min: 1, max: 200 });
  if (body.kategori !== undefined) out.kategori = v.optionalStr(body.kategori, 'Kategori', { max: 60 });
  if (body.lokasi !== undefined) out.lokasi = v.optionalStr(body.lokasi, 'Lokasi', { max: 160 });
  if (body.selesai !== undefined) {
    if (typeof body.selesai !== 'boolean') {
      throw AppError.badRequest('selesai harus true atau false.');
    }
    out.selesai = body.selesai;
  }
  if (body.tanggal !== undefined) {
    // Aktivitas boleh bertanggal lampau (logbook) maupun masa depan (rencana).
    out.tanggal = v.isoDate(body.tanggal, 'Tanggal', { allowPast: true });
  }
  return out;
}

router.get('/', asyncHandler(async (req, res) => {
  const filters = {};
  if (req.query.from) filters.from = v.isoDate(req.query.from, 'from', { allowPast: true });
  if (req.query.to) filters.to = v.isoDate(req.query.to, 'to', { allowPast: true });
  if (req.query.done !== undefined) filters.done = req.query.done === 'true' || req.query.done === '1';
  res.json({ activities: activities.list(filters) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const activity = activities.findById(v.idParam(req.params.id));
  if (!activity) throw AppError.notFound('Aktivitas tidak ditemukan.');
  res.json({ activity });
}));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json({ activity: activities.create(parseBody(v.objectBody(req))) });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const activity = activities.update(v.idParam(req.params.id), parseBody(v.objectBody(req), { partial: true }));
  if (!activity) throw AppError.notFound('Aktivitas tidak ditemukan.');
  res.json({ activity });
}));

router.post('/:id/toggle', asyncHandler(async (req, res) => {
  const activity = activities.toggle(v.idParam(req.params.id));
  if (!activity) throw AppError.notFound('Aktivitas tidak ditemukan.');
  res.json({ activity });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (!activities.remove(v.idParam(req.params.id))) {
    throw AppError.notFound('Aktivitas tidak ditemukan.');
  }
  res.status(204).end();
}));

module.exports = router;
