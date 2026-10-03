'use strict';

const express = require('express');
const v = require('../middleware/validate');
const { AppError, asyncHandler } = require('../middleware/error');
const courses = require('../repositories/courses');

const router = express.Router();

const FIELDS = ['nama', 'dosen', 'sks', 'hari', 'jam_mulai', 'jam_selesai', 'warna'];

/** Jam "08:00" atau "08:00-10:00" disimpan apa adanya; dipakai hanya sebagai teks. */
function jam(value, field) {
  if (value === undefined || value === null || value === '') return '';
  const raw = v.str(value, field, { max: 32 });
  if (raw && !/^\d{2}:\d{2}(-\d{2}:\d{2})?$/.test(raw)) {
    throw AppError.badRequest(`${field} harus format HH:MM atau HH:MM-HH:MM.`);
  }
  return raw;
}

function parseBody(body, { partial = false } = {}) {
  v.rejectUnknownKeys(body, FIELDS, 'course');
  if (!partial && (body.nama === undefined)) {
    throw AppError.badRequest('nama wajib diisi.');
  }

  const out = {};
  if (body.nama !== undefined) out.nama = v.str(body.nama, 'Nama mata kuliah', { min: 1, max: 120 });
  if (body.dosen !== undefined) out.dosen = v.optionalStr(body.dosen, 'Dosen', { max: 120 });
  if (body.sks !== undefined) out.sks = v.int(body.sks, 'SKS', { min: 0, max: 12, fallback: 0 });
  if (body.hari !== undefined) out.hari = v.optionalStr(body.hari, 'Hari', { max: 60 });
  if (body.jam_mulai !== undefined) out.jam_mulai = jam(body.jam_mulai, 'Jam mulai');
  if (body.jam_selesai !== undefined) out.jam_selesai = jam(body.jam_selesai, 'Jam selesai');
  if (body.warna !== undefined) out.warna = v.hexColor(body.warna, 'Warna');
  return out;
}

router.get('/', asyncHandler(async (req, res) => {
  res.json({ courses: courses.list() });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const course = courses.findById(v.idParam(req.params.id));
  if (!course) throw AppError.notFound('Mata kuliah tidak ditemukan.');
  res.json({ course });
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = parseBody(v.objectBody(req));
  const course = courses.create(data);
  res.status(201).json({ course });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const id = v.idParam(req.params.id);
  const data = parseBody(v.objectBody(req), { partial: true });
  const course = courses.update(id, data);
  if (!course) throw AppError.notFound('Mata kuliah tidak ditemukan.');
  res.json({ course });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const removed = courses.remove(v.idParam(req.params.id));
  if (!removed) throw AppError.notFound('Mata kuliah tidak ditemukan.');
  res.status(204).end();
}));

module.exports = router;
