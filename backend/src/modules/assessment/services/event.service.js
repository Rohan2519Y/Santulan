const { randomUUID } = require('crypto');

async function recordEvent(tx, { attemptId, itemId = null, eventType, sessionNumber, metadata = null }) {
  const { rows } = await tx.query(
    `INSERT INTO response_events (id, attempt_id, item_id, event_type, session_number, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [randomUUID(), attemptId, itemId, eventType, sessionNumber, metadata ? JSON.stringify(metadata) : null]
  );
  return rows[0];
}

module.exports = { recordEvent };
