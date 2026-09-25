/*
 * Participation control plane (research R-18). The operational STOP/OPEN switch is event-sourced in audit_logs: the LATEST
 * PARTICIPATION_CONTROL event decides (no event = OPEN; anything unrecognised fails closed = STOPPED). A question set is open for
 * delivery only when the set itself is FROZEN + OPEN *and* the control plane is OPEN.
 */
const { HttpError } = require('../../errors');
const audit = require('../../models/repositories/audit');

const notOpen = () => new HttpError(409, 'ASSESSMENT_NOT_OPEN', 'The assessment is not open for participation right now');

/** 'OPEN' or 'STOPPED'. `tx` is a store context (privileged scope: audit rows are readable only by SYSTEM / SUPER_ADMIN). */
async function getState(tx) {
  const latest = await audit.latestEvent(tx, 'PARTICIPATION_CONTROL');
  if (!latest) return 'OPEN';
  return latest.new_state && latest.new_state.state === 'OPEN' ? 'OPEN' : 'STOPPED';
}

/** @param set  a question-set document ({ status, participation_state }) */
async function assertOpen(tx, set) {
  if (!set || set.status !== 'FROZEN' || set.participation_state !== 'OPEN') throw notOpen();
  if ((await getState(tx)) !== 'OPEN') throw notOpen();
}

module.exports = { getState, assertOpen, notOpen };
