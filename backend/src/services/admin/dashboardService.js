/*
 * Admin Dashboard (ASSUMED addition, docs/Santulan 2.0/Dashboard.jpeg): one consolidated read for the dashboard page -
 * KPI counts, the two donut breakdowns, a recent-participants table, pending-action counts, a day-bucketed progress
 * series and per-institution completion percentages. COUNTS AND ROSTER FIELDS ONLY - never a score, an evidence
 * state, a flag code or anything about a safeguarding trigger (same boundary as monitoringService).
 *
 * Scope: institutionId/cohortId/assessmentVersionId narrow every section; dateFrom/dateTo (participant created_at)
 * narrow "participants added" and everything derived from that same participant set (the KPIs, both donuts, the
 * recent-participants table, pending actions, completion-by-institution) so the totals agree across the page, the
 * same way the mockup's KPI-1 total and donut-1 total match. The time series buckets its own three metrics by their
 * own day (registration/started/submitted), independent of dateFrom/dateTo, over `days` trailing days (default 31,
 * matching the mockup's ~one-month window) - it is the one section that legitimately needs a wider window than the
 * snapshot the rest of the page describes.
 *
 * "Assessments started/submitted" and both attempt-based counts are of DISTINCT PARTICIPANTS with a qualifying
 * attempt, not raw attempt rows, so a participant who re-attempted is never counted twice - consistent with every
 * other participant-based count on this page.
 */
const store = require('../../models/db');
const consentRules = require('../domain/consentRules');

const sa = (actor) => store.superAdminScope(actor.adminUserId);
const STARTED_STATUSES = new Set(['STARTED', 'IN_PROGRESS', 'PAUSED', 'SUBMITTED', 'SCORING', 'SCORED', 'REPORT_READY', 'QUALITY_HOLD']);
const SUBMITTED_STATUSES = new Set(['SUBMITTED', 'SCORING', 'SCORED', 'REPORT_READY', 'QUALITY_HOLD']);
const RECENT_LIMIT = 10;
const DEFAULT_SERIES_DAYS = 31;

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const dateRange = (from, to) => {
  const f = {};
  if (from) f.$gte = new Date(`${from}T00:00:00.000Z`);
  if (to) f.$lt = new Date(Date.parse(`${to}T00:00:00.000Z`) + 24 * 3600 * 1000);
  return Object.keys(f).length ? f : undefined;
};

async function dashboard(actor, filters = {}) {
  const { assessmentVersionId, institutionId, cohortId, dateFrom, dateTo } = filters;
  return store.withScope(sa(actor), async (tx) => {
    const participantFilter = {};
    if (institutionId) participantFilter.institution_id = institutionId;
    if (cohortId) participantFilter.cohort_id = cohortId;
    const created = dateRange(dateFrom, dateTo);
    if (created) participantFilter.created_at = created;

    const participants = await tx.c.participants.find(participantFilter);
    const participantIds = participants.map((p) => p._id);
    const participantById = new Map(participants.map((p) => [p._id, p]));

    const attemptFilter = { participant_id: { $in: participantIds } };
    if (assessmentVersionId) attemptFilter.assessment_version_id = assessmentVersionId;
    const attempts = await tx.c.assessment_attempts.find(attemptFilter);
    const attemptsByParticipant = new Map();
    for (const a of attempts) {
      const existing = attemptsByParticipant.get(a.participant_id);
      if (!existing || a.created_at > existing.created_at) attemptsByParticipant.set(a.participant_id, a); // the most recent attempt decides a participant's current state
    }

    const consents = await tx.c.consents.find({ participant_id: { $in: participantIds } });
    const consentsByParticipant = new Map();
    for (const c of consents) { if (!consentsByParticipant.has(c.participant_id)) consentsByParticipant.set(c.participant_id, []); consentsByParticipant.get(c.participant_id).push(c); }
    const verifiedTypes = (participantId) => new Set((consentsByParticipant.get(participantId) || []).filter((c) => c.status === 'VERIFIED').map((c) => c.consent_type));
    const consentComplete = (p) => consentRules.requiredTypes(p.is_minor).every((t) => verifiedTypes(p._id).has(t));

    // one mutually-exclusive bucket per participant: consent pending beats attempt state, matching the form's own gate
    const classify = (p) => {
      if (!consentComplete(p)) return 'CONSENT_PENDING';
      const a = attemptsByParticipant.get(p._id);
      if (!a || a.status === 'CREATED') return 'NOT_STARTED';
      if (SUBMITTED_STATUSES.has(a.status)) return 'SUBMITTED';
      return 'IN_PROGRESS';
    };
    const statusByParticipant = new Map(participants.map((p) => [p._id, classify(p)]));
    const countWhere = (pred) => participants.filter((p) => pred(p)).length;

    const institutions = await tx.c.institutions.find({}, { projection: { institution_code: 1 } });
    const cohorts = await tx.c.cohorts.find({}, { projection: { cohort_code: 1 } });
    const institutionCode = Object.fromEntries(institutions.map((i) => [i._id, i.institution_code]));
    const cohortCode = Object.fromEntries(cohorts.map((c) => [c._id, c.cohort_code]));
    const latestPilotDetails = await tx.c.participant_pilot_details.aggregate([
      { $match: { participant_id: { $in: participantIds } } },
      { $sort: { created_at: -1 } },
      { $group: { _id: '$participant_id', full_name: { $first: '$full_name' } } },
    ]);
    const nameByParticipant = Object.fromEntries(latestPilotDetails.map((d) => [d._id, d.full_name]));

    // "started"/"submitted"/"not started" KPI cards are raw attempt-state tallies (not gated by consent, and
    // deliberately overlapping - started INCLUDES submitted, matching the mockup's own cumulative KPI semantics:
    // 120 total >= 112 started >= 104 submitted). The completion-status DONUT below needs a mutually-exclusive
    // partition of the whole participant set instead (it must sum to the total), so it uses `classify()`'s buckets.
    const submitted = countWhere((p) => statusByParticipant.get(p._id) === 'SUBMITTED');
    const consentsCompleted = countWhere(consentComplete);
    const started = countWhere((p) => STARTED_STATUSES.has((attemptsByParticipant.get(p._id) || {}).status));
    const notStarted = countWhere((p) => !attemptsByParticipant.has(p._id) || attemptsByParticipant.get(p._id).status === 'CREATED');
    const inProgress = countWhere((p) => statusByParticipant.get(p._id) === 'IN_PROGRESS');
    const notStartedWithConsent = countWhere((p) => statusByParticipant.get(p._id) === 'NOT_STARTED'); // excludes consent-pending, for the donut

    const minors = participants.filter((p) => p.is_minor);
    // pendingActions counts are independent "still needs X" tallies (a minor missing both counts under both - useful
    // for a to-do panel); the donut below instead needs a mutually-exclusive partition of all minors, so parent
    // pending takes priority there (it is the more fundamental blocker - student assent is asked for regardless).
    const parentConsentPending = minors.filter((p) => !verifiedTypes(p._id).has('PARENT_GUARDIAN_CONSENT')).length;
    const studentConsentPending = minors.filter((p) => !verifiedTypes(p._id).has('STUDENT_ASSENT')).length;
    const bothVerifiedMinors = minors.filter((p) => verifiedTypes(p._id).has('PARENT_GUARDIAN_CONSENT') && verifiedTypes(p._id).has('STUDENT_ASSENT')).length;
    const studentOnlyPendingForDonut = minors.filter((p) => verifiedTypes(p._id).has('PARENT_GUARDIAN_CONSENT') && !verifiedTypes(p._id).has('STUDENT_ASSENT')).length;

    const byInstitution = new Map();
    for (const p of participants) {
      if (!p.institution_id) continue;
      if (!byInstitution.has(p.institution_id)) byInstitution.set(p.institution_id, { total: 0, submitted: 0 });
      const bucket = byInstitution.get(p.institution_id);
      bucket.total += 1;
      if (statusByParticipant.get(p._id) === 'SUBMITTED') bucket.submitted += 1;
    }
    const completionByInstitution = [...byInstitution.entries()]
      .map(([id, { total, submitted: s }]) => ({ institutionId: id, institutionCode: institutionCode[id] || null, pct: total ? Math.round((s / total) * 100) : 0, total }))
      .sort((a, b) => b.pct - a.pct);

    // the time series: independent of dateFrom/dateTo, its own trailing window (query param `days`, default 31)
    const days = Math.min(180, Math.max(1, Number.parseInt(filters.days, 10) || DEFAULT_SERIES_DAYS));
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const scopeFilter = {};
    if (institutionId) scopeFilter.institution_id = institutionId;
    if (cohortId) scopeFilter.cohort_id = cohortId;
    const seriesParticipants = institutionId || cohortId ? await tx.c.participants.find(scopeFilter) : participants;
    const seriesParticipantIds = new Set(seriesParticipants.map((p) => p._id));
    const seriesParticipantsInWindow = seriesParticipants.filter((p) => p.created_at >= since);
    const seriesAttemptFilter = { participant_id: { $in: [...seriesParticipantIds] } };
    if (assessmentVersionId) seriesAttemptFilter.assessment_version_id = assessmentVersionId;
    const seriesAttempts = (institutionId || cohortId || assessmentVersionId) ? await tx.c.assessment_attempts.find(seriesAttemptFilter) : attempts;

    const buckets = new Map(); // day -> { participantsAdded, assessmentsStarted, assessmentsSubmitted }
    const bump = (day, key) => { if (!buckets.has(day)) buckets.set(day, { date: day, participantsAdded: 0, assessmentsStarted: 0, assessmentsSubmitted: 0 }); buckets.get(day)[key] += 1; }; // eslint-disable-line no-loop-func
    for (const p of seriesParticipantsInWindow) bump(dayKey(p.created_at), 'participantsAdded');
    for (const a of seriesAttempts) {
      if (a.started_at && a.started_at >= since) bump(dayKey(a.started_at), 'assessmentsStarted');
      if (a.submitted_at && a.submitted_at >= since) bump(dayKey(a.submitted_at), 'assessmentsSubmitted');
    }
    const progressOverTime = [...buckets.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      kpis: { participantsAdded: participants.length, consentsCompleted, consentsPending: participants.length - consentsCompleted, assessmentsStarted: started, assessmentsNotStarted: notStarted, assessmentsSubmitted: submitted, assessmentsInProgress: inProgress },
      completionStatus: [
        { key: 'SUBMITTED', label: 'Submitted', count: submitted },
        { key: 'IN_PROGRESS', label: 'In Progress', count: inProgress },
        { key: 'NOT_STARTED', label: 'Not Started', count: notStartedWithConsent },
        { key: 'CONSENT_PENDING', label: 'Consent Pending', count: countWhere((p) => statusByParticipant.get(p._id) === 'CONSENT_PENDING') },
      ],
      consentStatus: {
        total: minors.length,
        breakdown: [
          { key: 'BOTH_VERIFIED', label: 'Parent & Student Consent', count: bothVerifiedMinors },
          { key: 'PARENT_PENDING', label: 'Parent Consent Pending', count: parentConsentPending },
          { key: 'STUDENT_PENDING', label: 'Student Consent Pending', count: studentOnlyPendingForDonut },
        ],
      },
      recentParticipants: participants
        .slice().sort((a, b) => b.created_at - a.created_at).slice(0, RECENT_LIMIT)
        .map((p) => ({
          participantId: p._id, santulanId: p.santulan_id, name: nameByParticipant[p._id] || null, age: p.age_years_at_registration,
          institutionCode: p.institution_id ? institutionCode[p.institution_id] || null : null, cohortCode: p.cohort_id ? cohortCode[p.cohort_id] || null : null,
          consentStatus: consentComplete(p) ? 'COMPLETED' : 'PENDING', assessmentStatus: (attemptsByParticipant.get(p._id) || {}).status || 'NOT_STARTED', createdAt: p.created_at,
        })),
      pendingActions: { parentConsentPending, studentConsentPending, notStarted, inProgress },
      progressOverTime,
      completionByInstitution,
    };
  });
}

module.exports = { dashboard };
