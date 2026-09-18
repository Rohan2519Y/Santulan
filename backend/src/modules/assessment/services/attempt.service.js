const { randomUUID } = require('crypto');
const db = require('../../../shared/db');
const { HttpError } = require('../../../shared/errors');
const { assertConsentGate } = require('./consent.service');
const { getEligibleItemsGroupedByDomain } = require('./eligibility.service');
const { recordEvent } = require('./event.service');
const { assertParticipationOpen } = require('./participation.service');
const { setParticipantScope } = require('../../../shared/utils/rls');
const { SCORING_VERSION, MAX_SESSIONS, RESPONSE_SCALE, ACTIVE_ATTEMPT_STATUSES } = require('../constants');

async function getActiveAssessmentVersion() {
  const { rows } = await db.query('SELECT * FROM assessment_versions WHERE is_active = true LIMIT 1');
  if (!rows[0]) {
    throw new HttpError(409, 'ATTEMPT_UNAVAILABLE', 'No active frozen assessment version');
  }
  return rows[0];
}

async function findActiveAttempt(participantProfileId, assessmentVersionId) {
  const { rows } = await db.query(
    `SELECT * FROM assessment_attempts
     WHERE participant_profile_id = $1 AND assessment_version_id = $2 AND status = ANY($3::"AttemptStatus"[])
     LIMIT 1`,
    [participantProfileId, assessmentVersionId, ACTIVE_ATTEMPT_STATUSES]
  );
  return rows[0] || null;
}

/**
 * FR-001/002/003/006/012: create against the active FROZEN version (or return
 * the existing active attempt - at most one per participant/version, FR-006),
 * snapshotting assessment_version_id (never re-pointed, FR-008 note).
 */
async function createOrResumeAttempt(participantProfile) {
  const version = await getActiveAssessmentVersion();
  const existing = await findActiveAttempt(participantProfile.id, version.id);

  if (existing) {
    if (existing.status === 'PAUSED') {
      return resumeAttempt(existing);
    }
    return existing; // already live (CREATED/STARTED/IN_PROGRESS) - resume as-is, no new session
  }

  await assertParticipationOpen();
  await assertConsentGate(participantProfile);

  return db.withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO assessment_attempts
         (id, participant_profile_id, assessment_version_id, scoring_version, status, session_count, started_at, idempotency_key)
       VALUES ($1, $2, $3, $4, 'IN_PROGRESS', 1, $5, $6)
       RETURNING *`,
      [randomUUID(), participantProfile.id, version.id, SCORING_VERSION, new Date(), randomUUID()]
    );
    const attempt = rows[0];
    await recordEvent(tx, { attemptId: attempt.id, eventType: 'SESSION_START', sessionNumber: 1 });
    return attempt;
  });
}

async function pauseAttempt(attempt) {
  if (!['IN_PROGRESS'].includes(attempt.status)) {
    throw new HttpError(422, 'INVALID_STATE', 'Attempt is not in an active session');
  }
  return db.withTransaction(async (tx) => {
    const { rows } = await tx.query(`UPDATE assessment_attempts SET status = 'PAUSED' WHERE id = $1 RETURNING *`, [attempt.id]);
    await recordEvent(tx, { attemptId: attempt.id, eventType: 'PAUSE', sessionNumber: attempt.sessionCount });
    return rows[0];
  });
}

/**
 * FR-005: resume opens a new session boundary; the 5th session is rejected
 * with 409 SESSION_LIMIT (session_count guarded to <= 4).
 */
async function resumeAttempt(attempt) {
  if (attempt.status !== 'PAUSED') {
    throw new HttpError(422, 'INVALID_STATE', 'Attempt is not paused');
  }
  if (attempt.sessionCount >= MAX_SESSIONS) {
    throw new HttpError(409, 'SESSION_LIMIT', 'Maximum of 4 sessions reached for this attempt');
  }
  return db.withTransaction(async (tx) => {
    const nextSession = attempt.sessionCount + 1;
    const { rows } = await tx.query(
      `UPDATE assessment_attempts SET status = 'IN_PROGRESS', session_count = $1 WHERE id = $2 RETURNING *`,
      [nextSession, attempt.id]
    );
    await recordEvent(tx, { attemptId: attempt.id, eventType: 'RESUME', sessionNumber: nextSession });
    return rows[0];
  });
}

async function findOwnedAttempt(attemptId, participantProfileId) {
  const { rows } = await db.query('SELECT * FROM assessment_attempts WHERE id = $1', [attemptId]);
  const attempt = rows[0];
  if (!attempt || attempt.participantProfileId !== participantProfileId) {
    throw new HttpError(403, 'FORBIDDEN', 'Attempt does not belong to the caller');
  }
  return attempt;
}

/**
 * Full attempt view for the start/resume response: version, frozen scale,
 * eligible items grouped into domain sections, and saved current answers
 * (US2 acceptance scenario 1 - resume restores state 1:1).
 */
async function buildAttemptView(attempt, participantProfile) {
  const { rows: versionRows } = await db.query('SELECT * FROM assessment_versions WHERE id = $1', [attempt.assessmentVersionId]);
  const version = versionRows[0];
  const sections = await getEligibleItemsGroupedByDomain(attempt.assessmentVersionId, participantProfile);
  const currentResponses = await db.withTransaction(async (tx) => {
    await setParticipantScope(tx, participantProfile.id);
    const { rows } = await tx.query('SELECT * FROM responses WHERE attempt_id = $1 AND is_current = true', [attempt.id]);
    return rows;
  });

  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);

  return {
    id: attempt.id,
    status: attempt.status,
    sessionCount: attempt.sessionCount,
    version: { id: version.id, versionLabel: version.versionLabel },
    scale: RESPONSE_SCALE,
    progress: { completed: currentResponses.length, total: totalItems, sessionOfFour: `${attempt.sessionCount} of ${MAX_SESSIONS}` },
    sections: sections.map((s) => ({
      domainCode: s.domainCode,
      domainName: s.domainName,
      items: s.items.map((item) => ({ id: item.id, code: item.itemCode, order: item.displayOrder, text: item.itemText })),
    })),
    savedAnswers: currentResponses.map((r) => ({ itemId: r.itemId, value: r.responseValue, isCurrent: r.isCurrent })),
  };
}

module.exports = {
  getActiveAssessmentVersion,
  findActiveAttempt,
  createOrResumeAttempt,
  pauseAttempt,
  resumeAttempt,
  findOwnedAttempt,
  buildAttemptView,
};
