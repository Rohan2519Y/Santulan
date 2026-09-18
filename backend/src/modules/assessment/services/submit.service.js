const { randomUUID } = require('crypto');
const db = require('../../../shared/db');
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

  return db.withTransaction(async (tx) => {
    await setParticipantScope(tx, participantProfile.id);

    await tx.query(`UPDATE assessment_attempts SET status = 'SUBMITTED', submitted_at = $1 WHERE id = $2`, [new Date(), attempt.id]);
    await recordEvent(tx, { attemptId: attempt.id, eventType: 'SUBMIT', sessionNumber: attempt.sessionCount });

    const { rows: q09Rows } = await tx.query("SELECT * FROM quality_flags WHERE attempt_id = $1 AND flag_code = 'Q09'", [attempt.id]);
    const preexistingQ09 = q09Rows[0];
    if (preexistingQ09) {
      const { rows: heldRows } = await tx.query(
        `UPDATE assessment_attempts SET status = 'QUALITY_HOLD' WHERE id = $1 RETURNING *`,
        [attempt.id]
      );
      const held = heldRows[0];
      const { rows: reportRows } = await tx.query(
        `INSERT INTO reports (id, attempt_id, participant_profile_id, report_version, generation_status, generated_at)
         VALUES ($1, $2, $3, $4, 'REPORT_READY', $5)
         RETURNING *`,
        [randomUUID(), attempt.id, participantProfile.id, attempt.scoringVersion, new Date()]
      );
      const holdReport = reportRows[0];
      await assembleNeutralHoldSection(tx, holdReport);
      return { attempt: held, report: holdReport, scores: [], qualityFlags: [preexistingQ09] };
    }

    await tx.query(`UPDATE assessment_attempts SET status = 'SCORING' WHERE id = $1`, [attempt.id]);

    const scoreResults = await scoreAttempt(tx, attempt, participantProfile);

    const { rows: responses } = await tx.query('SELECT * FROM responses WHERE attempt_id = $1 AND is_current = true', [attempt.id]);
    const detectedFlags = detectQualityFlags({ responses, scoreResults });
    const qualityFlags = await recordQualityFlags(tx, attempt.id, detectedFlags);

    await tx.query(`UPDATE assessment_attempts SET status = 'SCORED', completed_at = $1 WHERE id = $2`, [new Date(), attempt.id]);

    const { rows: reportRows } = await tx.query(
      `INSERT INTO reports (id, attempt_id, participant_profile_id, report_version, generation_status, generated_at)
       VALUES ($1, $2, $3, $4, 'REPORT_READY', $5)
       RETURNING *`,
      [randomUUID(), attempt.id, participantProfile.id, attempt.scoringVersion, new Date()]
    );
    const report = reportRows[0];

    const { rows: items } = await tx.query(
      'SELECT DISTINCT domain_code, domain_name FROM items WHERE assessment_version_id = $1',
      [attempt.assessmentVersionId]
    );
    const domainNamesByCode = Object.fromEntries(items.map((i) => [i.domainCode, i.domainName]));
    await assembleReportSections(tx, { report, attempt, participantProfile, scoreResults, domainNamesByCode });

    const { rows: reportReadyRows } = await tx.query(
      `UPDATE assessment_attempts SET status = 'REPORT_READY' WHERE id = $1 RETURNING *`,
      [attempt.id]
    );

    return { attempt: reportReadyRows[0], report, scores: scoreResults, qualityFlags };
  });
}

module.exports = { submitAttempt };
