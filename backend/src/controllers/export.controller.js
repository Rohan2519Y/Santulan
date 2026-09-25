/*
 * Research export endpoints (contracts/api.md section 6): request (Idempotency-Key), status, list and download. Active SUPER_ADMIN only.
 * The download streams the file and never returns a path; its audit row is written first and a failure to audit refuses the download.
 */
const fs = require('fs');
const { z } = require('zod');
const { HttpError } = require('../errors');
const { strictObject } = require('../middleware/http');
const service = require('../services/research/exportService');

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const requestSchema = strictObject({
  sourceAssessmentVersionId: z.string().uuid(),
  anonymisationVersion: z.string().trim().min(1).max(64),
  filters: z.record(z.any()).optional(), // keys are checked by the export rules so an unknown key is EXPORT_FILTER_UNKNOWN (422), not a generic 400
  includeAllVersions: z.boolean().optional(),
});

function idempotencyKey(req) {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 16 || key.length > 128) throw new HttpError(400, 'VALIDATION_ERROR', 'An Idempotency-Key header of 16 to 128 characters is required');
  return key;
}
const idParam = (req) => {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(404, 'NOT_FOUND', 'Export not found');
  return parsed.data;
};

module.exports = {
  requestSchema,
  request: async (req, res, next) => {
    try {
      const { replay, ...body } = await service.request(req.actor, { idempotencyKey: idempotencyKey(req), body: req.body, correlationId: req.correlationId });
      res.status(replay ? 200 : 202).json(body);
    } catch (err) { next(err); }
  },
  list: async (req, res, next) => { try { res.json(await service.list(req.actor)); } catch (err) { next(err); } },
  status: async (req, res, next) => { try { res.json(await service.getStatus(req.actor, idParam(req))); } catch (err) { next(err); } },
  download: async (req, res, next) => {
    try {
      const file = await service.prepareDownload(req.actor, idParam(req), req.correlationId);
      res.setHeader('Content-Type', XLSX);
      res.setHeader('Content-Length', String(file.size));
      res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
      res.setHeader('Cache-Control', 'no-store');
      const stream = fs.createReadStream(file.file);
      stream.on('error', (err) => { if (!res.headersSent) next(err); else res.destroy(err); });
      stream.pipe(res);
    } catch (err) { next(err); }
  },
};
