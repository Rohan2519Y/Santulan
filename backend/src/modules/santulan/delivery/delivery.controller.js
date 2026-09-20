/*
 * Delivery endpoints (contracts/api.md §4). Every route requires a participant token; the participant id is never read
 * from the body or path. Request schemas are strict, so a body carrying score / rawScore / participantId / versionId is a 400.
 */
const { z } = require('zod');
const { HttpError } = require('../../../shared/errors');
const { strictObject } = require('../shared/http');
const attempts = require('./attemptService');
const responses = require('./responseService');
const { submitAttempt } = require('./submitService');

const createSchema = strictObject({});
const emptySchema = strictObject({});
const pauseSchema = strictObject({ reason: z.enum(['PARTICIPANT', 'LOGOUT']).optional() });
const saveResponseSchema = strictObject({
  itemId: z.string().uuid(),
  value: z.string().regex(/^[0-9]{1,2}$/),                      // the frozen scale (1-5) is enforced by the database
  responseTimeMs: z.number().int().min(0).max(3600000).optional(),
  presentedOrder: z.number().int().min(1).max(1000).optional(),
  idempotencyKey: z.string().min(16).max(128),
});
const submitSchema = strictObject({ submissionKey: z.string().min(16).max(128) });

const attemptId = (req) => {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
  return parsed.data;
};
const handler = (fn, status = 200) => async (req, res, next) => {
  try { res.status(status).json(await fn(req)); } catch (err) { next(err); }
};
const me = (req) => req.actor.participantId;

module.exports = {
  createSchema, emptySchema, pauseSchema, saveResponseSchema, submitSchema,
  create: handler((req) => attempts.createAttempt(me(req), req.correlationId), 201),
  resume: handler((req) => attempts.beginOrResume(me(req), attemptId(req))),
  pause: handler((req) => attempts.pause(me(req), attemptId(req), req.body.reason)),
  saveResponse: handler((req) => responses.saveResponse(me(req), attemptId(req), req.body)),
  submit: handler((req) => submitAttempt(me(req), attemptId(req), req.body.submissionKey, req.correlationId)),
  get: handler((req) => attempts.getResumeModel(me(req), attemptId(req))),
  items: handler((req) => attempts.getItems(me(req), attemptId(req))),
  currentResponses: handler((req) => attempts.getCurrentResponses(me(req), attemptId(req))),
};
