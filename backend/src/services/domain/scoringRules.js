/*
 * Scoring rules (contracts/scoring-and-report.md sections 1-3; BUILD 06; the scoring master). Replaces the SQL function
 * score_attempt. Order inside ONE transaction: attempt checks -> Q06 stop -> quality CLEAR -> keying -> per-domain results
 * (exact integer completeness, no imputation, evidence decided separately) -> seven rows -> attempt SCORING -> SCORED.
 * The server never accepts a score from a client, and scoring never creates a report, a growth plan or a pathway decision.
 */
const { HttpError } = require('../../errors');
const delivery = require('../../models/repositories/delivery');
const quality = require('../../models/repositories/quality');
const scores = require('../../models/repositories/scores');
const { optionValue } = require('./optionScale');
const { eligibleForGroup } = require('./questionSetRules');
const { DOMAIN_ORDER } = require('../reporting/domains');

const HELD_STATES = new Set(['SH']);

/** Exact integer boundary table: 60 % and below is INSUFFICIENT, 80 % and below INCOMPLETE, below 100 % COMPLETE_WITH_MISSING. */
function completenessStatus(valid, eligible) {
  if (!Number.isInteger(valid) || !Number.isInteger(eligible) || eligible < 1 || valid < 0 || valid > eligible) throw new RangeError('valid must be 0..eligible and eligible >= 1');
  if (valid * 100 <= 60 * eligible) return 'INSUFFICIENT';
  if (valid * 100 <= 80 * eligible) return 'INCOMPLETE';
  if (valid < eligible) return 'COMPLETE_WITH_MISSING';
  return 'COMPLETE';
}

/** Rounds to two decimals, half away from zero, tolerant of floating point noise. */
const round2 = (x) => Math.round((x + 1e-9) * 100) / 100;
const round4 = (x) => Math.round((x + 1e-9) * 10000) / 10000;

/**
 * One domain from its eligible questions and the participant's CURRENT answers. No imputation: the mean is over the answers
 * that exist. answers: [{ position, optionCount }].
 */
function scoreDomain({ eligible, answers }) {
  const valid = answers.length;
  const status = completenessStatus(valid, eligible);
  const rawScore = status === 'INSUFFICIENT' ? null : round2(answers.reduce((s, a) => s + optionValue(a.position, a.optionCount), 0) / valid);
  return { eligibleItems: eligible, validItems: valid, completenessStatus: status, completenessRate: round4(valid / eligible), rawScore };
}

/**
 * Evidence state for a domain (decided separately from the score). Default S1. S2 only with the pilot-S2 switch, completeness
 * above 80 % and the domain not held. S3-S5 need the advanced-evidence switch AND governed configuration; the switch alone
 * never promotes. Configuration can hold (SH) or pin (S1) but never promote past what the switches allow.
 */
function decideEvidence(domainCode, status, config = {}, switches = {}) {
  if (status === 'INSUFFICIENT') return 'S0';
  const cfg = config[domainCode];
  if (HELD_STATES.has(cfg)) return 'SH';
  if (cfg === 'S1') return 'S1';
  if (status === 'INCOMPLETE') return 'S1';
  if (switches.advancedEvidence && ['S3', 'S4', 'S5'].includes(cfg)) return cfg;
  if (switches.pilotS2 && (status === 'COMPLETE' || status === 'COMPLETE_WITH_MISSING')) return 'S2';
  return 'S1';
}

/** The latest recorded quality outcome of an attempt, or null. */
async function latestQualityOutcome(tx, attemptId) {
  const [e] = await tx.c.response_events.find({ attempt_id: attemptId, event_type: 'QUALITY_CHECK_COMPLETED' }, { sort: { occurred_at: -1, _id: -1 }, limit: 1 });
  return e ? e.metadata : null;
}

/** Q06: a CURRENT answer whose question belongs to another question set than the attempt's. */
async function detectQ06(tx, attempt, current) {
  if (!current.length) return false;
  const items = await tx.c.items.find({ _id: { $in: current.map((r) => r.item_id) } }, { projection: { assessment_version_id: 1 } });
  return items.some((i) => i.assessment_version_id !== attempt.assessmentVersionId);
}

/**
 * @param tx  a store context with a privileged (SYSTEM) scope, inside a transaction
 * @param opts { evidence: {C1:'SH'..}, switches: {pilotS2..}, correlation?: string }
 * @returns { outcome: 'SCORED'|'ALREADY_SCORED'|'INVALID_Q06' }
 */
async function scoreAttempt(tx, attemptId, scoringVersion, { evidence = {}, switches = {} } = {}) {
  if (!scoringVersion || !String(scoringVersion).trim()) throw new HttpError(422, 'VALIDATION_ERROR', 'A scoring version is required');
  const attempt = await delivery.getAttempt(tx, attemptId);
  if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');

  // a completed identical scoring version is a safe retry; a different version cannot append or overwrite
  const versions = await scores.versionsOf(tx, attemptId);
  if (versions.some((v) => v !== scoringVersion)) throw new HttpError(409, 'INVALID_STATE', 'The attempt is already scored under a different scoring version');
  if (versions.length) return { outcome: 'ALREADY_SCORED' };

  if (attempt.status !== 'SUBMITTED') throw new HttpError(422, 'INVALID_STATE', `Only a submitted attempt can be scored (attempt is ${attempt.status})`);
  const set = await tx.c.assessment_versions.findOne({ _id: attempt.assessmentVersionId });
  if (!set || set.status !== 'FROZEN') throw new HttpError(409, 'ASSESSMENT_NOT_OPEN', 'The question set must be frozen');

  const current = await tx.c.responses.find({ attempt_id: attemptId, is_current: true });

  // Q06 is deterministic and takes precedence: a response to another set's question is a hard scoring stop
  if (await detectQ06(tx, attempt, current)) {
    await quality.raiseFlag(tx, { attemptId, domainCode: null, flagCode: 'Q06', severity: 'HIGH' });
    await delivery.moveAttempt(tx, attemptId, 'SUBMITTED', { status: 'INVALID' });
    return { outcome: 'INVALID_Q06' };
  }

  // quality first: the latest recorded outcome must be CLEAR and no Q06 / Q09 flag may exist
  const outcome = await latestQualityOutcome(tx, attemptId);
  if ((outcome && outcome.outcome) !== 'CLEAR' || (await quality.hasFlag(tx, attemptId, ['Q06', 'Q09']))) {
    throw new HttpError(409, 'QUALITY_NOT_CLEAR', 'The quality check must complete with outcome CLEAR before scoring');
  }

  const items = await tx.c.items.find({ assessment_version_id: attempt.assessmentVersionId, layer: 'CORE', status: 'ACTIVE' });
  if (items.some((i) => i.keying !== 'POSITIVE')) throw new HttpError(503, 'INTERNAL_ERROR', 'A reverse-keyed question was found and no approved keying definition exists');

  const byId = new Map(items.map((i) => [i._id, i]));
  const rows = [];
  for (const domain of DOMAIN_ORDER) {
    const eligible = items.filter((i) => i.domain_code === domain && eligibleForGroup(i, set.configuration));
    if (!eligible.length) throw new HttpError(503, 'CATALOG_DRIFT', `Domain ${domain} has no eligible questions in the frozen set`);
    const eligibleIds = new Set(eligible.map((i) => i._id));
    const answers = current.filter((r) => eligibleIds.has(r.item_id)).map((r) => ({ position: Number(r.response_value), optionCount: byId.get(r.item_id).options.length }));
    const d = scoreDomain({ eligible: eligible.length, answers });
    rows.push({ domainCode: domain, ...d, scoreStatus: decideEvidence(domain, d.completenessStatus, evidence, switches) });
  }

  await scores.insertSeven(tx, { attemptId, participantId: attempt.participantId, assessmentVersionId: attempt.assessmentVersionId, scoringVersion, rows });
  for (const r of rows) {
    // Q07: a missingness cluster is flagged for review; it never changes scoring or attempt state
    if (r.completenessStatus === 'INCOMPLETE' || r.completenessStatus === 'INSUFFICIENT') {
      await quality.raiseFlag(tx, { attemptId, domainCode: r.domainCode, flagCode: 'Q07', severity: 'LOW' });
    }
  }
  if (!(await delivery.moveAttempt(tx, attemptId, 'SUBMITTED', { status: 'SCORING' }))) throw new HttpError(409, 'INVALID_STATE', 'The attempt changed while scoring; try again');
  await delivery.moveAttempt(tx, attemptId, 'SCORING', { status: 'SCORED', scoring_version: scoringVersion, completed_at: new Date() });
  return { outcome: 'SCORED', rows };
}

module.exports = { completenessStatus, scoreDomain, decideEvidence, scoreAttempt, latestQualityOutcome, detectQ06, round2 };
