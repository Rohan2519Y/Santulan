/*
 * Admin endpoints for governed report wording (interpretation_rules). Active SUPER_ADMIN only (wired in santulan.routes.js).
 */
const { z } = require('zod');
const { HttpError } = require('../errors');
const { strictObject } = require('../middleware/http');
const service = require('../services/content/wordingService');

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

const uuid = z.string().uuid();
const listQuery = z.object({ assessmentVersionId: uuid });
const addSchema = strictObject({
  assessmentVersionId: uuid,
  domain: z.enum(service.DOMAINS),
  band: z.enum(service.BANDS).nullable().optional(),
  evidenceState: z.enum(service.STATES),
  locale: z.string().trim().min(1).max(16),
  layer: z.enum(service.LAYERS),
  version: z.string().trim().min(1).max(32),
  text: z.string().trim().min(1).max(4000),
});
const approveSchema = strictObject({ reason: z.string().trim().min(3).max(300) });

const ruleIdParam = (req) => {
  const p = uuid.safeParse(req.params.id);
  if (!p.success) throw new HttpError(404, 'NOT_FOUND', 'Wording rule not found');
  return p.data;
};

module.exports = {
  addSchema,
  approveSchema,
  list: wrap(async (req, res) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) throw new HttpError(400, 'VALIDATION_ERROR', 'assessmentVersionId is required');
    res.json(await service.list(req.actor, q.data.assessmentVersionId));
  }),
  add: wrap(async (req, res) => {
    const result = await service.add(req.actor, req.body, req.correlationId);
    res.status(result.created ? 201 : 200).json(result.rule);
  }),
  approve: wrap(async (req, res) => {
    res.json(await service.approve(req.actor, ruleIdParam(req), req.body.reason, req.correlationId));
  }),
};
