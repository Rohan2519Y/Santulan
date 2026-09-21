/*
 * Growth plan endpoints (contracts/api.md §5). Participant token only; the participant is always taken from the token. Every route
 * answers 404 until the prescriptive release has flipped (see growthService.loadPlan). No score, evidence state or pathway data is returned.
 */
const { z } = require('zod');
const { HttpError } = require('../../../shared/errors');
const service = require('./growthService');

const planId = (req) => {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(404, 'NOT_FOUND', 'Growth plan not found');
  return parsed.data;
};
const handler = (fn) => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) { next(err); }
};

module.exports = {
  priorityUpdateSchema: service.priorityUpdateSchema,
  goalSchema: service.goalSchema,
  reviewSchema: service.reviewSchema,
  get: handler((req) => service.getPlan(req.actor.participantId, planId(req))),
  priorities: handler((req) => service.updatePriority(req.actor.participantId, planId(req), req.body)),
  goals: handler((req) => service.saveGoal(req.actor.participantId, planId(req), req.body)),
  reviews: handler((req) => service.addReview(req.actor.participantId, planId(req), req.body)),
};
