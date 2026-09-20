/*
 * API-layer idempotency for create operations (BUILD 03 §10, research R-04 / D-09).
 * The frozen 28-table schema has no idempotency table, so the outcome of the first successful request is persisted in the
 * append-only audit_logs row it already writes: correlation_id = 'idem:' + sha256(key) and new_state.payload_hash.
 * No raw key and no personal data is stored. Same key + same payload => replay; same key + different payload => 409.
 */
const crypto = require('crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalize(value[k])]));
  }
  return value;
}

const payloadHash = (payload) => sha256(JSON.stringify(canonicalize(payload)));
const keyToken = (key) => `idem:${sha256(key)}`;

/** Serialises concurrent requests carrying the same key for the rest of the transaction. */
async function lockKey(tx, scope, key) {
  await tx.raw('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${scope}:${keyToken(key)}`]);
}

/** Returns { targetId, newState } of the recorded first outcome, or null. */
async function findOutcome(tx, actionType, key) {
  const { rows } = await tx.query(
    `SELECT target_id, new_state FROM santulan.audit_logs WHERE action_type = $1 AND correlation_id = $2 LIMIT 1`,
    [actionType, keyToken(key)],
  );
  return rows[0] ? { targetId: rows[0].targetId, newState: rows[0].newState } : null;
}

module.exports = { payloadHash, keyToken, lockKey, findOutcome };
