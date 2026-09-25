/*
 * Cohorts (BUILD 08 section 5): created under an ACTIVE institution; updated and archived by status (never deleted); audited.
 */
const { v4: uuidv4 } = require('uuid');
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const { writeAudit } = require('../audit/auditService');
const rules = require('../domain/adminRules');

const sa = (actor) => store.superAdminScope(actor.adminUserId);
const shape = (d) => ({
  cohortId: d._id, institutionId: d.institution_id, cohortCode: d.cohort_code, cohortName: d.cohort_name, academicYear: d.academic_year,
  developmentalBand: d.developmental_band, educationStage: d.education_stage, status: d.status, createdAt: d.created_at, updatedAt: d.updated_at,
});

async function list(actor, { institutionId } = {}) {
  return store.withScope(sa(actor), async (tx) => ({ cohorts: (await tx.c.cohorts.find(institutionId ? { institution_id: institutionId } : {}, { sort: { cohort_code: 1 } })).map(shape) }));
}

async function create(actor, body, correlationId) {
  return store.withScope(sa(actor), async (tx) => {
    const institution = await tx.c.institutions.findOne({ _id: body.institutionId });
    if (!institution) throw new HttpError(422, 'SCOPE_INVALID', 'The institution does not exist');
    if (institution.status !== 'ACTIVE') throw new HttpError(422, 'INVALID_STATE', 'Cohorts can only be added to an active institution');
    const now = new Date();
    const doc = {
      _id: uuidv4(), institution_id: body.institutionId, cohort_code: body.cohortCode, cohort_name: body.cohortName, academic_year: body.academicYear || null,
      developmental_band: body.developmentalBand || null, education_stage: body.educationStage || null, status: 'ACTIVE', created_at: now, updated_at: now,
    };
    await tx.c.cohorts.insertOne(doc);
    await writeAudit(tx, {
      actorType: 'ADMIN', actorId: actor.adminUserId, actionType: 'COHORT_CREATED', targetEntity: 'cohorts', targetId: doc._id,
      newState: { institution_id: doc.institution_id, cohort_code: doc.cohort_code, status: 'ACTIVE' }, correlationId,
    });
    return shape(doc);
  }, { transaction: true });
}

async function update(actor, id, body, correlationId) {
  return store.withScope(sa(actor), async (tx) => {
    const current = await tx.c.cohorts.findOne({ _id: id });
    if (!current) throw new HttpError(404, 'NOT_FOUND', 'Cohort not found');
    const map = { cohortName: 'cohort_name', academicYear: 'academic_year', developmentalBand: 'developmental_band', educationStage: 'education_stage' };
    const set = {};
    for (const [k, col] of Object.entries(map)) if (body[k] !== undefined) set[col] = body[k];
    if (body.status !== undefined) { rules.assertStatusMove(current.status, body.status); set.status = body.status; }
    const previous = Object.fromEntries(Object.keys(set).map((k) => [k, current[k]]));
    const changed = { ...set };
    set.updated_at = new Date();
    await tx.c.cohorts.updateOne({ _id: id }, { $set: set });
    await writeAudit(tx, {
      actorType: 'ADMIN', actorId: actor.adminUserId, actionType: body.status === 'ARCHIVED' ? 'COHORT_ARCHIVED' : 'COHORT_UPDATED', targetEntity: 'cohorts', targetId: id,
      previousState: previous, newState: changed, correlationId,
    });
    return shape({ ...current, ...set });
  }, { transaction: true });
}

module.exports = { list, create, update, shape };
