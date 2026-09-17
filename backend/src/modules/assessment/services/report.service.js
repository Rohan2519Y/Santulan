const { resolveInterpretation } = require('../engine/interpretation.engine');
const { buildStemTemplate } = require('../engine/interpretationStems');

const NEUTRAL_HOLD_MESSAGE =
  'Your results are being reviewed before your report can be shown. This does not reflect anything wrong with your answers.';
const LOW_SCORE_PRIORITY_THRESHOLD = 3;

/**
 * FR-017: one ReportSection per domain (T01_DOMAIN_RESULT, descriptive,
 * released) - content_snapshot is the exact text shown, frozen against the
 * interpretation rule's content_version. FR-018/MP17: a single prescriptive
 * placeholder (T05_PRIORITIES) is always stored with
 * is_released_to_participant=false, rendered only once an admin flips the
 * flag (not exercised by this pilot's participant-facing flow).
 */
async function assembleReportSections(tx, { report, attempt, participantProfile, scoreResults, domainNamesByCode }) {
  const sections = [];
  let displayOrder = 0;

  for (const score of scoreResults) {
    // eslint-disable-next-line no-await-in-loop
    const { isOperational, rule } = await resolveInterpretation(tx, {
      assessmentVersionId: attempt.assessmentVersionId,
      domainCode: score.domainCode,
      developmentalBand: participantProfile.ageBand,
      evidenceState: score.scoreStatus,
      locale: participantProfile.administrationLanguage || 'en',
    });

    const domainName = domainNamesByCode[score.domainCode] || score.domainCode;
    const body = isOperational && rule ? rule.approvedTextTemplate : buildStemTemplate(score.domainCode, domainName, score.scoreStatus);

    sections.push({
      reportId: report.id,
      sectionType: 'T01_DOMAIN_RESULT',
      domainCode: score.domainCode,
      contentVersion: rule ? rule.version : 'stem-v1.0',
      displayOrder: displayOrder++,
      contentSnapshot: {
        domainCode: score.domainCode,
        domainName,
        title: `Your ${domainName} result`,
        body,
        rawScore: isOperational ? Number(score.rawScore) : null,
        completenessRate: Number(score.completenessRate),
        scoreStatus: score.scoreStatus,
      },
      isReleasedToParticipant: true,
    });
  }

  const priorityDomains = scoreResults
    .filter((s) => s.scoreStatus !== 'SH' && Number(s.rawScore) < LOW_SCORE_PRIORITY_THRESHOLD)
    .map((s) => s.domainCode);

  sections.push({
    reportId: report.id,
    sectionType: 'T05_PRIORITIES',
    domainCode: null,
    contentVersion: 'stem-v1.0',
    displayOrder: displayOrder++,
    contentSnapshot: { priorityDomains },
    isReleasedToParticipant: false, // MP17: prescriptive layer, held until Gate 4/5
  });

  return tx.reportSection.createMany({ data: sections });
}

/** FR-014/quickstart Scenario 4: the single neutral message, never the trigger. */
async function assembleNeutralHoldSection(tx, report) {
  return tx.reportSection.create({
    data: {
      reportId: report.id,
      sectionType: 'T11_HOLD_NEUTRAL',
      domainCode: null,
      contentVersion: 'stem-v1.0',
      displayOrder: 0,
      contentSnapshot: { title: 'Report under review', body: NEUTRAL_HOLD_MESSAGE },
      isReleasedToParticipant: true,
    },
  });
}

const prisma = require('../../../shared/prisma');
const { HttpError } = require('../../../shared/errors');

/**
 * BF-05: permitted only from FAILED_RETRYABLE; regenerates identical content
 * from the frozen attempt + versions (SC-003 reproducibility) and logs the
 * actor + reason.
 */
async function retryReportGeneration(report, actorId, reason) {
  if (report.generationStatus !== 'FAILED_RETRYABLE') {
    throw new HttpError(409, 'REPORT_RETRY_NOT_ALLOWED', 'Report is not in a retryable state');
  }

  return prisma.$transaction(async (tx) => {
    const attempt = await tx.assessmentAttempt.findUnique({ where: { id: report.attemptId } });
    const participantProfile = await tx.participantProfile.findUnique({ where: { id: report.participantProfileId } });
    const scoreResults = await tx.scoreResult.findMany({ where: { attemptId: attempt.id } });
    const items = await tx.item.findMany({
      where: { assessmentVersionId: attempt.assessmentVersionId },
      select: { domainCode: true, domainName: true },
      distinct: ['domainCode'],
    });
    const domainNamesByCode = Object.fromEntries(items.map((i) => [i.domainCode, i.domainName]));

    await tx.reportSection.deleteMany({ where: { reportId: report.id } });
    await assembleReportSections(tx, { report, attempt, participantProfile, scoreResults, domainNamesByCode });

    const updated = await tx.report.update({
      where: { id: report.id },
      data: { generationStatus: 'REPORT_READY', generatedAt: new Date(), retryCount: { increment: 1 } },
    });
    await tx.assessmentAttempt.update({ where: { id: attempt.id }, data: { status: 'REPORT_READY' } });
    // eslint-disable-next-line no-console
    console.log(`[report.retry] report=${report.id} actor=${actorId} reason=${reason || '(none)'}`);

    return updated;
  });
}

module.exports = { assembleReportSections, assembleNeutralHoldSection, retryReportGeneration };
