/*
 * Builds the student.json shape renderer.js/engine.js expect, directly from our own MongoDB - no Excel round-trip. Domain
 * means are recomputed from raw responses (not read from score_results) so the C4.2 exclusion (rule A12) applies here
 * exactly as it does in unifiedWorkbookWriter.js; this is the same fix, applied a second time because this is a
 * different caller, not a different rule.
 */
const REQUIRED_CONSENTS = { ADOLESCENT: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], EMERGING_ADULT: ['ADULT_SELF_CONSENT'] };
const reportIdOf = (attemptId) => `SAN-${attemptId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

function statusOf(attemptStatus) {
  if (attemptStatus === 'QUALITY_HOLD') return 'hold';
  if (attemptStatus === 'INVALID') return 'invalid';
  return 'normal';
}

async function domainsOf(tx, attempt, set) {
  const items = await tx.c.items.find({ assessment_version_id: set._id, layer: 'CORE', status: 'ACTIVE' });
  const responses = await tx.c.responses.find({ attempt_id: attempt._id, is_current: true });
  const itemById = new Map(items.map((i) => [i._id, i]));
  const answered = new Map();
  for (const r of responses) { const it = itemById.get(r.item_id); if (it) answered.set(r.item_id, Number(r.response_value)); }
  const byDomain = new Map();
  for (const it of items) { if (!byDomain.has(it.domain_code)) byDomain.set(it.domain_code, []); byDomain.get(it.domain_code).push(it); }
  const domains = {};
  for (const [code, domainItems] of byDomain) {
    const scored = domainItems.filter((i) => i.subdomain_code !== 'C4.2'); // held out, rule A12 - see unifiedWorkbookWriter.js
    const answeredScored = scored.filter((i) => answered.has(i._id));
    if (!scored.length) continue;
    domains[code] = { total: scored.length, answered: answeredScored.length, mean: answeredScored.length ? answeredScored.reduce((s, i) => s + answered.get(i._id), 0) / answeredScored.length : 0 };
  }
  return domains;
}

/** @returns the student.json shape for renderReport(), or null if the participant has no usable identity/consent data. */
async function buildStudentFromAttempt(tx, attemptId) {
  const attempt = await tx.c.assessment_attempts.findOne({ _id: attemptId });
  if (!attempt) return null;
  const participant = await tx.c.participants.findOne({ _id: attempt.participant_id });
  const set = await tx.c.assessment_versions.findOne({ _id: attempt.assessment_version_id });
  const pilotDetails = await tx.c.participant_pilot_details.findOne({ participant_id: participant._id });
  const consents = await tx.c.consents.find({ participant_id: participant._id });
  const required = REQUIRED_CONSENTS[participant.assessment_track] || [];
  const consentOk = required.every((t) => consents.some((c) => c.consent_type === t && c.status === 'VERIFIED'));

  const fullName = pilotDetails ? pilotDetails.full_name : participant.santulan_id;
  const domains = await domainsOf(tx, attempt, set);

  return {
    report_id: reportIdOf(attempt._id),
    display_name: fullName,
    first_name: fullName ? fullName.trim().split(/\s+/)[0] : null,
    age: attempt.age_years_at_attempt,
    class: pilotDetails ? pilotDetails.class_name : null,
    assessment_date: (attempt.submitted_at || attempt.completed_at || attempt.created_at).toISOString().slice(0, 10),
    consent_ok: consentOk,
    status: statusOf(attempt.status),
    release: { priority: false, action: false, ifthen: false, review: false }, // all NO until a real growth-plan/release workflow sets these (same default as the unified export)
    domains,
    goals: [],
    plan: [],
    previous: null,
  };
}

module.exports = { buildStudentFromAttempt, reportIdOf };
