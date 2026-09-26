/*
 * Participant administration (BUILD 08 section 6): a filtered listing (whitelisted keys; an unknown key is a 422), and suspend /
 * reactivate with a required reason. Rows carry the opaque Santulan ID and operational fields only - never contact details or names.
 * A suspended participant loses access on their next request (the session check reads the database).
 */
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const { writeAudit } = require('../audit/auditService');
const rules = require('../domain/adminRules');

const sa = (actor) => store.superAdminScope(actor.adminUserId);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const shape = (p) => ({
  participantId: p._id, santulanId: p.santulan_id, participationRoute: p.participation_route, assessmentTrack: p.assessment_track, developmentalBand: p.developmental_band,
  institutionId: p.institution_id, cohortId: p.cohort_id, status: p.status, createdAt: p.created_at,
});

/** query: route, institutionId, cohortId, status, search (Santulan ID prefix), limit. Omitting every filter is documented global behaviour (all participants, newest first). */
async function list(actor, query = {}) {
  rules.assertKnownListingKeys(query);
  const filter = {};
  if (query.route) filter.participation_route = query.route;
  if (query.institutionId) filter.institution_id = query.institutionId;
  if (query.cohortId) filter.cohort_id = query.cohortId;
  if (query.status) filter.status = query.status;
  const search = rules.santulanIdPrefix(query.search);
  if (search) filter.santulan_id = search;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT));
  return store.withScope(sa(actor), async (tx) => {
    const total = await tx.c.participants.count(filter);
    const rows = await tx.c.participants.find(filter, { sort: { created_at: -1, _id: 1 }, limit });
    return { participants: rows.map(shape), total, truncated: total > rows.length };
  });
}

/** Suspend or reactivate; the reason is required and audited. */
async function setStatus(actor, participantId, { status, reason }, correlationId) {
  const cleanReason = rules.cleanReason(reason);
  return store.withScope(sa(actor), async (tx) => {
    const p = await tx.c.participants.findOne({ _id: participantId });
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'Participant not found');
    rules.assertParticipantStatusMove(p.status, status);
    if (!(await tx.c.participants.transition(participantId, { status: p.status }, { status, updated_at: new Date() }))) throw new HttpError(409, 'INVALID_STATE', 'The participant changed while updating; try again');
    await writeAudit(tx, {
      actorType: 'ADMIN', actorId: actor.adminUserId, actionType: status === 'SUSPENDED' ? 'PARTICIPANT_SUSPENDED' : 'PARTICIPANT_REACTIVATED', targetEntity: 'participants', targetId: participantId,
      previousState: { status: p.status }, newState: { status }, reason: cleanReason, correlationId,
    });
    return { participantId, santulanId: p.santulan_id, status };
  }, { transaction: true });
}

module.exports = { list, setStatus, shape };
