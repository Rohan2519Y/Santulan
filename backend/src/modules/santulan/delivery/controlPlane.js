/*
 * Participation control plane (research R-18). The operational STOP/OPEN switch is event-sourced in audit_logs and read
 * through santulan.participation_control_state() (no event = OPEN; anything unrecognised fails closed = STOPPED).
 * A version is open for delivery only when the version itself is FROZEN + OPEN *and* the control plane is OPEN.
 */
const { HttpError } = require('../../../shared/errors');

const notOpen = () => new HttpError(409, 'ASSESSMENT_NOT_OPEN', 'The assessment is not open for participation right now');

async function getState(tx) {
  return (await tx.query('SELECT santulan.participation_control_state() AS state')).rows[0].state;
}

/** @param version  { status, participationState } of the assessment version the attempt uses */
async function assertOpen(tx, version) {
  if (!version || version.status !== 'FROZEN' || version.participationState !== 'OPEN') throw notOpen();
  if ((await getState(tx)) !== 'OPEN') throw notOpen();
}

module.exports = { getState, assertOpen };
