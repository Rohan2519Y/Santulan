/*
 * Participant registration (BUILD 03 section 12 transaction sequence), on the store. Registration creates an identity and
 * routes it; it NEVER creates an assessment attempt or a consent record and never implies consent or eligibility to start.
 * One transaction: validate -> resolve the idempotency key -> scope -> insert -> audit (which also records the outcome under a
 * deterministic id, so two simultaneous requests with one key cannot both commit).
 */
const { v4: uuidv4 } = require('uuid');
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const identity = require('../../models/repositories/identity');
const { writeAudit } = require('../audit/auditService');
const { payloadHash, keyToken, outcomeId, findOutcome, isRace } = require('../../utils/idempotency');
const { resolveAgeRoute } = require('./routing');
const rules = require('../domain/registrationRules');

const ACTION_CREATED = 'REGISTRATION_CREATED';
const MAX_ATTEMPTS = 6;

const toResponse = (p, route) => ({
  santulanId: p.santulanId,
  participationRoute: p.participationRoute,
  assessmentTrack: p.assessmentTrack,
  isMinor: p.isMinor,
  requiredConsents: route.requiredConsents,
});

const sys = () => store.systemScope();

/** Best-effort audit of a refused registration in its own transaction (the failed one was rolled back). */
async function auditRejected(reason, route, correlationId) {
  try {
    await store.withScope(sys(), (tx) => writeAudit(tx, {
      actorType: 'SYSTEM', actionType: 'REGISTRATION_REJECTED', targetEntity: 'participants',
      newState: { reason, route }, correlationId,
    }), { transaction: true });
  } catch (e) { /* the refusal itself is what the caller reports */ }
}

const isSantulanIdCollision = (err) => err && err.code === 'DUPLICATE_IDENTITY' && err.cause && /santulan_id/.test(err.cause.message || '');

/**
 * @param {object} input  route ('OPEN'|'INSTITUTIONAL'), age, language, institutionId, cohortId, externalStudentId,
 *                        authProvider, authProviderSubjectId, idempotencyKey, requestCorrelationId
 */
async function register(input) {
  const {
    route, age, language = 'en', institutionId = null, cohortId = null, externalStudentId = null,
    authProvider = null, authProviderSubjectId = null, idempotencyKey, requestCorrelationId = null,
  } = input;
  const routing = resolveAgeRoute(age);
  if (!routing.eligible) {
    await auditRejected('AGE_INELIGIBLE', route, requestCorrelationId);
    throw new HttpError(422, 'AGE_INELIGIBLE', 'Santulan is available for ages 13 to 25');
  }
  const hash = payloadHash({ route, age, language, institutionId, cohortId, externalStudentId, authProvider, authProviderSubjectId });

  const once = () => store.withScope(sys(), async (tx) => {
    const prior = await findOutcome(tx, ACTION_CREATED, idempotencyKey);
    if (prior) {
      if (prior.newState.payload_hash !== hash) {
        throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'The Idempotency-Key was already used with a different request');
      }
      const existing = await identity.getParticipant(tx, prior.targetId);
      return { replay: true, participantId: existing.participantId, body: toResponse(existing, routing), participant: existing };
    }

    await rules.assertScope(tx, { route, institutionId, cohortId, externalStudentId });

    const doc = rules.buildParticipant({ _id: uuidv4(), route, age, language, institutionId, cohortId, externalStudentId, authProvider, authProviderSubjectId });
    const participant = await identity.insertParticipant(tx, doc);

    await writeAudit(tx, {
      id: outcomeId(ACTION_CREATED, idempotencyKey),
      actorType: 'SYSTEM', actionType: ACTION_CREATED, targetEntity: 'participants', targetId: participant.participantId,
      newState: { payload_hash: hash, route, track: participant.assessmentTrack, request_correlation_id: requestCorrelationId },
      correlationId: keyToken(idempotencyKey),
    });
    return { replay: false, participantId: participant.participantId, body: toResponse(participant, routing), participant };
  }, { transaction: true });

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await once();
      } catch (err) {
        // A Santulan ID collision (improbable) or a lost idempotency race: run the whole transaction again.
        if ((isSantulanIdCollision(err) || isRace(err)) && attempt < MAX_ATTEMPTS) continue;
        throw err;
      }
    }
    throw new Error('registration did not converge');
  } catch (err) {
    if (err.code === 'SCOPE_INVALID') await auditRejected('SCOPE_INVALID', route, requestCorrelationId);
    throw err;
  }
}

/** Minimal registration state for the authenticated participant (never returns the auth subject or external id). */
async function getRegistrationState(participantId) {
  return store.withScope(store.participantScope(participantId), async (tx) => {
    const p = await identity.getParticipant(tx, participantId);
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'Participant not found');
    // the participant's most recent attempt (id + status only), so the dashboard can pick up where they are
    const [attempt] = await tx.c.assessment_attempts.find({ participant_id: participantId }, { sort: { created_at: -1 }, limit: 1 });
    // ASSUMED addition (Student Demographic & Research Profile Capture Form v1.0): lets the frontend show the
    // validation-profile step exactly once, right after registration - never re-asked once it exists.
    const profileCompleted = Boolean(await identity.findProfile(tx, participantId));
    return { ...toResponse(p, resolveAgeRoute(p.ageYearsAtRegistration)), attempt: attempt ? { attemptId: attempt._id, status: attempt.status } : null, profileCompleted };
  });
}

module.exports = { register, getRegistrationState };
