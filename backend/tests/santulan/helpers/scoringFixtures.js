/*
 * Fixtures for the scoring database tests (used inside the rolled-back withTx harness, as the owner with SYSTEM context).
 * Answers are inserted in one statement (the same triggers validate every row); expected means are computed here in JS from
 * the committed catalog files, independently of the SQL scorer.
 */
const { loadCatalogFiles, FORMS } = require('../../../src/modules/santulan/catalog/catalogFiles');

const ADOL = 'santulan-adolescent-pilot-v3.1';
const EA = 'santulan-emergingadult-pilot-v3.1';
const DOMAINS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
const files = loadCatalogFiles();

const ELIGIBLE = {
  [ADOL]: { bands: ['13–17', '13–25'], contexts: ['School', 'General', 'Digital'] },
  [EA]: { bands: ['18–25', '13–25'], contexts: ['College/Work', 'General', 'Digital'] },
};
const ageFor = (label) => (label === ADOL ? 15 : 21);

/** Catalog rows of a version that the scorer treats as eligible. */
const eligibleRows = (label) => files.items[label].filter((r) => ELIGIBLE[label].bands.includes(r.age_band) && ELIGIBLE[label].contexts.includes(r.context));

/**
 * A participant with consents, an open version, and a SUBMITTED attempt.
 * value(item) -> '1'..'5' | null (null = leave unanswered); items carry item_code, domain_code, subdomain_code, display_order.
 */
async function submittedAttempt(tx, { label = ADOL, value = () => '3', quality = null } = {}) {
  const age = ageFor(label);
  const p = await tx.participant({ age });
  await tx.verifyConsents(p.participant_id, age < 18);
  const v = await tx.openVersion(label);
  const a = await tx.attempt(p.participant_id, v.assessment_version_id, age);
  await tx.exec('SELECT santulan.begin_or_resume_session($1)', [a.attempt_id]);
  const items = await tx.q(`SELECT item_id, item_code, domain_code, subdomain_code, display_order FROM santulan.items WHERE assessment_version_id = $1 ORDER BY display_order`, [v.assessment_version_id]);
  const answered = items.map((it) => ({ it, val: value(it) })).filter((x) => x.val !== null && x.val !== undefined);
  if (answered.length) {
    await tx.exec(
      `INSERT INTO santulan.responses (attempt_id, item_id, response_value, response_version, is_current, idempotency_key)
       SELECT $1::uuid, x.item_id, x.val, 1, true, 'fixture-' || $4::text || '-' || x.item_id::text FROM unnest($2::uuid[], $3::text[]) AS x(item_id, val)`,
      [a.attempt_id, answered.map((x) => x.it.item_id), answered.map((x) => String(x.val)), a.attempt_id],
    );
  }
  await tx.exec('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, `fixture-submit-${a.attempt_id}`]);
  if (quality) await qualityEvent(tx, a.attempt_id, quality);
  return { p, v, a, items, label };
}

const qualityEvent = (tx, attemptId, outcome) => tx.exec(
  `INSERT INTO santulan.response_events (attempt_id, event_type, occurred_at, metadata) VALUES ($1, 'QUALITY_CHECK_COMPLETED', clock_timestamp(), $2::jsonb)`,
  [attemptId, JSON.stringify({ outcome })]);

const score = (tx, attemptId, version = 'scoring-test-v1', evidence = {}) =>
  tx.one('SELECT santulan.score_attempt($1, $2, $3::jsonb) AS outcome', [attemptId, version, JSON.stringify(evidence)]);
const scoreRows = (tx, attemptId) => tx.q('SELECT domain_code, raw_score, completeness_rate, score_status, scoring_version FROM santulan.score_results WHERE attempt_id = $1 ORDER BY domain_code', [attemptId]);

/** Expected domain means (2 dp, as strings) for the given answer function, computed straight from the catalog. */
function expectedMeans(label, value) {
  const out = {};
  for (const d of DOMAINS) {
    const vals = eligibleRows(label).filter((r) => r.domain_code === d).map((r) => value(r)).filter((x) => x !== null && x !== undefined).map(Number);
    out[d] = vals.length ? (vals.reduce((s, x) => s + x, 0) / vals.length).toFixed(2) : null;
  }
  return out;
}
const eligibleCount = (label, d) => eligibleRows(label).filter((r) => r.domain_code === d).length;

module.exports = { ADOL, EA, DOMAINS, FORMS, submittedAttempt, qualityEvent, score, scoreRows, expectedMeans, eligibleRows, eligibleCount, ageFor };
