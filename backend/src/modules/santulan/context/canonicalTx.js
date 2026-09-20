/*
 * The ONLY place that sets the trusted per-transaction context for the canonical schema
 * (contracts/database-contract.md §3, research R-03). Values come from server-verified state, never from request
 * input. The settings are transaction-local (set_config(..., true)), so they cannot leak across pooled connections.
 *
 *   actorScope   PARTICIPANT | INSTITUTION_ADMIN | RESEARCH_OPERATOR | SUPER_ADMIN | SYSTEM
 *   asWorker     run the transaction as the controlled write role santulan_worker (SET LOCAL ROLE)
 */
const db = require('../../../shared/db');
const { mapDbError } = require('../shared/dbErrors');

const SCOPES = new Set(['PARTICIPANT', 'INSTITUTION_ADMIN', 'RESEARCH_OPERATOR', 'SUPER_ADMIN', 'SYSTEM']);

async function withCanonicalTx({ actorScope, participantId = '', adminUserId = '', institutionId = '', asWorker = false }, fn) {
  if (!SCOPES.has(actorScope)) throw new Error(`invalid actor scope: ${actorScope}`);
  try {
    return await db.withTransaction(async (tx) => {
      await tx.raw(
        `SELECT set_config('app.actor_scope', $1, true), set_config('app.participant_id', $2, true),
                set_config('app.admin_user_id', $3, true), set_config('app.institution_id', $4, true)`,
        [actorScope, participantId || '', adminUserId || '', institutionId || ''],
      );
      if (asWorker) await tx.raw('SET LOCAL ROLE santulan_worker');
      return fn(tx);
    });
  } catch (err) {
    throw mapDbError(err);
  }
}

/** Server-side work with no end user (registration service, workers): SYSTEM scope as the worker role. */
const withSystemTx = (fn) => withCanonicalTx({ actorScope: 'SYSTEM', asWorker: true }, fn);

module.exports = { withCanonicalTx, withSystemTx };
