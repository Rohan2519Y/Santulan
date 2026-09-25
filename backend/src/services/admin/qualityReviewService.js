/*
 * Quality review (BUILD 08 section 8): the restricted, minimum-necessary reviewer view of quality flags and the disposition decision.
 * Q09 detail exists ONLY here (never in monitoring, exports or any participant surface). A review records the disposition, the
 * reviewer and an optional note in one update (the store keeps the three review fields all-or-none); the audit row carries no note text.
 */
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const { writeAudit } = require('../audit/auditService');
const quality = require('../../models/repositories/quality');
const rules = require('../domain/adminRules');

const KEYS = ['disposition', 'attemptId', 'flagCode', 'limit'];
const DISPOSITIONS = ['UNREVIEWED', 'DISMISSED', 'CONFIRMED', 'ESCALATED'];
const REVIEW_DISPOSITIONS = DISPOSITIONS.filter((d) => d !== 'UNREVIEWED');
const sa = (actor) => store.superAdminScope(actor.adminUserId);

const shape = (f, santulanId) => ({
  flagId: f._id, attemptId: f.attempt_id, santulanId: santulanId || null, flagCode: f.flag_code, domainCode: f.domain_code, severity: f.severity, detectedAt: f.detected_at,
  disposition: f.disposition, reviewedAt: f.reviewed_at, reviewNote: f.review_note,
});

async function list(actor, query = {}) {
  const unknown = Object.keys(query).filter((k) => !KEYS.includes(k));
  if (unknown.length) throw rules.unknownFilter(unknown);
  if (query.disposition && !DISPOSITIONS.includes(query.disposition)) throw new HttpError(422, 'VALIDATION_ERROR', 'disposition is not recognised');
  const filter = {};
  if (query.disposition) filter.disposition = query.disposition;
  if (query.attemptId) filter.attempt_id = query.attemptId;
  if (query.flagCode) filter.flag_code = query.flagCode;
  const limit = Math.min(500, Math.max(1, Number.parseInt(query.limit, 10) || 100));
  return store.withScope(sa(actor), async (tx) => {
    const flags = await tx.c.quality_flags.find(filter, { sort: { detected_at: -1, _id: 1 }, limit });
    const attempts = await tx.c.assessment_attempts.find({ _id: { $in: [...new Set(flags.map((f) => f.attempt_id))] } }, { projection: { participant_id: 1 } });
    const people = await tx.c.participants.find({ _id: { $in: [...new Set(attempts.map((a) => a.participant_id))] } }, { projection: { santulan_id: 1 } });
    const santulanOf = Object.fromEntries(attempts.map((a) => [a._id, (people.find((p) => p._id === a.participant_id) || {}).santulan_id]));
    return { flags: flags.map((f) => shape(f, santulanOf[f.attempt_id])) };
  });
}

async function review(actor, flagId, { disposition, note }, correlationId) {
  if (!REVIEW_DISPOSITIONS.includes(disposition)) throw new HttpError(422, 'VALIDATION_ERROR', `disposition must be one of ${REVIEW_DISPOSITIONS.join(', ')}`);
  return store.withScope(sa(actor), async (tx) => {
    const flag = await tx.c.quality_flags.findOne({ _id: flagId });
    if (!flag) throw new HttpError(404, 'NOT_FOUND', 'Quality flag not found');
    await quality.review(tx, flagId, { disposition, reviewedBy: actor.adminUserId, note: note || null });
    await writeAudit(tx, {
      actorType: 'ADMIN', actorId: actor.adminUserId, actionType: 'QUALITY_FLAG_REVIEWED', targetEntity: 'quality_flags', targetId: flagId,
      previousState: { disposition: flag.disposition }, newState: { disposition }, correlationId,
    });
    return shape({ ...flag, disposition, reviewed_at: new Date(), review_note: note || null });
  }, { transaction: true });
}

module.exports = { list, review, DISPOSITIONS };
