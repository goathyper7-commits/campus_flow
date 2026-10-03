'use strict';

const express = require('express');
const v = require('../middleware/validate');
const { AppError, asyncHandler } = require('../middleware/error');
const tasks = require('../repositories/tasks');
const courses = require('../repositories/courses');

const router = express.Router();

const FIELDS = ['course_id', 'judul', 'deskripsi', 'deadline', 'prioritas', 'status'];

function parseBody(body, { partial = false } = {}) {
  v.rejectUnknownKeys(body, FIELDS, 'task');
  if (!partial && body.judul === undefined) throw AppError.badRequest('judul wajib diisi.');
  if (!partial && body.course_id === undefined) throw AppError.badRequest('course_id wajib diisi.');
  if (!partial && body.deadline === undefined) throw AppError.badRequest('deadline wajib diisi.');

  const out = {};
  if (body.course_id !== undefined) {
    const id = v.int(body.course_id, 'Mata kuliah', { min: 1 });
    if (!courses.findById(id)) {
      throw AppError.badRequest('Mata kuliah tidak ditemukan.', { course_id: id });
    }
    out.course_id = id;
  }
  if (body.judul !== undefined) out.judul = v.str(body.judul, 'Judul', { min: 1, max: 200 });
  if (body.deskripsi !== undefined) out.deskripsi = v.optionalStr(body.deskripsi, 'Deskripsi', { max: 2000 });
  if (body.deadline !== undefined) {
    // Deadline boleh di masa lalu hanya saat menyunting: user mungkin baru
    // memasukkan tugas yang telat. Notifikasi tetap dilewati karena
    // query kandidat mensyaratkan deadline di masa depan.
    out.deadline = v.isoDate(body.deadline, 'Deadline', { allowPast: partial });
  }
  if (body.prioritas !== undefined) out.prioritas = v.enumOf(body.prioritas, 'Prioritas', tasks.PRIORITIES);
  if (body.status !== undefined) out.status = v.enumOf(body.status, 'Status', tasks.STATUSES);
  return out;
}

function parseFilters(query) {
  const filters = {};
  if (query.status) filters.status = v.enumOf(query.status, 'status', tasks.STATUSES);
  if (query.course_id) filters.course_id = v.int(query.course_id, 'course_id', { min: 1 });
  if (query.from) filters.from = v.isoDate(query.from, 'from', { allowPast: true });
  if (query.to) filters.to = v.isoDate(query.to, 'to', { allowPast: true });
  if (query.overdue !== undefined) filters.overdue = query.overdue !== 'false' && query.overdue !== '0';
  if (query.open !== undefined) filters.open = query.open !== 'false' && query.open !== '0';
  return filters;
}

router.get('/', asyncHandler(async (req, res) => {
  res.json({ tasks: tasks.list(parseFilters(req.query)) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const task = tasks.findById(v.idParam(req.params.id));
  if (!task) throw AppError.notFound('Tugas tidak ditemukan.');
  res.json({ task });
}));

router.post('/', asyncHandler(async (req, res) => {
  const task = tasks.create(parseBody(v.objectBody(req)));
  res.status(201).json({ task });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const id = v.idParam(req.params.id);
  const task = tasks.update(id, parseBody(v.objectBody(req), { partial: true }));
  if (!task) throw AppError.notFound('Tugas tidak ditemukan.');
  res.json({ task });
}));

router.post('/:id/status', asyncHandler(async (req, res) => {
  const body = v.objectBody(req);
  v.rejectUnknownKeys(body, ['status'], 'status');
  const status = v.enumOf(body.status, 'Status', tasks.STATUSES);
  const task = tasks.setStatus(v.idParam(req.params.id), status);
  if (!task) throw AppError.notFound('Tugas tidak ditemukan.');
  res.json({ task });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (!tasks.remove(v.idParam(req.params.id))) {
    throw AppError.notFound('Tugas tidak ditemukan.');
  }
  res.status(204).end();
}));

module.exports = router;
