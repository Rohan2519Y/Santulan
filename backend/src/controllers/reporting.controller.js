/*
 * Report endpoints (contracts/api.md §5, BUILD 07 §18). The internal routes take no body content (a strict empty schema), so nothing
 * a caller sends can influence a snapshot; the participant route returns released sections of the participant's own report only.
 */
const { z } = require('zod');
const { HttpError } = require('../errors');
const { strictObject } = require('../middleware/http');
const service = require('../services/reporting/reportService');

const emptySchema = strictObject({});

const uuidParam = (req, what) => {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(404, what === 'report' ? 'REPORT_NOT_READY' : 'NOT_FOUND', `${what === 'report' ? 'Report' : 'Attempt'} not found`);
  return parsed.data;
};
const handler = (fn) => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) { next(err); }
};

module.exports = {
  emptySchema,
  generate: handler((req) => service.generateReport(uuidParam(req, 'attempt'), { correlationId: req.correlationId })),
  retry: handler((req) => service.retryReport(uuidParam(req, 'report'), {
    correlationId: req.correlationId,
    actorType: req.actor.scope === 'SUPER_ADMIN' ? 'ADMIN' : 'SYSTEM',
    actorId: req.actor.scope === 'SUPER_ADMIN' ? req.actor.adminUserId : null,
  })),
  get: handler((req) => service.getParticipantReport(req.actor.participantId, uuidParam(req, 'report'))),
};
