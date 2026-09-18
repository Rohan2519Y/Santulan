const { randomUUID } = require('crypto');
const db = require('../../../shared/db');
const { HttpError } = require('../../../shared/errors');
const { recordEvent } = require('./event.service');
const { setParticipantScope } = require('../../../shared/utils/rls');

const ANSWERABLE_STATES = ['IN_PROGRESS', 'PAUSED'];

/**
 * FR-004/BF-01: every edit writes a NEW response row (response_version + 1,
 * supersedes_response_id -> previous CURRENT, is_current=false on the prior
 * row); idempotency_key makes retries safe (research.md §4). T053: the whole
 * operation runs under the caller's RLS participant scope.
 */
async function saveResponse(attempt, participantProfileId, input) {
  if (!ANSWERABLE_STATES.includes(attempt.status)) {
    throw new HttpError(422, 'INVALID_STATE', 'Attempt is not in an answerable state');
  }

  const { rows: itemRows } = await db.query('SELECT * FROM items WHERE id = $1', [input.itemId]);
  const item = itemRows[0];
  if (!item || item.assessmentVersionId !== attempt.assessmentVersionId) {
    throw new HttpError(422, 'ITEM_NOT_ELIGIBLE', "Item does not belong to the attempt's version");
  }

  return db.withTransaction(async (tx) => {
    await setParticipantScope(tx, participantProfileId);

    const { rows: existingByKeyRows } = await tx.query('SELECT * FROM responses WHERE idempotency_key = $1', [input.idempotencyKey]);
    if (existingByKeyRows[0]) return existingByKeyRows[0];

    const { rows: previousRows } = await tx.query(
      'SELECT * FROM responses WHERE attempt_id = $1 AND item_id = $2 AND is_current = true',
      [attempt.id, item.id]
    );
    const previousCurrent = previousRows[0] || null;

    if (previousCurrent) {
      await tx.query('UPDATE responses SET is_current = false WHERE id = $1', [previousCurrent.id]);
    }

    // ON CONFLICT (idempotency_key) DO NOTHING makes a concurrent retry safe
    // (research §4): if another request won the race, no row comes back here.
    const { rows: insertedRows } = await tx.query(
      `INSERT INTO responses
         (id, attempt_id, item_id, participant_profile_id, response_value, response_version, is_current, supersedes_response_id, answered_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        randomUUID(),
        attempt.id,
        item.id,
        participantProfileId,
        input.value,
        previousCurrent ? previousCurrent.responseVersion + 1 : 1,
        previousCurrent ? previousCurrent.id : null,
        new Date(),
        input.idempotencyKey,
      ]
    );

    let created = insertedRows[0];
    if (!created) {
      const { rows: raced } = await tx.query('SELECT * FROM responses WHERE idempotency_key = $1', [input.idempotencyKey]);
      created = raced[0];
    }

    await recordEvent(tx, {
      attemptId: attempt.id,
      itemId: item.id,
      eventType: 'RESPONSE_SAVED',
      sessionNumber: attempt.sessionCount,
    });

    return created;
  });
}

module.exports = { saveResponse };
