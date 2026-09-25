/*
 * Pathway decision endpoint (contracts/api.md §5, BUILD 07 §18): internal key or an active super admin only. The request never carries
 * an evidence state, a participant id or a score - the engine derives them from the attempt.
 */
const { z } = require('zod');
const { HttpError } = require('../errors');
const service = require('../services/pathways/pathwayService');

const handler = (fn) => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) { next(err); }
};

module.exports = {
  decisionSchema: service.decisionSchema,
  decide: handler((req) => {
    const parsed = z.string().uuid().safeParse(req.params.id);
    if (!parsed.success) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
    return service.decide(parsed.data, req.body, { correlationId: req.correlationId });
  }),
};
