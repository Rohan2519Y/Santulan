/*
 * Reads one institution cohort from the platform database into the same tables the kit's unified workbook holds (PARTICIPANTS,
 * IDENTITY, ATTEMPTS, DOMAIN_RESULTS, ITEM_RESPONSES, ITEM_CODEBOOK), so the ported cohort report (cohortModel/cohortPages) runs
 * on real data. The per-attempt numbers are computed exactly as unifiedWorkbookWriter.js computes them (domain means recomputed
 * from current answers, C4.2 held out by subdomain_code), so a cohort report and a student report agree.
 */
const crypto = require('crypto');
const { HttpError } = require('../../../errors');
const W = require('../../research/unifiedWorkbookWriter');

const NOT_YET_SUBMITTED = new Set(['CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED']);
const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };

/** @returns {Promise<{tables: object, sha: string, institution: object, cohort: object|null}>} */
async function loadCohortTables(tx, institutionCode, cohortCode = null) {
  const institution = await tx.c.institutions.findOne({ institution_code: institutionCode });
  if (!institution) throw new HttpError(404, 'NOT_FOUND', 'Institution not found');
  let cohort = null;
  const pq = { institution_id: institution._id };
  if (cohortCode) {
    cohort = await tx.c.cohorts.findOne({ institution_id: institution._id, cohort_code: cohortCode });
    if (!cohort) throw new HttpError(404, 'NOT_FOUND', 'Cohort not found');
    pq.cohort_id = cohort._id;
  }
  const participants = await tx.c.participants.find(pq);
  const participantIds = participants.map((p) => p._id);
  const cohorts = await tx.c.cohorts.find({ _id: { $in: [...new Set(participants.map((p) => p.cohort_id).filter(Boolean))] } });
  const cohortById = new Map(cohorts.map((c) => [c._id, c]));
  const consentsBy = group(await tx.c.consents.find({ participant_id: { $in: participantIds } }), 'participant_id');
  const allAttempts = await tx.c.assessment_attempts.find({ participant_id: { $in: participantIds } });
  const attempts = allAttempts.filter((a) => !NOT_YET_SUBMITTED.has(a.status));
  const attemptIds = attempts.map((a) => a._id);
  const setIds = [...new Set(attempts.map((a) => a.assessment_version_id))];
  const setById = new Map((await tx.c.assessment_versions.find({ _id: { $in: setIds } })).map((s) => [s._id, s]));
  const itemsBySet = group(await tx.c.items.find({ assessment_version_id: { $in: setIds } }, { sort: { display_order: 1 } }), 'assessment_version_id');
  const responsesBy = group(await tx.c.responses.find({ attempt_id: { $in: attemptIds }, is_current: true }), 'attempt_id');
  const pById = new Map(participants.map((p) => [p._id, p]));

  const consentStatusOf = (pid, track) => {
    const own = consentsBy.get(pid) || [];
    return (W.REQUIRED_CONSENTS[track] || []).every((t) => own.some((c) => c.consent_type === t && c.status === 'VERIFIED')) ? 'VERIFIED' : 'PENDING';
  };

  const P = participants.map((p) => ({
    participant_research_id: p.santulan_id, institution_code: institution.institution_code, cohort_code: (cohortById.get(p.cohort_id) || {}).cohort_code || null,
    participation_route: p.participation_route, assessment_track: p.assessment_track, developmental_band: p.developmental_band, administration_language: p.administration_language,
    consent_status: consentStatusOf(p._id, p.assessment_track), participant_status: p.status,
  }));
  const ident = participants.map((p) => ({ participant_research_id: p.santulan_id, institution_name: institution.institution_name }));

  const att = []; const dom = []; const items = []; const codebook = []; const codebookSeen = new Set();
  for (const a of attempts) {
    const p = pById.get(a.participant_id); const set = setById.get(a.assessment_version_id);
    if (!p || !set) continue;
    const setItems = itemsBySet.get(a.assessment_version_id) || [];
    const core = setItems.filter((i) => i.layer === 'CORE' && i.status === 'ACTIVE');
    const answered = new Map();
    const itemById = new Map(setItems.map((i) => [i._id, i]));
    for (const r of responsesBy.get(a._id) || []) if (itemById.has(r.item_id)) answered.set(r.item_id, { position: Number(r.response_value), r });
    const byDomain = group(core, 'domain_code');
    let totalExpected = 0; let totalAnswered = 0;
    for (const [domainCode, domainItems] of byDomain) {
      const scored = domainItems.filter((i) => i.subdomain_code !== 'C4.2');
      const answeredScored = scored.filter((i) => answered.has(i._id));
      const itemsExpected = scored.length; const itemsAnswered = answeredScored.length;
      const mean = itemsAnswered > 0 ? W.round2(answeredScored.reduce((s, i) => s + answered.get(i._id).position, 0) / itemsAnswered) : null;
      const share = itemsExpected > 0 ? W.round2(1 - itemsAnswered / itemsExpected) : null;
      const state = itemsExpected > 0 ? W.missingState(itemsExpected, share) : 'MS04';
      totalExpected += domainItems.length; totalAnswered += domainItems.filter((i) => answered.has(i._id)).length;
      dom.push({ attempt_id: a._id, participant_research_id: p.santulan_id, domain_code: domainCode, domain_name: W.DOMAIN_NAME[domainCode] || null, domain_mean: mean, items_expected: itemsExpected, items_answered: itemsAnswered, missing_share: share, missing_state: state, reportable: W.reportableOf(state) });
    }
    att.push({
      participant_research_id: p.santulan_id, attempt_id: a._id, assessment_form: set.configuration, assessment_version: set.version_label, age_years_at_attempt: a.age_years_at_attempt,
      developmental_band: a.developmental_band_at_attempt, attempt_status: W.kitAttemptStatus(a.status), submitted_at: a.submitted_at, total_items_expected: totalExpected, total_items_answered: totalAnswered,
      completion_pct: totalExpected ? W.round2(totalAnswered / totalExpected) : 0, missing_item_count: totalExpected - totalAnswered, report_state: W.reportStateOf(a.status), scoring_version: a.scoring_version || 'domain-mean-v1',
    });
    for (const it of core) {
      const hit = answered.get(it._id);
      items.push({
        participant_research_id: p.santulan_id, attempt_id: a._id, assessment_form: set.configuration, item_code: it.item_code, domain_code: it.domain_code, subdomain_code: it.subdomain_code,
        response_value: hit ? hit.r.response_value : null, missing_flag: hit ? 'NO' : 'YES', is_current: hit ? true : null, response_timestamp: hit ? hit.r.answered_at : null, time_spent_ms: hit ? hit.r.response_time_ms : null,
      });
    }
    if (!codebookSeen.has(set._id)) {
      codebookSeen.add(set._id);
      for (const i of setItems) codebook.push({ assessment_form: set.configuration, assessment_version: set.version_label, item_code: i.item_code, domain_code: i.domain_code, subdomain_code: i.subdomain_code, subdomain_name: i.subdomain_name, keying: i.keying, layer: i.layer, status: i.status });
    }
  }
  const tables = { P, ident, att, dom, items, codebook, config: [] };
  // no names are read anywhere here: the cohort report carries no individual names
  const sha = crypto.createHash('sha256').update(JSON.stringify(tables)).digest('hex');
  return { tables, sha, institution, cohort };
}

module.exports = { loadCohortTables };
