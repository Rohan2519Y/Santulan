const { randomUUID } = require('crypto');
const prisma = require('../../../shared/prisma');
const { HttpError } = require('../../../shared/errors');
const { assertConsentGate } = require('./consent.service');
const { getEligibleItemsGroupedByDomain } = require('./eligibility.service');
const { recordEvent } = require('./event.service');
const { assertParticipationOpen } = require('./participation.service');
const { setParticipantScope } = require('../../../shared/utils/rls');
const { SCORING_VERSION, MAX_SESSIONS, RESPONSE_SCALE, ACTIVE_ATTEMPT_STATUSES } = require('../constants');

async function getActiveAssessmentVersion() {
  const version = await prisma.assessmentVersion.findFirst({ where: { isActive: true } });
  if (!version) {
    throw new HttpError(409, 'ATTEMPT_UNAVAILABLE', 'No active frozen assessment version');
  }
  return version;
}

async function findActiveAttempt(participantProfileId, assessmentVersionId) {
  return prisma.assessmentAttempt.findFirst({
    where: { participantProfileId, assessmentVersionId, status: { in: ACTIVE_ATTEMPT_STATUSES } },
  });
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

  return prisma.$transaction(async (tx) => {
    const attempt = await tx.assessmentAttempt.create({
      data: {
        participantProfileId: participantProfile.id,
        assessmentVersionId: version.id,
        scoringVersion: SCORING_VERSION,
        status: 'IN_PROGRESS',
        sessionCount: 1,
        startedAt: new Date(),
        idempotencyKey: randomUUID(),
      },
    });
    await recordEvent(tx, { attemptId: attempt.id, eventType: 'SESSION_START', sessionNumber: 1 });
    return attempt;
  });
}

async function pauseAttempt(attempt) {
  if (!['IN_PROGRESS'].includes(attempt.status)) {
    throw new HttpError(422, 'INVALID_STATE', 'Attempt is not in an active session');
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.assessmentAttempt.update({ where: { id: attempt.id }, data: { status: 'PAUSED' } });
    await recordEvent(tx, { attemptId: attempt.id, eventType: 'PAUSE', sessionNumber: attempt.sessionCount });
    return updated;
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
  return prisma.$transaction(async (tx) => {
    const nextSession = attempt.sessionCount + 1;
    const updated = await tx.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { status: 'IN_PROGRESS', sessionCount: nextSession },
    });
    await recordEvent(tx, { attemptId: attempt.id, eventType: 'RESUME', sessionNumber: nextSession });
    return updated;
  });
}

async function findOwnedAttempt(attemptId, participantProfileId) {
  const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: attemptId } });
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
  const version = await prisma.assessmentVersion.findUnique({ where: { id: attempt.assessmentVersionId } });
  const sections = await getEligibleItemsGroupedByDomain(attempt.assessmentVersionId, participantProfile);
  const currentResponses = await prisma.$transaction(async (tx) => {
    await setParticipantScope(tx, participantProfile.id);
    return tx.response.findMany({ where: { attemptId: attempt.id, isCurrent: true } });
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
