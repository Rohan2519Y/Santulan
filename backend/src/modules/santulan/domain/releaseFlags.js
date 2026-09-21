/*
 * Release switches (scoring master section 15; contracts/scoring-and-report.md section 10). Four switches, all OFF until a
 * Super Admin changes them. Each change is an audited RELEASE_FLAG_CHANGED event; the LATEST event per switch decides; no event
 * means OFF; an unrecognised value fails closed (OFF). The change and its audit row are one transaction, so a switch never
 * changes without its audit record. No frontend toggle exists.
 */
const { HttpError } = require('../../../shared/errors');
const { writeAudit } = require('../store/repositories/audit');

const FLAGS = ['pilotS2', 'advancedEvidence', 'developmentRelease', 'pathwayRelease'];
const ACTION = 'RELEASE_FLAG_CHANGED';
const entityOf = (flag) => `release_flag:${flag}`;

const isFlag = (flag) => FLAGS.includes(flag);

/** The latest recorded state of one switch: { value, changedAt, changedBy, reason } (value false when never changed). */
async function getFlag(tx, flag) {
  const [latest] = await tx.c.audit_logs.find({ action_type: ACTION, target_entity: entityOf(flag), target_id: null }, { sort: { occurred_at: -1, _id: -1 }, limit: 1 });
  if (!latest) return { value: false, changedAt: null, changedBy: null, reason: null };
  const value = !!latest.new_state && latest.new_state.flag === flag && latest.new_state.value === true; // anything unrecognised => OFF
  return { value, changedAt: latest.occurred_at, changedBy: latest.actor_id, reason: latest.reason };
}

/** All four switches. `tx` must carry a privileged scope (audit rows are not readable by participants). */
async function getFlags(tx) {
  const out = {};
  for (const f of FLAGS) out[f] = await getFlag(tx, f);
  return out;
}

/** Just the booleans, for the scoring / report code paths. */
async function getSwitches(tx) {
  const all = await getFlags(tx);
  return Object.fromEntries(FLAGS.map((f) => [f, all[f].value]));
}

/** Sets one switch inside the caller's transaction, with its audit row. A reason of 3-300 characters is required. */
async function setFlag(tx, flag, value, reason, { adminUserId, correlationId = null } = {}) {
  if (!isFlag(flag)) throw new HttpError(404, 'NOT_FOUND', 'Unknown release switch');
  if (typeof value !== 'boolean') throw new HttpError(400, 'VALIDATION_ERROR', 'value must be true or false');
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < 3 || text.length > 300) throw new HttpError(400, 'VALIDATION_ERROR', 'A reason of 3 to 300 characters is required');
  const before = await getFlag(tx, flag);
  await writeAudit(tx, {
    actorType: 'ADMIN', actorId: adminUserId, actionType: ACTION, targetEntity: entityOf(flag), targetId: null,
    previousState: { flag, value: before.value }, newState: { flag, value }, reason: text, correlationId,
  });
  return getFlag(tx, flag);
}

module.exports = { FLAGS, isFlag, getFlag, getFlags, getSwitches, setFlag };
