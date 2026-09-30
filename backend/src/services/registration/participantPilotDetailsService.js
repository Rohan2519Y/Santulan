/*
 * "Santulan Pilot Study Details" PART A submission - an explicit override of the approved profile form's own
 * "exclude full name/DOB/religion" list (see participantPilotDetailsRules.js). One transaction: load the participant
 * -> validate -> insert -> audit. A participant can edit these details any number of times; since the collection is
 * Tier A (insert-only), an edit is a new row, never an in-place update - identity.findPilotDetails reads back the
 * latest by created_at. Participant-token gated, same store pattern as the delivery services (participantTx).
 */
const { v4: uuidv4 } = require('uuid');
const { HttpError } = require('../../errors');
const identity = require('../../models/repositories/identity');
const rules = require('../domain/participantPilotDetailsRules');
const { writeAudit } = require('../audit/auditService');
const { participantTx } = require('../delivery/attemptService');

async function submitPilotDetails(participantId, body, correlationId = null) {
  return participantTx(participantId, async (tx) => {
    const participant = await identity.getParticipant(tx, participantId);
    if (!participant) throw new HttpError(404, 'NOT_FOUND', 'Participant not found');

    const existing = await identity.findPilotDetails(tx, participantId);
    const doc = rules.buildPilotDetails({ _id: uuidv4(), participantId, body });
    const details = await identity.insertPilotDetails(tx, doc);
    await writeAudit(tx, {
      actorType: 'PARTICIPANT', actorId: participantId, actionType: existing ? 'PARTICIPANT_PILOT_DETAILS_EDITED' : 'PARTICIPANT_PILOT_DETAILS_SUBMITTED', targetEntity: 'participant_pilot_details', targetId: details.detailsId,
      newState: { captureVersion: details.captureVersion }, correlationId,
    });
    return details;
  }, { write: true });
}

async function getOwnPilotDetails(participantId) {
  return participantTx(participantId, (tx) => identity.findPilotDetails(tx, participantId));
}

module.exports = { submitPilotDetails, getOwnPilotDetails };
