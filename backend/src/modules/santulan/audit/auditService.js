/*
 * Writes an audit_logs row inside the CALLER'S transaction (BUILD 08 §6): a privileged mutation succeeds only if its
 * audit record persists, so any failure here throws AUDIT_UNAVAILABLE and the whole transaction rolls back.
 * Never put OTPs, tokens, contact details, names or credentials in previous_state/new_state/reason.
 */
const { HttpError } = require('../../../shared/errors');

async function writeAudit(tx, { actorType, actorId = null, actionType, targetEntity, targetId = null, previousState = null, newState = null, reason = null, correlationId = null }) {
  try {
    await tx.query(
      `INSERT INTO santulan.audit_logs (actor_type, actor_id, action_type, target_entity, target_id, previous_state, new_state, reason, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
      [actorType, actorId, actionType, targetEntity, targetId,
        previousState === null ? null : JSON.stringify(previousState),
        newState === null ? null : JSON.stringify(newState), reason, correlationId],
    );
  } catch (err) {
    throw new HttpError(503, 'AUDIT_UNAVAILABLE', 'The operation was not performed because it could not be audited');
  }
}

module.exports = { writeAudit };
