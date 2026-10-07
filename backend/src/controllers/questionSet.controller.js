/*
 * Question-set endpoints (contracts/api-delta.md section 1). Active SUPER_ADMIN only (wired in santulan.routes.js). The upload is
 * multipart (`file` + `ageGroup`) parsed by multer into memory (2 MB cap) BEFORE this controller; the file is never written to disk.
 */
const multer = require('multer');
const { HttpError } = require('../errors');
const service = require('../services/questionsets/questionSetService');
const schemas = require('../services/questionsets/questionSet.schemas');
const { buildTemplate, TEMPLATE_FILE_NAME } = require('../services/questionsets/template');
const { buildResponseDistributionWorkbook } = require('../services/questionsets/responseDistributionWorkbook');
const { MAX_BYTES } = require('../services/questionsets/questionSetParser');
const unifiedExport = require('../services/research/unifiedExportService');

const uploadFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } }).single('file');

/** multer wrapper: a file over the cap is 413 UPLOAD_TOO_LARGE (handled by the shared error handler). */
const receiveUpload = (req, res, next) => uploadFile(req, res, next);

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

const setId = (req) => {
  const p = schemas.idParam.safeParse(req.params.id);
  if (!p.success) throw new HttpError(404, 'NOT_FOUND', 'Question set not found');
  return p.data;
};

const itemId = (req) => {
  const p = schemas.idParam.safeParse(req.params.itemId);
  if (!p.success) throw new HttpError(404, 'NOT_FOUND', 'Question not found');
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
  /** Validates only - nothing is saved. The admin reviews this (question count, domains, any problems) and, if they
   * want to proceed, re-submits the same file to the real upload endpoint above to actually add it. */
  previewUpload: wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'VALIDATION_ERROR', 'A question workbook file is required (field "file")');
    const extra = Object.keys(req.body || {}).filter((k) => k !== 'ageGroup');
    if (extra.length) throw new HttpError(400, 'VALIDATION_ERROR', `Unknown field(s): ${extra.join(', ')}`);
    res.json(service.preview({ buffer: req.file.buffer, fileName: req.file.originalname, ageGroup: req.body.ageGroup }));
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
  setItemStatus: wrap(async (req, res) => { res.json(await service.setItemStatus(req.actor, setId(req), itemId(req), req.body.status, req.body.reason, req.correlationId)); }),
  responseDistribution: wrap(async (req, res) => { res.json(await service.responseDistribution(req.actor, setId(req))); }),
  exportResponseDistribution: async (req, res, next) => {
    try {
      const distribution = await service.responseDistribution(req.actor, setId(req));
      const fileTag = `${distribution.versionLabel}-r${distribution.revision}`.replace(/[^A-Za-z0-9_-]/g, '');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="santulan-response-distribution-${fileTag}.xlsx"`);
      res.send(await buildResponseDistributionWorkbook(distribution));
    } catch (err) { next(err); }
  },
  /** The unified report+research workbook (TECH_TEAM_GUIDE.md format) for every attempt of this set. Real names, real
   * scores - a separate, restricted export from response-distribution above. */
  exportUnified: async (req, res, next) => {
    let file = null;
    try {
      const result = await unifiedExport.generateForSet(req.actor, setId(req), req.correlationId);
      file = result.file;
      const fileTag = `${result.versionLabel}-r${result.revision}`.replace(/[^A-Za-z0-9_-]/g, '');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="santulan-unified-report-export-${fileTag}.xlsx"`);
      res.sendFile(file, (err) => {
        unifiedExport.cleanup(file);
        if (err && !res.headersSent) next(err);
      });
    } catch (err) {
      if (file) unifiedExport.cleanup(file);
      next(err);
    }
  },
  setId,
  itemId,
  schemas,
};
