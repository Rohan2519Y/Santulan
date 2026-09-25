/*
 * API-layer idempotency for create operations (BUILD 03 section 10, research R-04 / D-09), on MongoDB.
 * There is no idempotency collection in the canonical model, so the outcome of the first successful request is persisted in
 * the append-only audit_logs row it already writes: correlation_id = 'idem:' + sha256(key), new_state.payload_hash, and a
 * DETERMINISTIC `_id` derived from (action, key). That deterministic id is the concurrency guard: two simultaneous requests
 * with the same key cannot both insert it (the loser gets IDEMPOTENCY_RACE / a write conflict and re-reads the winner's
 * outcome). No raw key and no personal data is stored. Same key + same payload => replay; different payload => 409.
 */
const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');

const NAMESPACE = 'b3c1c1a4-6a8a-4b0e-9d59-5a2b6f0e7c11'; // fixed, arbitrary; never change (would break replay of old keys)
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
/** Deterministic audit id for an (action, key) pair. */
const outcomeId = (actionType, key) => uuidv5(`${actionType}:${keyToken(key)}`, NAMESPACE);

/** Returns { targetId, newState } of the recorded first outcome, or null. */
async function findOutcome(tx, actionType, key) {
  const row = await tx.c.audit_logs.findOne({ action_type: actionType, correlation_id: keyToken(key) });
  return row ? { targetId: row.target_id, newState: row.new_state } : null;
}

/** True when the error is the idempotency race (another request with the same key won). */
const isRace = (err) => !!err && (err.code === 'IDEMPOTENCY_RACE');

module.exports = { payloadHash, keyToken, outcomeId, findOutcome, isRace, canonicalize };
