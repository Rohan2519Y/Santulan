/*
 * Validation-profile submission (Student Demographic & Research Profile Capture Form v1.0). One transaction: load the
 * participant (for their participation route) -> refuse a second submission -> cross-field checks -> insert -> audit.
 * Participant-token gated, same store pattern as the delivery services (participantTx).
 */
const { v4: uuidv4 } = require('uuid');
const { HttpError } = require('../../errors');
const identity = require('../../models/repositories/identity');
const rules = require('../domain/participantProfileRules');
const { writeAudit } = require('../audit/auditService');
const { participantTx } = require('../delivery/attemptService');

async function submitProfile(participantId, body, correlationId = null) {
  return participantTx(participantId, async (tx) => {
    const participant = await identity.getParticipant(tx, participantId);
    if (!participant) throw new HttpError(404, 'NOT_FOUND', 'Participant not found');

    rules.assertNotAlreadySubmitted(await identity.findProfile(tx, participantId));
    rules.assertClassYearForStage(body.educationStage ?? null, body.currentClassYear ?? null);
    rules.assertRegionFieldsAllowed(participant.participationRoute, body);

    const doc = rules.buildProfile({ _id: uuidv4(), participantId, body });
    const profile = await identity.insertProfile(tx, doc);
    await writeAudit(tx, {
      actorType: 'PARTICIPANT', actorId: participantId, actionType: 'PARTICIPANT_PROFILE_SUBMITTED', targetEntity: 'participant_profiles', targetId: profile.profileId,
      newState: { profileVersion: profile.profileVersion }, correlationId,
    });
    return profile;
  }, { write: true });
}

async function getOwnProfile(participantId) {
  return participantTx(participantId, (tx) => identity.findProfile(tx, participantId));
}

module.exports = { submitProfile, getOwnProfile };
