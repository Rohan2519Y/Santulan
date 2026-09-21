/*
 * Quality / scoring endpoints (contracts/api.md §5, BUILD 06 §14). The internal routes accept the internal key only; their
 * request schemas are strict, so a body carrying rawScore / scoreStatus / disposition is a 400, never ignored input.
 */
const { z } = require('zod');
const { HttpError } = require('../../../shared/errors');
const { strictObject } = require('../shared/http');
const service = require('./scoreService');
const { fireQ09 } = require('../quality/q09Trigger');

const emptySchema = strictObject({});
const scoreSchema = strictObject({ scoringVersion: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/) });
const safeguardingSchema = strictObject({ triggerSource: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/) });

const attemptId = (req) => {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
  return parsed.data;
};
const handler = (fn) => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) { next(err); }
};

module.exports = {
  emptySchema, scoreSchema, safeguardingSchema,
  quality: handler((req) => service.runQualityCheck(attemptId(req), req.correlationId)),
  score: handler((req) => service.scoreAttempt(attemptId(req), req.body.scoringVersion, req.correlationId)),
  qualityFlags: handler((req) => service.listQualityFlags(attemptId(req))),
  safeguarding: handler((req) => fireQ09({ attemptId: attemptId(req), triggerSource: req.body.triggerSource, correlationId: req.correlationId })),
};
