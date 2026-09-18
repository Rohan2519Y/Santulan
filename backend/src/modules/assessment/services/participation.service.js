const { randomUUID } = require('crypto');
const db = require('../../../shared/db');
const { HttpError } = require('../../../shared/errors');

/** FR-013: every control action is audit-logged with actor + timestamp + reason. */
async function recordControl(actorId, { action, reason }) {
  const { rows } = await db.query(
    `INSERT INTO participation_controls (id, action, reason, actor_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [randomUUID(), action, reason || null, actorId]
  );
  return rows[0];
}

async function getCurrentControl() {
  const { rows } = await db.query('SELECT * FROM participation_controls ORDER BY created_at DESC LIMIT 1');
  return rows[0] || null;
}

/** Attempt-creation enforces the current control (FR-013); default is OPEN. */
async function assertParticipationOpen() {
  const latest = await getCurrentControl();
  if (latest && (latest.action === 'PAUSE' || latest.action === 'STOP')) {
    throw new HttpError(409, 'ATTEMPT_UNAVAILABLE', `Participation is currently ${latest.action.toLowerCase()}d`);
  }
}

module.exports = { recordControl, getCurrentControl, assertParticipationOpen };
