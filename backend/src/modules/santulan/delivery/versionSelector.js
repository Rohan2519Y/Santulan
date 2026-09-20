/*
 * The assessment version is chosen by the SERVER from the participant's stored track (derived from the age stored at
 * registration). The client never supplies a version, an age or a track (contracts/api.md §4).
 */
const { HttpError } = require('../../../shared/errors');

async function selectVersion(tx, participant) {
  const { rows } = await tx.query(
    `SELECT assessment_version_id, version_label, status, participation_state, participant_min_age, participant_max_age
       FROM santulan.assessment_versions WHERE configuration = $1`, [participant.assessmentTrack],
  );
  if (rows.length !== 1) throw new HttpError(503, 'CATALOG_DRIFT', 'The assessment catalog is not in its expected state');
  return rows[0];
}

module.exports = { selectVersion };
