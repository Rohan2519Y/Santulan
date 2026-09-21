/*
 * Test helpers for the submit -> quality -> score -> report pipeline on MongoDB. Attempts are created as SUBMITTED with the migrator
 * (fast, deterministic answers); the pipeline itself runs through the real services with the runtime credential.
 */
const f = require('./committed');
const F = require('./fixtures');
const H = require('./mongoHarness');
const scoreService = require('../../../src/modules/santulan/scoring/scoreService');
const reportService = require('../../../src/modules/santulan/reporting/reportService');
const store = require('../../../src/modules/santulan/store');

/**
 * A participant with an attempt that is SUBMITTED on `set`, answered by value({ itemId, itemCode, domainCode, order, optionCount }) -> position | null.
 * Returns { participantId, token, attemptId }.
 */
async function submittedAttempt(set, { age = 15, value = (i) => i.optionCount, status = 'SUBMITTED', createdAt } = {}) {
  const p = await f.participant(age);
  const db = await H.admin();
  const attempt = await f.insert('assessment_attempts', F.attempt(p.participantId, set.setId, {
    status, session_count: 1, age_years_at_attempt: age, developmental_band_at_attempt: F.bandOf(age), started_at: new Date(), submitted_at: new Date(), last_activity_at: new Date(),
    ...(createdAt ? { created_at: createdAt } : {}),
  }));
  await f.answerAll(attempt._id, value);
  await db.collection('response_events').insertOne(F.responseEvent(attempt._id, { event_type: 'SUBMIT', session_number: 1, metadata: { idempotency_key: `fx-submit-${attempt._id}` } }));
  return { participantId: p.participantId, token: p.token, attemptId: attempt._id };
}

/** Runs quality then scoring for one attempt as the pipeline worker does. */
async function runPipeline(attemptId, { scoringVersion = 'domain-mean-v1' } = {}) {
  const q = await scoreService.runQualityCheck(attemptId, 'test-quality');
  let s = null;
  if (q.outcome === 'CLEAR') s = await scoreService.scoreAttempt(attemptId, scoringVersion, 'test-score');
  return { quality: q, score: s };
}

async function scoredAttempt(set, opts = {}) {
  const a = await submittedAttempt(set, opts);
  await runPipeline(a.attemptId, opts);
  return a;
}

const scoresOf = async (attemptId) => (await (await H.admin()).collection('score_results').find({ attempt_id: attemptId }).sort({ domain_code: 1 }).toArray());
const attemptOf = async (attemptId) => (await H.admin()).collection('assessment_attempts').findOne({ _id: attemptId });

/** Sets a release switch through the audited domain function (as a Super Admin would through the API). */
async function setSwitch(flag, value, adminUserId) {
  const flags = require('../../../src/modules/santulan/domain/releaseFlags');
  return store.withScope(store.superAdminScope(adminUserId), (tx) => flags.setFlag(tx, flag, value, 'test switch change', { adminUserId }), { transaction: true });
}

/** Loads one approved wording per domain and layer for a set (as governed loading would). */
async function approveWording(setId, { domains = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'], layers = ['MEANING', 'PATTERN', 'STRENGTH', 'GROWTH'], state = 'S2', band = null, version = 'test-content-v1', text } = {}) {
  const db = await H.admin();
  const docs = [];
  for (const d of domains) for (const layer of layers) {
    docs.push(F.rule(setId, {
      domain_code: d, layer, evidence_state: state, developmental_band: band, status: 'APPROVED', version, rule_code: `${layer}.${d}.${state}.${band || 'ANY'}.${f.u()}`,
      approved_text_template: text ? text(d, layer) : `Approved ${layer.toLowerCase()} wording for ${d}.`,
    }));
  }
  if (docs.length) await db.collection('interpretation_rules').insertMany(docs);
  return docs;
}

const reportOf = async (attemptId) => (await H.admin()).collection('reports').findOne({ attempt_id: attemptId });
const sectionsOf = async (reportId) => (await H.admin()).collection('report_sections').find({ report_id: reportId }).sort({ display_order: 1 }).toArray();

module.exports = { submittedAttempt, runPipeline, scoredAttempt, scoresOf, attemptOf, setSwitch, approveWording, reportOf, sectionsOf, generateReport: reportService.generateReport };
