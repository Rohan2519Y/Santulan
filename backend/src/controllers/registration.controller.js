const crypto = require('crypto');
const { z } = require('zod');
const config = require('../config');
const { HttpError } = require('../errors');
const { getProvider } = require('../services/identity');
const { strictObject } = require('../middleware/http');
const { register, getRegistrationState } = require('../services/registration/registrationService');
const { submitProfile, getOwnProfile } = require('../services/registration/participantProfileService');
const { submitPilotDetails, getOwnPilotDetails } = require('../services/registration/participantPilotDetailsService');
const { resolveAgeRoute } = require('../services/registration/routing');
const { verifyPurposeToken, signToken } = require('../middleware/auth');
const E = require('../models/schema/enums');

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

// Student Demographic & Research Profile Capture Form v1.0 ("full recommended set") - every question on the live form
// is individually optional, so every field here is `.optional()`; the *_detail companions are free text (the form has
// no fixed language/region code list to validate against - see enums.js).
const detail = z.string().trim().min(1).max(120);
const profileSchema = strictObject({
  educationStage: z.enum(E.EDUCATION_STAGE).optional(),
  currentClassYear: z.enum(E.CURRENT_CLASS_YEAR).optional(),
  primaryLanguageMode: z.enum(E.LANGUAGE_MODE).optional(),
  primaryLanguageDetail: detail.optional(),
  mediumOfInstruction: z.enum(E.MEDIUM_OF_INSTRUCTION).optional(),
  mediumOfInstructionDetail: detail.optional(),
  genderResearch: z.enum(E.GENDER_RESEARCH).optional(),
  genderSelfDescription: detail.optional(),
  broadRegionMode: z.enum(E.REGION_MODE).optional(),
  broadRegionDetail: detail.optional(),
  urbanicity: z.enum(E.URBANICITY).optional(),
  accessibilityAccommodation: z.enum(E.ACCESSIBILITY_ACCOMMODATION).optional(),
  accessibilityAccommodationDetail: detail.optional(),
});

// "Santulan Pilot Study Details" PART A - an explicit override of the approved profile form's own exclusion list
// (full_name/date_of_birth/religion etc.) - see participantPilotDetailsRules.js. fullName is the one required field;
// class/gender are free text (neither source PDF gives them a fixed option list, unlike education_stage/gender_research above).
const freeText = z.string().trim().min(1).max(120);
const pilotDetailsSchema = strictObject({
  fullName: z.string().trim().min(1).max(200),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  className: freeText.optional(),
  gender: freeText.optional(),
  birthOrder: z.enum(E.BIRTH_ORDER).optional(),
  siblingCount: z.number().int().min(0).max(50).optional(),
  religion: z.enum(E.RELIGION).optional(),
  familyType: z.enum(E.FAMILY_TYPE).optional(),
  residenceType: z.enum(E.RESIDENCE_TYPE).optional(),
  state: freeText.optional(),
  schoolType: z.enum(E.SCHOOL_TYPE).optional(),
  studyMedium: z.enum(E.STUDY_MEDIUM).optional(),
  board: z.enum(E.BOARD).optional(),
  academicStream: z.enum(E.ACADEMIC_STREAM).optional(),
});

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

/** Authenticated participant session; the actor comes from the verified token, never the body. */
async function submitProfileHandler(req, res, next) {
  try {
    res.status(201).json(await submitProfile(req.actor.participantId, req.body, req.correlationId));
  } catch (err) { next(err); }
}

async function profile(req, res, next) {
  try {
    const p = await getOwnProfile(req.actor.participantId);
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'No validation profile has been submitted yet');
    res.json(p);
  } catch (err) { next(err); }
}

/** Authenticated participant session; the actor comes from the verified token, never the body. */
async function submitPilotDetailsHandler(req, res, next) {
  try {
    res.status(201).json(await submitPilotDetails(req.actor.participantId, req.body, req.correlationId));
  } catch (err) { next(err); }
}

async function pilotDetails(req, res, next) {
  try {
    const d = await getOwnPilotDetails(req.actor.participantId);
    if (!d) throw new HttpError(404, 'NOT_FOUND', 'No pilot study details have been submitted yet');
    res.json(d);
  } catch (err) { next(err); }
}

module.exports = {
  routeSchema, openSchema, institutionalSchema, ageDeclarationSchema, profileSchema, pilotDetailsSchema,
  resolveRoute, registerOpen, registerInstitutional, ageDeclaration, state,
  submitProfile: submitProfileHandler, profile,
  submitPilotDetails: submitPilotDetailsHandler, pilotDetails,
};
