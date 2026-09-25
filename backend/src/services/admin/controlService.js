/*
 * Assessment control (BUILD 08 section 4; control plane R-18). The operational switch is event-sourced in audit_logs: the audit event
 * IS the mutation, so a change either persists together with its audit record or does not happen at all (fails closed when the insert
 * fails). New attempts start only while the latest event says OPEN (and the question set itself is open - the two gates are shown
 * separately). Existing attempts and frozen sets are never touched.
 */
const store = require('../../models/db');
const { writeAudit } = require('../audit/auditService');
const audit = require('../../models/repositories/audit');
const controlPlane = require('../domain/controlPlane');
const rules = require('../domain/adminRules');

const ACTION = 'PARTICIPATION_CONTROL';
const sa = (actor) => store.superAdminScope(actor.adminUserId);

const shape = (row) => (row ? { state: row.new_state.state, reason: row.reason || null, changedAt: row.occurred_at, changedBy: row.actor_id } : { state: 'OPEN', reason: null, changedAt: null, changedBy: null });

/** Both gates: the control plane (the latest audit event) and the open question set per age group. */
async function read(actor) {
  return store.withScope(sa(actor), async (tx) => {
    const latest = await audit.latestEvent(tx, ACTION);
    const sets = await tx.c.assessment_versions.find({ participation_state: 'OPEN' }, { sort: { configuration: 1 } });
    const recent = await tx.c.audit_logs.find({ action_type: ACTION }, { sort: { occurred_at: -1, _id: -1 }, limit: 10 });
    return {
      ...shape(latest),
      controlPlane: await controlPlane.getState(tx), // 'OPEN' | 'STOPPED' (a PAUSED event also stops new attempts)
      openSets: sets.map((s) => ({ setId: s._id, versionLabel: s.version_label, revision: s.revision, ageGroup: s.configuration })),
      recent: recent.map(shape),
    };
  });
}

/** Changes the state. PAUSED and STOPPED need a reason. Returns the new state. */
async function setState(actor, { state, reason }, correlationId) {
  const cleanReason = rules.assertControlChange(state, reason);
  return store.withScope(sa(actor), async (tx) => {
    const previous = await audit.latestEvent(tx, ACTION);
    await writeAudit(tx, {
      actorType: 'ADMIN', actorId: actor.adminUserId, actionType: ACTION, targetEntity: 'participation',
      previousState: { state: previous ? previous.new_state.state : 'OPEN' }, newState: { state }, reason: cleanReason, correlationId,
    });
    return { state, reason: cleanReason };
  }, { transaction: true });
}

module.exports = { read, setState };
