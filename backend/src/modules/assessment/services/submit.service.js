const prisma = require('../../../shared/prisma');
const { HttpError } = require('../../../shared/errors');
const { scoreAttempt } = require('./scoring.service');
const { detectQualityFlags, recordQualityFlags } = require('./quality.service');
const { recordEvent } = require('./event.service');
const { assembleReportSections, assembleNeutralHoldSection } = require('./report.service');
const { setParticipantScope } = require('../../../shared/utils/rls');

const SUBMITTABLE_STATES = ['IN_PROGRESS', 'PAUSED'];

/**
 * FR-007/008/011: one interactive transaction - lock responses (-> SUBMITTED),
 * run quality detection + server-side scoring, create the Report record, and
 * land on REPORT_READY (or QUALITY_HOLD when a Q09 safeguarding flag already
 * exists on the attempt - FR-014, never scored). Deterministic and synchronous
 * (SC-001: results within 10s for ~59 eligible items/domain-set).
 */
async function submitAttempt(attempt, participantProfile) {
  if (!SUBMITTABLE_STATES.includes(attempt.status)) {
    throw new HttpError(422, 'INVALID_STATE', 'Attempt is not in a submittable state');
  }

  return prisma.$transaction(async (tx) => {
    await setParticipantScope(tx, participantProfile.id);

    await tx.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    await recordEvent(tx, { attemptId: attempt.id, eventType: 'SUBMIT', sessionNumber: attempt.sessionCount });

    const preexistingQ09 = await tx.qualityFlag.findFirst({ where: { attemptId: attempt.id, flagCode: 'Q09' } });
    if (preexistingQ09) {
      const held = await tx.assessmentAttempt.update({
        where: { id: attempt.id },
        data: { status: 'QUALITY_HOLD' },
      });
      const holdReport = await tx.report.create({
        data: {
          attemptId: attempt.id,
          participantProfileId: participantProfile.id,
          reportVersion: attempt.scoringVersion,
          generationStatus: 'REPORT_READY',
          generatedAt: new Date(),
        },
      });
      await assembleNeutralHoldSection(tx, holdReport);
      return { attempt: held, report: holdReport, scores: [], qualityFlags: [preexistingQ09] };
    }

    await tx.assessmentAttempt.update({ where: { id: attempt.id }, data: { status: 'SCORING' } });

    const scoreResults = await scoreAttempt(tx, attempt, participantProfile);

    const responses = await tx.response.findMany({ where: { attemptId: attempt.id, isCurrent: true } });
    const detectedFlags = detectQualityFlags({ responses, scoreResults });
    const qualityFlags = await recordQualityFlags(tx, attempt.id, detectedFlags);

    const scored = await tx.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { status: 'SCORED', completedAt: new Date() },
    });

    const report = await tx.report.create({
      data: {
        attemptId: attempt.id,
        participantProfileId: participantProfile.id,
        reportVersion: attempt.scoringVersion,
        generationStatus: 'REPORT_READY',
        generatedAt: new Date(),
      },
    });

    const items = await tx.item.findMany({
      where: { assessmentVersionId: attempt.assessmentVersionId },
      select: { domainCode: true, domainName: true },
      distinct: ['domainCode'],
    });
    const domainNamesByCode = Object.fromEntries(items.map((i) => [i.domainCode, i.domainName]));
    await assembleReportSections(tx, { report, attempt, participantProfile, scoreResults, domainNamesByCode });

    const reportReady = await tx.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { status: 'REPORT_READY' },
    });

    return { attempt: reportReady, report, scores: scoreResults, qualityFlags, _scoredSnapshot: scored };
  });
}

module.exports = { submitAttempt };
