/*
 * Question-set endpoints (contracts/api-delta.md section 1). Active SUPER_ADMIN only (wired in santulan.routes.js). The upload is
 * multipart (`file` + `ageGroup`) parsed by multer into memory (2 MB cap) BEFORE this controller; the file is never written to disk.
 */
const multer = require('multer');
const { HttpError } = require('../errors');
const service = require('../services/questionsets/questionSetService');
const schemas = require('../services/questionsets/questionSet.schemas');
const { buildTemplate, TEMPLATE_FILE_NAME } = require('../services/questionsets/template');
const { MAX_BYTES } = require('../services/questionsets/questionSetParser');

const uploadFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } }).single('file');

/** multer wrapper: a file over the cap is 413 UPLOAD_TOO_LARGE (handled by the shared error handler). */
const receiveUpload = (req, res, next) => uploadFile(req, res, next);

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

const setId = (req) => {
  const p = schemas.idParam.safeParse(req.params.id);
  if (!p.success) throw new HttpError(404, 'NOT_FOUND', 'Question set not found');
  return p.data;
};

module.exports = {
  receiveUpload,
  template: wrap(async (req, res) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${TEMPLATE_FILE_NAME}"`);
    res.send(buildTemplate());
  }),
  upload: wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'VALIDATION_ERROR', 'A question workbook file is required (field "file")');
    const extra = Object.keys(req.body || {}).filter((k) => k !== 'ageGroup');
    if (extra.length) throw new HttpError(400, 'VALIDATION_ERROR', `Unknown field(s): ${extra.join(', ')}`);
    const result = await service.upload({ buffer: req.file.buffer, fileName: req.file.originalname, ageGroup: req.body.ageGroup, actor: req.actor, correlationId: req.correlationId });
    res.status(result.status).json(result.body);
  }),
  list: wrap(async (req, res) => {
    const q = schemas.listQuery.safeParse(req.query);
    if (!q.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid filter');
    res.json({ sets: await service.list(req.actor, q.data) });
  }),
  get: wrap(async (req, res) => { res.json(await service.get(req.actor, setId(req))); }),
  freeze: wrap(async (req, res) => { res.json(await service.freeze(req.actor, setId(req), req.correlationId)); }),
  open: wrap(async (req, res) => { res.json(await service.open(req.actor, setId(req), req.body.reason, req.correlationId)); }),
  close: wrap(async (req, res) => { res.json(await service.close(req.actor, setId(req), req.body.reason, req.correlationId)); }),
  delete: wrap(async (req, res) => { res.json(await service.deleteDraft(req.actor, setId(req), req.correlationId)); }),
  setId,
  schemas,
};
