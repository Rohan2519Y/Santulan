/*
 * Institutions (BUILD 08 section 5): list, create, update and archive (a status move). There is NO delete - an institution with
 * dependent data can only be archived, and an archived one never comes back. Every change is audited in the same transaction.
 */
const { v4: uuidv4 } = require('uuid');
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const { writeAudit } = require('../audit/auditService');
const rules = require('../domain/adminRules');
const cohortService = require('./cohortService');

const sa = (actor) => store.superAdminScope(actor.adminUserId);
const shape = (d) => ({
  institutionId: d._id, institutionCode: d.institution_code, institutionName: d.institution_name, institutionType: d.institution_type,
  parentInstitutionId: d.parent_institution_id, status: d.status, createdAt: d.created_at, updatedAt: d.updated_at,
});

async function list(actor) {
  return store.withScope(sa(actor), async (tx) => {
    const institutions = await tx.c.institutions.find({}, { sort: { institution_name: 1 } });
    const cohorts = await tx.c.cohorts.find({}, { sort: { cohort_code: 1 } });
    return { institutions: institutions.map((i) => ({ ...shape(i), cohorts: cohorts.filter((c) => c.institution_id === i._id).map(cohortService.shape) })) };
  });
}

async function create(actor, body, correlationId) {
  return store.withScope(sa(actor), async (tx) => {
    if (body.parentInstitutionId) {
      const parent = await tx.c.institutions.findOne({ _id: body.parentInstitutionId });
      if (!parent) throw new HttpError(422, 'SCOPE_INVALID', 'The parent institution does not exist');
    }
    const now = new Date();
    const doc = {
      _id: uuidv4(), institution_code: body.institutionCode, institution_name: body.institutionName, institution_type: body.institutionType,
      parent_institution_id: body.parentInstitutionId || null, status: 'ACTIVE', created_at: now, updated_at: now,
    };
    await tx.c.institutions.insertOne(doc);
    await writeAudit(tx, {
      actorType: 'ADMIN', actorId: actor.adminUserId, actionType: 'INSTITUTION_CREATED', targetEntity: 'institutions', targetId: doc._id,
      newState: { institution_code: doc.institution_code, institution_type: doc.institution_type, status: 'ACTIVE' }, correlationId,
    });
    return shape(doc);
  }, { transaction: true });
}

async function update(actor, id, body, correlationId) {
  return store.withScope(sa(actor), async (tx) => {
    const current = await tx.c.institutions.findOne({ _id: id });
    if (!current) throw new HttpError(404, 'NOT_FOUND', 'Institution not found');
    const set = {};
    if (body.institutionName !== undefined) set.institution_name = body.institutionName;
    if (body.institutionType !== undefined) set.institution_type = body.institutionType;
    if (body.parentInstitutionId !== undefined) {
      if (body.parentInstitutionId !== null) {
        await rules.assertNoParentCycle(id, body.parentInstitutionId, async (pid) => {
          const row = await tx.c.institutions.findOne({ _id: pid });
          return row ? { parentId: row.parent_institution_id } : null;
        });
      }
      set.parent_institution_id = body.parentInstitutionId;
    }
    if (body.status !== undefined) { rules.assertStatusMove(current.status, body.status); set.status = body.status; }
    const previous = Object.fromEntries(Object.keys(set).map((k) => [k, current[k]]));
    const changed = { ...set };
    set.updated_at = new Date();
    await tx.c.institutions.updateOne({ _id: id }, { $set: set });
    await writeAudit(tx, {
      actorType: 'ADMIN', actorId: actor.adminUserId, actionType: body.status === 'ARCHIVED' ? 'INSTITUTION_ARCHIVED' : 'INSTITUTION_UPDATED', targetEntity: 'institutions', targetId: id,
      previousState: previous, newState: changed, correlationId,
    });
    return shape({ ...current, ...set });
  }, { transaction: true });
}

module.exports = { list, create, update, shape };
