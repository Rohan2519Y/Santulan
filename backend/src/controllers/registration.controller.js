const crypto = require('crypto');
const { z } = require('zod');
const config = require('../config');
const { HttpError } = require('../errors');
const { getProvider } = require('../services/identity');
const { strictObject } = require('../middleware/http');
const { register, getRegistrationState } = require('../services/registration/registrationService');
const { resolveAgeRoute } = require('../services/registration/routing');
const { verifyPurposeToken, signToken } = require('../middleware/auth');

const age = z.number().int();
const language = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional();

// Strict: unknown keys (santulanId, participantId, scores, DB context, ...) are rejected, never ignored.
const routeSchema = strictObject({ age });
const openSchema = strictObject({ age, language });
const institutionalSchema = strictObject({
  age, language,
  institutionId: z.string().uuid(),
  cohortId: z.string().uuid(),
  externalStudentId: z.string().min(1).max(64).optional(),
});
const ageDeclarationSchema = strictObject({ age, language });

function idempotencyKey(req) {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 16 || key.length > 128) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'An Idempotency-Key header of 16 to 128 characters is required');
  }
  return key;
}

const send = (res, result, extra = {}) => res.status(result.replay ? 200 : 201).json({ ...result.body, ...extra });

async function resolveRoute(req, res, next) {
  try {
    const r = resolveAgeRoute(req.body.age);
    if (!r.eligible) throw new HttpError(422, 'AGE_INELIGIBLE', 'Santulan is available for ages 13 to 25');
    res.json({ eligible: true, assessmentTrack: r.assessmentTrack, isMinor: r.isMinor, requiredConsents: r.requiredConsents });
  } catch (err) { next(err); }
}

async function registerOpen(req, res, next) {
  try {
    const result = await register({ route: 'OPEN', age: req.body.age, language: req.body.language, idempotencyKey: idempotencyKey(req), requestCorrelationId: req.correlationId });
    send(res, result);
  } catch (err) { next(err); }
}

async function registerInstitutional(req, res, next) {
  try {
    const { age: a, language: l, institutionId, cohortId, externalStudentId } = req.body;
    const key = idempotencyKey(req);
    // Institutional participants sign in with Santulan ID + a one-time temporary password from the identity provider (AT-27).
    // The provider subject is derived from the idempotency key so a replay presents the identical payload.
    const provider = config.identityProvider === 'dev' ? getProvider() : null;
    const authProviderSubjectId = provider ? crypto.createHash('sha256').update(`institutional:${req.actor.adminUserId}:${key}`).digest('hex') : null;
    const result = await register({
      route: 'INSTITUTIONAL', age: a, language: l, institutionId, cohortId, externalStudentId,
      authProvider: provider ? provider.PROVIDER : null, authProviderSubjectId, idempotencyKey: key, requestCorrelationId: req.correlationId,
    });
    const extra = provider && !result.replay ? { temporaryPassword: await provider.issueTemporaryCredential(authProviderSubjectId) } : {};
    send(res, result, extra);
  } catch (err) { next(err); }
}

/** Authenticated OTP session (purpose token 'age-declaration'): the auth pair comes from the token, never from the body. */
async function ageDeclaration(req, res, next) {
  try {
    const [, token] = (req.headers.authorization || '').split(' ');
    const claims = verifyPurposeToken(token || '', 'age-declaration');
    const result = await register({
      route: 'OPEN', age: req.body.age, language: req.body.language, authProvider: claims.authProvider, authProviderSubjectId: claims.authProviderSubjectId,
      idempotencyKey: idempotencyKey(req), requestCorrelationId: req.correlationId,
    });
    const accessToken = signToken({ sub: result.participantId, role: 'participant', participantId: result.participantId });
    send(res, result, { accessToken });
  } catch (err) { next(err); }
}

async function state(req, res, next) {
  try {
    res.json(await getRegistrationState(req.actor.participantId));
  } catch (err) { next(err); }
}

module.exports = { routeSchema, openSchema, institutionalSchema, ageDeclarationSchema, resolveRoute, registerOpen, registerInstitutional, ageDeclaration, state };
