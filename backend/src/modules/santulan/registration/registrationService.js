/*
 * Participant registration (BUILD 03 §12 transaction sequence). Registration creates an identity and routes it; it NEVER
 * creates an assessment attempt or a consent record and never implies consent or eligibility to start.
 */
const { HttpError } = require('../../../shared/errors');
const { withSystemTx } = require('../context/canonicalTx');
const { writeAudit } = require('../audit/auditService');
const { payloadHash, keyToken, lockKey, findOutcome } = require('../shared/idempotency');
const { resolveAgeRoute } = require('./routing');
const { generateSantulanId } = require('./santulanId');

const ACTION_CREATED = 'REGISTRATION_CREATED';

const toResponse = (p, route) => ({
  santulanId: p.santulanId,
  participationRoute: p.participationRoute,
  assessmentTrack: p.assessmentTrack,
  isMinor: p.isMinor,
  requiredConsents: route.requiredConsents,
});

/** Best-effort audit of a refused registration in its own transaction (the failed one was rolled back). */
async function auditRejected(reason, route, correlationId) {
  try {
    await withSystemTx((tx) => writeAudit(tx, {
      actorType: 'SYSTEM', actionType: 'REGISTRATION_REJECTED', targetEntity: 'participants',
      newState: { reason, route }, correlationId,
    }));
  } catch (e) { /* the refusal itself is what the caller reports */ }
}

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

  try {
    return await withSystemTx(async (tx) => {
      await lockKey(tx, 'registration', idempotencyKey);
      const prior = await findOutcome(tx, ACTION_CREATED, idempotencyKey);
      if (prior) {
        if (prior.newState.payload_hash !== hash) {
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'The Idempotency-Key was already used with a different request');
        }
        const { rows } = await tx.query('SELECT * FROM santulan.participants WHERE participant_id = $1', [prior.targetId]);
        return { replay: true, participantId: rows[0].participantId, body: toResponse(rows[0], routing), participant: rows[0] };
      }

      await tx.raw('SELECT santulan.build03_assert_catalog_route($1::smallint)', [age]); // SN012 => 503 CATALOG_DRIFT

      if (route === 'INSTITUTIONAL') {
        const { rows } = await tx.query(
          `SELECT 1 FROM santulan.institutions i JOIN santulan.cohorts c ON c.institution_id = i.institution_id
            WHERE i.institution_id = $1 AND c.cohort_id = $2 AND i.status = 'ACTIVE' AND c.status = 'ACTIVE'`,
          [institutionId, cohortId],
        );
        if (!rows.length) throw new HttpError(422, 'SCOPE_INVALID', 'The institution or cohort is not available');
      }

      let participant = null;
      for (let attempt = 0; attempt < 5 && !participant; attempt += 1) {
        await tx.raw('SAVEPOINT reg_insert');
        try {
          const { rows } = await tx.query(
            `INSERT INTO santulan.participants (santulan_id, participation_route, institution_id, cohort_id, external_student_id,
                                                age_years_at_registration, administration_language, auth_provider, auth_provider_subject_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [generateSantulanId(), route, institutionId, cohortId, externalStudentId, age, language, authProvider, authProviderSubjectId],
          );
          participant = rows[0];
          await tx.raw('RELEASE SAVEPOINT reg_insert');
        } catch (err) {
          await tx.raw('ROLLBACK TO SAVEPOINT reg_insert');
          if (!(err.code === '23505' && /santulan_id/.test(err.constraint || ''))) throw err; // only an ID collision retries
        }
      }
      if (!participant) throw new Error('could not allocate a unique Santulan ID');

      await writeAudit(tx, {
        actorType: 'SYSTEM', actionType: ACTION_CREATED, targetEntity: 'participants', targetId: participant.participantId,
        newState: { payload_hash: hash, route, track: participant.assessmentTrack, request_correlation_id: requestCorrelationId },
        correlationId: keyToken(idempotencyKey),
      });
      return { replay: false, participantId: participant.participantId, body: toResponse(participant, routing), participant };
    });
  } catch (err) {
    if (err.code === 'CATALOG_DRIFT') {
      await auditRejected('ROUTING_DRIFT_BLOCKED', route, requestCorrelationId);
    } else if (err.code === 'SCOPE_INVALID') {
      await auditRejected('SCOPE_INVALID', route, requestCorrelationId);
    }
    throw err;
  }
}

/** Minimal registration state for the authenticated participant (never returns the auth subject or external id). */
async function getRegistrationState(participantId) {
  const { withCanonicalTx } = require('../context/canonicalTx');
  return withCanonicalTx({ actorScope: 'PARTICIPANT', participantId }, async (tx) => {
    const { rows } = await tx.query('SELECT * FROM santulan.participants WHERE participant_id = $1', [participantId]);
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Participant not found');
    // the participant's most recent attempt (id + status only), so the dashboard can pick up where they are
    const attempt = (await tx.query('SELECT attempt_id, status FROM santulan.assessment_attempts WHERE participant_id = $1 ORDER BY created_at DESC LIMIT 1', [participantId])).rows[0];
    return { ...toResponse(rows[0], resolveAgeRoute(rows[0].ageYearsAtRegistration)), attempt: attempt ? { attemptId: attempt.attemptId, status: attempt.status } : null };
  });
}

module.exports = { register, getRegistrationState };
