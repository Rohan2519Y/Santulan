/*
 * Monitoring summary (BUILD 08 section 7): COUNTS ONLY - participants by route / status / institution / cohort, attempts by state, reports
 * by state and the retry queue, exports by state, quality-review counts and the two participation gates. Never a score, an evidence
 * state, a flag code, a severity or anything about a safeguarding trigger.
 */
const store = require('../../models/db');
const controlPlane = require('../domain/controlPlane');
const exportsRepo = require('../../models/repositories/exports');

const group = async (collection, tx, field, filter = null) => {
  const pipeline = [...(filter ? [{ $match: filter }] : []), { $group: { _id: `$${field}`, n: { $sum: 1 } } }];
  return tx.c[collection].aggregate(pipeline);
};
const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id === null ? 'none' : r._id, r.n]));

async function summary(actor) {
  return store.withScope(store.superAdminScope(actor.adminUserId), async (tx) => {
    const byInstitution = await group('participants', tx, 'institution_id', { institution_id: { $ne: null } });
    const byCohort = await group('participants', tx, 'cohort_id', { cohort_id: { $ne: null } });
    const institutions = await tx.c.institutions.find({}, { projection: { institution_code: 1 } });
    const cohorts = await tx.c.cohorts.find({}, { projection: { cohort_code: 1, institution_id: 1 } });
    const code = Object.fromEntries(institutions.map((i) => [i._id, i.institution_code]));
    const cohortCode = Object.fromEntries(cohorts.map((c) => [c._id, c.cohort_code]));
    const reports = toMap(await group('reports', tx, 'generation_status'));
    const unreviewed = await tx.c.quality_flags.count({ disposition: 'UNREVIEWED' });
    const reviewed = await tx.c.quality_flags.count({ disposition: { $ne: 'UNREVIEWED' } });
    const openSets = await tx.c.assessment_versions.find({ participation_state: 'OPEN' }, { projection: { configuration: 1 } });
    return {
      participants: {
        total: await tx.c.participants.count({}),
        byRoute: toMap(await group('participants', tx, 'participation_route')),
        byStatus: toMap(await group('participants', tx, 'status')),
        byInstitution: byInstitution.map((r) => ({ institutionId: r._id, institutionCode: code[r._id] || null, count: r.n })).sort((a, b) => b.count - a.count),
        byCohort: byCohort.map((r) => ({ cohortId: r._id, cohortCode: cohortCode[r._id] || null, count: r.n })).sort((a, b) => b.count - a.count),
      },
      attempts: { byState: toMap(await group('assessment_attempts', tx, 'status')) },
      reports: { byState: reports, retryQueue: reports.FAILED_RETRYABLE || 0 },
      exports: { byState: await exportsRepo.countByStatus(tx) },
      qualityReview: { unreviewed, reviewed },
      participation: { controlPlane: await controlPlane.getState(tx), openAgeGroups: openSets.map((s) => s.configuration).sort() },
    };
  });
}

module.exports = { summary };
