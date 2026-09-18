/**
 * research.md §2 describes this pattern keyed on an institution GUC, but
 * this feature's data model (data-model.md ParticipantProfile) carries no
 * institution_id - institution hierarchy is out of scope (plan.md). FR-016's
 * actual isolation boundary here is per-participant, so the GUC this
 * implementation uses is `app.participant_profile_id` instead, applied to the
 * `responses` table (T053) - the same set_config(..., true) = SET LOCAL
 * pattern: connection-scoped, auto-reset on commit/rollback, safe under
 * pooling. Call this as the FIRST statement inside a transaction (`tx` from
 * shared/db.js withTransaction), before any scoped read/write on that client.
 */
async function setParticipantScope(tx, participantProfileId) {
  await tx.raw('SELECT set_config($1, $2, true)', ['app.participant_profile_id', participantProfileId ?? '']);
}

/** Admin queries are not scoped to one participant; policies check this bypass GUC. */
async function setAdminBypass(tx) {
  await tx.raw("SELECT set_config('app.bypass_rls', 'true', true)");
}

/** Reads back the current participant GUC. Missing GUC fails closed (NULL, never a wildcard). */
async function currentParticipantScope(tx) {
  const { rows } = await tx.raw("SELECT NULLIF(current_setting('app.participant_profile_id', true), '') AS participant_profile_id");
  return rows?.[0]?.participant_profile_id ?? null;
}

module.exports = { setParticipantScope, setAdminBypass, currentParticipantScope };
