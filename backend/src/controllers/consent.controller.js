/*
 * Consent endpoints (contracts/api.md §4). Participant identity always comes from the token; a participant can act only on
 * their own consent records. Creating a record and verifying it are privileged (consent service / verifier).
 */
const { z } = require('zod');
const { HttpError } = require('../errors');
const { strictObject } = require('../middleware/http');
const service = require('../services/consent/consentService');

const createSchema = strictObject({
  participantId: z.string().uuid(),
  consentType: z.enum(['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT', 'ADULT_SELF_CONSENT']),
  giverRelationship: z.enum(['SELF', 'PARENT', 'GUARDIAN', 'INSTITUTION_DELEGATED']),
  protocolVersion: z.string().min(1).max(64),
});
const verifySchema = strictObject({ verificationMethod: z.string().min(1).max(64) });
const emptySchema = strictObject({});
const idParam = z.string().uuid();

const wrap = (fn) => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) { next(err); }
};
const consentId = (req) => {
  const parsed = idParam.safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(404, 'NOT_FOUND', 'Consent not found');
  return parsed.data;
};

module.exports = {
  createSchema, verifySchema, emptySchema,
  requirements: wrap((req) => service.getRequirements(req.actor.participantId)),
  gate: wrap((req) => service.getGate(req.actor.participantId)),
  create: async (req, res, next) => {
    try { res.status(201).json(await service.create(req.body, req.actor, req.correlationId)); } catch (err) { next(err); }
  },
  grant: wrap((req) => service.grant(consentId(req), req.actor, req.correlationId)),
  verify: wrap((req) => service.verify(consentId(req), req.body.verificationMethod, req.actor, req.correlationId)),
  withdraw: wrap((req) => service.withdraw(consentId(req), req.actor, req.correlationId)),
  selfConsent: async (req, res, next) => {
    try { res.status(201).json(await service.selfConsent(req.actor.participantId, req.actor, req.correlationId)); } catch (err) { next(err); }
  },
  minorSelfService: async (req, res, next) => {
    try { res.status(201).json(await service.minorSelfService(req.actor.participantId, req.actor, req.correlationId)); } catch (err) { next(err); }
  },
};
