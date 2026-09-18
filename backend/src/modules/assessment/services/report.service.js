const { randomUUID } = require('crypto');
const db = require('../../../shared/db');
const { HttpError } = require('../../../shared/errors');
const { resolveInterpretation } = require('../engine/interpretation.engine');
const { buildStemTemplate } = require('../engine/interpretationStems');

const NEUTRAL_HOLD_MESSAGE =
  'Your results are being reviewed before your report can be shown. This does not reflect anything wrong with your answers.';
const LOW_SCORE_PRIORITY_THRESHOLD = 3;

const REPORT_SECTION_COLUMNS = ['id', 'report_id', 'section_type', 'domain_code', 'content_version', 'display_order', 'content_snapshot', 'is_released_to_participant'];

async function insertReportSections(tx, sections) {
  if (sections.length === 0) return;

  const values = [];
  const placeholders = sections.map((section, rowIndex) => {
    const rowValues = [
      randomUUID(),
      section.reportId,
      section.sectionType,
      section.domainCode,
      section.contentVersion,
      section.displayOrder,
      JSON.stringify(section.contentSnapshot),
      section.isReleasedToParticipant,
    ];
    values.push(...rowValues);
    const base = rowIndex * REPORT_SECTION_COLUMNS.length;
    return `(${REPORT_SECTION_COLUMNS.map((_, colIndex) => `$${base + colIndex + 1}`).join(', ')})`;
  });

  await tx.query(`INSERT INTO report_sections (${REPORT_SECTION_COLUMNS.join(', ')}) VALUES ${placeholders.join(', ')}`, values);
}

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

  return insertReportSections(tx, sections);
}

/** FR-014/quickstart Scenario 4: the single neutral message, never the trigger. */
async function assembleNeutralHoldSection(tx, report) {
  return insertReportSections(tx, [
    {
      reportId: report.id,
      sectionType: 'T11_HOLD_NEUTRAL',
      domainCode: null,
      contentVersion: 'stem-v1.0',
      displayOrder: 0,
      contentSnapshot: { title: 'Report under review', body: NEUTRAL_HOLD_MESSAGE },
      isReleasedToParticipant: true,
    },
  ]);
}

/**
 * BF-05: permitted only from FAILED_RETRYABLE; regenerates identical content
 * from the frozen attempt + versions (SC-003 reproducibility) and logs the
 * actor + reason.
 */
async function retryReportGeneration(report, actorId, reason) {
  if (report.generationStatus !== 'FAILED_RETRYABLE') {
    throw new HttpError(409, 'REPORT_RETRY_NOT_ALLOWED', 'Report is not in a retryable state');
  }

  return db.withTransaction(async (tx) => {
    const { rows: attemptRows } = await tx.query('SELECT * FROM assessment_attempts WHERE id = $1', [report.attemptId]);
    const attempt = attemptRows[0];
    const { rows: profileRows } = await tx.query('SELECT * FROM participant_profiles WHERE id = $1', [report.participantProfileId]);
    const participantProfile = profileRows[0];
    const { rows: scoreResults } = await tx.query('SELECT * FROM score_results WHERE attempt_id = $1', [attempt.id]);
    const { rows: items } = await tx.query('SELECT DISTINCT domain_code, domain_name FROM items WHERE assessment_version_id = $1', [
      attempt.assessmentVersionId,
    ]);
    const domainNamesByCode = Object.fromEntries(items.map((i) => [i.domainCode, i.domainName]));

    await tx.query('DELETE FROM report_sections WHERE report_id = $1', [report.id]);
    await assembleReportSections(tx, { report, attempt, participantProfile, scoreResults, domainNamesByCode });

    const { rows: updatedRows } = await tx.query(
      `UPDATE reports SET generation_status = 'REPORT_READY', generated_at = $1, retry_count = retry_count + 1 WHERE id = $2 RETURNING *`,
      [new Date(), report.id]
    );
    await tx.query(`UPDATE assessment_attempts SET status = 'REPORT_READY' WHERE id = $1`, [attempt.id]);
    // eslint-disable-next-line no-console
    console.log(`[report.retry] report=${report.id} actor=${actorId} reason=${reason || '(none)'}`);

    return updatedRows[0];
  });
}

module.exports = { assembleReportSections, assembleNeutralHoldSection, retryReportGeneration };
