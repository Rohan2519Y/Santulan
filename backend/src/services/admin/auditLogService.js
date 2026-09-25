/*
 * Audit log viewer (BUILD 08 section 9): read-only, newest first, filters actor / action / targetEntity / targetId / from / to.
 * An unknown filter key is a 422. Idempotency correlation hashes are not shown; nothing here can change a row (Tier A).
 */
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const rules = require('../domain/adminRules');

const KEYS = ['actor', 'action', 'targetEntity', 'targetId', 'from', 'to', 'limit'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const shape = (r) => ({
  auditId: r._id, actorType: r.actor_type, actorId: r.actor_id, actionType: r.action_type, targetEntity: r.target_entity, targetId: r.target_id,
  previousState: r.previous_state, newState: r.new_state, reason: r.reason, occurredAt: r.occurred_at,
});

async function list(actor, query = {}) {
  const unknown = Object.keys(query).filter((k) => !KEYS.includes(k));
  if (unknown.length) throw rules.unknownFilter(unknown);
  const filter = {};
  if (query.actor) filter.actor_id = query.actor;
  if (query.action) filter.action_type = query.action;
  if (query.targetEntity) filter.target_entity = query.targetEntity;
  if (query.targetId) filter.target_id = query.targetId;
  for (const key of ['from', 'to']) if (query[key] && (!DATE.test(query[key]) || Number.isNaN(Date.parse(query[key])))) throw new HttpError(422, 'VALIDATION_ERROR', `${key} must be a date (YYYY-MM-DD)`);
  if (query.from || query.to) {
    filter.occurred_at = {};
    if (query.from) filter.occurred_at.$gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) filter.occurred_at.$lt = new Date(Date.parse(`${query.to}T00:00:00.000Z`) + 24 * 3600 * 1000);
  }
  const limit = Math.min(500, Math.max(1, Number.parseInt(query.limit, 10) || 100));
  return store.withScope(store.superAdminScope(actor.adminUserId), async (tx) => ({
    auditLogs: (await tx.c.audit_logs.find(filter, { sort: { occurred_at: -1, _id: -1 }, limit })).map(shape),
  }));
}

module.exports = { list };
