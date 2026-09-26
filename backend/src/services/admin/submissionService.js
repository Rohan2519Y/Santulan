/*
 * Submissions overview (ASSUMED read-only addition D-M19, found while reworking the admin pages: the Submissions page needs a list of
 * attempts and the detail drawer needs domain results, and no endpoint of the contract provided them). Rows carry the opaque Santulan ID
 * and operational facts only. Domain results show the evidence state and completeness status. Safeguarding (Q09) flags are NOT shown
 * here - their detail exists only in the restricted quality-review view. Filters: institutionId, cohortId, status, limit; an unknown key is 422.
 */
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const rules = require('../domain/adminRules');
const responsesRepo = require('../../models/repositories/responses');
const { questionsOf } = require('../../models/repositories/questionSets');
const { writeAudit } = require('../audit/auditService');

const KEYS = ['institutionId', 'cohortId', 'status', 'reportState', 'limit'];
const sa = (actor) => store.superAdminScope(actor.adminUserId);

async function list(actor, query = {}) {
  const unknown = Object.keys(query).filter((k) => !KEYS.includes(k));
  if (unknown.length) throw rules.unknownFilter(unknown);
  const limit = Math.min(500, Math.max(1, Number.parseInt(query.limit, 10) || 100));
  return store.withScope(sa(actor), async (tx) => {
    const attemptFilter = {};
    if (query.status) attemptFilter.status = query.status;
    if (query.reportState) { // e.g. FAILED_RETRYABLE: the report retry queue
      const withState = await tx.c.reports.find({ generation_status: query.reportState }, { projection: { attempt_id: 1 } });
      attemptFilter._id = { $in: withState.map((r) => r.attempt_id) };
    }
    if (query.institutionId || query.cohortId) {
      const person = {};
      if (query.institutionId) person.institution_id = query.institutionId;
      if (query.cohortId) person.cohort_id = query.cohortId;
      const ids = (await tx.c.participants.find(person, { projection: { _id: 1 } })).map((p) => p._id);
      attemptFilter.participant_id = { $in: ids };
    }
    const attempts = await tx.c.assessment_attempts.find(attemptFilter, { sort: { created_at: -1, _id: 1 }, limit });
    const people = await tx.c.participants.find({ _id: { $in: [...new Set(attempts.map((a) => a.participant_id))] } }, { projection: { santulan_id: 1, institution_id: 1, cohort_id: 1, participation_route: 1 } });
    const sets = await tx.c.assessment_versions.find({ _id: { $in: [...new Set(attempts.map((a) => a.assessment_version_id))] } }, { projection: { version_label: 1, revision: 1 } });
    const flagRows = await tx.c.quality_flags.aggregate([{ $match: { attempt_id: { $in: attempts.map((a) => a._id) }, flag_code: { $ne: 'Q09' } } }, { $group: { _id: '$attempt_id', n: { $sum: 1 } } }]);
    const flags = Object.fromEntries(flagRows.map((r) => [r._id, r.n]));
    const reports = await tx.c.reports.find({ attempt_id: { $in: attempts.map((a) => a._id) } }, { projection: { attempt_id: 1, generation_status: 1, retry_count: 1 } });
    const reportOf = Object.fromEntries(reports.map((r) => [r.attempt_id, { reportId: r._id, state: r.generation_status, retryCount: r.retry_count }]));
    const person = Object.fromEntries(people.map((p) => [p._id, p]));
    const set = Object.fromEntries(sets.map((s) => [s._id, s]));
    return {
      submissions: attempts.map((a) => ({
        attemptId: a._id, santulanId: (person[a.participant_id] || {}).santulan_id || null, participationRoute: (person[a.participant_id] || {}).participation_route || null,
        institutionId: (person[a.participant_id] || {}).institution_id || null, cohortId: (person[a.participant_id] || {}).cohort_id || null,
        versionLabel: (set[a.assessment_version_id] || {}).version_label || null, revision: (set[a.assessment_version_id] || {}).revision || null,
        status: a.status, sessionCount: a.session_count, createdAt: a.created_at, submittedAt: a.submitted_at, qualityFlagCount: flags[a._id] || 0, report: reportOf[a._id] || null,
      })),
    };
  });
}

async function detail(actor, attemptId) {
  return store.withScope(sa(actor), async (tx) => {
    const a = await tx.c.assessment_attempts.findOne({ _id: attemptId });
    if (!a) throw new HttpError(404, 'NOT_FOUND', 'Submission not found');
    const p = await tx.c.participants.findOne({ _id: a.participant_id }, { projection: { santulan_id: 1, institution_id: 1, cohort_id: 1 } });
    const set = await tx.c.assessment_versions.findOne({ _id: a.assessment_version_id }, { projection: { version_label: 1, revision: 1 } });
    const scores = await tx.c.score_results.find({ attempt_id: attemptId }, { sort: { domain_code: 1 } });
    const flags = await tx.c.quality_flags.find({ attempt_id: attemptId, flag_code: { $ne: 'Q09' } }, { sort: { flag_code: 1, domain_code: 1 } });
    const report = await tx.c.reports.findOne({ attempt_id: attemptId });
    return {
      attemptId, santulanId: p ? p.santulan_id : null, institutionId: p ? p.institution_id : null, cohortId: p ? p.cohort_id : null,
      versionLabel: set ? set.version_label : null, revision: set ? set.revision : null, status: a.status, sessionCount: a.session_count,
      createdAt: a.created_at, submittedAt: a.submitted_at, scoringVersion: a.scoring_version || null,
      report: report ? { reportId: report._id, state: report.generation_status, retryCount: report.retry_count } : null,
      domainResults: scores.map((s) => ({
        domainCode: s.domain_code, score: s.raw_score, completeness: s.completeness_rate, completenessStatus: s.completeness_status, evidenceState: s.score_status,
        eligibleItems: s.eligible_items, validItems: s.valid_items,
      })),
      flags: flags.map((f) => ({ flagId: f._id, flagCode: f.flag_code, domainCode: f.domain_code, severity: f.severity, disposition: f.disposition })),
    };
  });
}

/*
 * Raw answers for one attempt (ASSUMED read-only addition, same basis as `detail` above — D-M19 — the contract never
 * specified this view). Resolves each current response's item and option text so an admin sees the actual question and
 * chosen answer, not just codes. Viewing raw answers is more sensitive than the aggregate results in `detail`, so the
 * read itself is audited (loadAnswerRows takes the actionType so on-screen viewing and CSV export are logged distinctly).
 */
async function loadAnswerRows(tx, attemptId) {
  const a = await tx.c.assessment_attempts.findOne({ _id: attemptId });
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'Submission not found');
  const p = await tx.c.participants.findOne({ _id: a.participant_id }, { projection: { santulan_id: 1 } });
  const items = await questionsOf(tx, a.assessment_version_id);
  const itemById = Object.fromEntries(items.map((i) => [i._id, i]));
  const raw = await responsesRepo.currentByAttempt(tx, attemptId);
  const rows = raw
    .map((r) => {
      const item = itemById[r.item_id];
      const position = Number(r.response_value);
      const option = item ? item.options.find((o) => o.position === position) : null;
      return {
        itemId: r.item_id, itemCode: item ? item.item_code : null, domainCode: item ? item.domain_code : null, displayOrder: item ? item.display_order : null,
        questionText: item ? item.item_text : null, selectedPosition: position, selectedText: option ? option.text : null,
        answeredAt: r.answered_at, responseTimeMs: r.response_time_ms,
      };
    })
    .sort((x, y) => (x.displayOrder ?? 0) - (y.displayOrder ?? 0));
  return { santulanId: p ? p.santulan_id : null, rows };
}

async function responses(actor, attemptId, correlationId) {
  return store.withScope(sa(actor), async (tx) => {
    const { santulanId, rows } = await loadAnswerRows(tx, attemptId);
    await writeAudit(tx, {
      actorType: 'ADMIN', actorId: actor.adminUserId, actionType: 'SUBMISSION_RESPONSES_VIEWED', targetEntity: 'assessment_attempts', targetId: attemptId, correlationId,
    });
    return { attemptId, santulanId, responses: rows };
  });
}

/** Sanitised CSV so the export opens in Excel without formula injection ('='/'+'/'-'/'@' are prefixed with a tab). Every row
 * repeats the participant's Santulan ID and the attempt ID so the file identifies who it belongs to on its own, once downloaded. */
function toCsv(santulanId, attemptId, rows) {
  const safe = (value) => {
    if (value === null || value === undefined) return '';
    const s = String(value).replace(/"/g, '""');
    return /^[=+\-@]/.test(s) ? `"\t${s}"` : `"${s}"`;
  };
  const lines = ['santulan_id,attempt_id,item_code,domain_code,question,answer,answered_at'];
  for (const r of rows) {
    lines.push([santulanId, attemptId, r.itemCode, r.domainCode, r.questionText, r.selectedText ?? r.selectedPosition, r.answeredAt ? new Date(r.answeredAt).toISOString() : ''].map(safe).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Same answers as `responses`, as a downloadable CSV identified by Santulan ID. Exporting is audited separately from
 * viewing (a file leaves the system). Returns the Santulan ID too so the caller can name the file after it. */
async function exportResponsesCsv(actor, attemptId, correlationId) {
  return store.withScope(sa(actor), async (tx) => {
    const { santulanId, rows } = await loadAnswerRows(tx, attemptId);
    await writeAudit(tx, {
      actorType: 'ADMIN', actorId: actor.adminUserId, actionType: 'SUBMISSION_RESPONSES_EXPORTED', targetEntity: 'assessment_attempts', targetId: attemptId, correlationId,
    });
    return { santulanId, csv: toCsv(santulanId, attemptId, rows) };
  });
}

module.exports = { list, detail, responses, exportResponsesCsv };
