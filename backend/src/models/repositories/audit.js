/*
 * audit_logs repository (Tier A: insert only). writeAudit(tx, ...) inserts inside the CALLER'S transaction: a privileged
 * mutation succeeds only if its audit record persists, so any failure throws AUDIT_UNAVAILABLE and the whole transaction
 * aborts (constitution IV/V). Never put OTPs, tokens, contact details, names or credentials in the states or reason.
 */
const { v4: uuidv4 } = require('uuid');
const { HttpError } = require('../../errors');
const { isTransient } = require('../db/errors');

async function writeAudit(tx, {
  actorType, actorId = null, actionType, targetEntity, targetId = null, previousState = null, newState = null, reason = null, correlationId = null, id = null,
}) {
  try {
    await tx.c.audit_logs.insertOne({
      _id: id || uuidv4(),
      actor_type: actorType,
      actor_id: actorId,
      action_type: actionType,
      target_entity: targetEntity,
      target_id: targetId,
      previous_state: previousState,
      new_state: newState,
      reason,
      occurred_at: new Date(),
      correlation_id: correlationId,
    });
  } catch (err) {
    // Transient errors (the driver retries the transaction on their label) and the idempotency race (a duplicate deterministic
    // id) must reach the transaction layer untouched; every other failure fails closed as AUDIT_UNAVAILABLE.
    if (isTransient(err) || (err && err.code === 11000 && /index: _id_ /.test(err.message || ''))) throw err;
    throw new HttpError(503, 'AUDIT_UNAVAILABLE', 'The operation was not performed because it could not be audited');
  }
}

/** Latest audit event of `actionType` for a target (used by the control plane and release switches). */
async function latestEvent(tx, actionType, targetEntity, targetId = null) {
  const filter = { action_type: actionType };
  if (targetEntity) filter.target_entity = targetEntity;
  if (targetId !== null) filter.target_id = targetId;
  const rows = await tx.c.audit_logs.find(filter, { sort: { occurred_at: -1, _id: -1 }, limit: 1 });
  return rows[0] || null;
}

module.exports = { writeAudit, latestEvent };
