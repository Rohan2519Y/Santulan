/*
 * The question set is chosen by the SERVER: the single OPEN set of the participant's age group (spec FR-019/FR-020, api-delta
 * section 2). The age group comes from the age stored at registration; the client never supplies a version, an age or a track.
 * At most one set can be open per age group (uq_one_open_set_per_age_group), so the choice is unambiguous.
 */
const { controlPlane } = { controlPlane: require('../domain/controlPlane') };

/** @returns the OPEN + FROZEN question-set document for the participant's track, or throws ASSESSMENT_NOT_OPEN. */
async function selectSet(tx, participant) {
  const set = await tx.c.assessment_versions.findOne({ configuration: participant.assessmentTrack, participation_state: 'OPEN', status: 'FROZEN' });
  if (!set) throw controlPlane.notOpen();
  return set;
}

module.exports = { selectSet };
