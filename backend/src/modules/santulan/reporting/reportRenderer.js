/*
 * Deterministic report renderer (BUILD 07 sections 4, 7, 9; contracts/scoring-and-report.md sections 6-8). The same frozen attempt
 * + versions + approved content ALWAYS produce byte-identical section snapshots and the same content_hash (RC-11 / AT-19): no
 * clock, no randomness, no ordering that depends on the database.
 *
 * PROFILE (always): the seven-axis payload - a PLOTTED domain (score 1.00-5.00, completeness, completeness status) or
 * NOT_ENOUGH_DATA ("Not enough data yet"), NEVER plotted at the scale minimum. MEANING / PATTERN / STRENGTH / GROWTH (+ CHANGE with
 * an earlier attempt): only for domains at S2+ with usable completeness, from APPROVED wording; a domain that needs a layer with no
 * approved wording FAILS THE WHOLE REPORT CLOSED (WORDING_MISSING). PRIORITY / ACTION are generated the same way but stored hidden
 * and never fail the report. No subdomain score, band label, percentile, norm or reliable-change claim is ever produced.
 */
const { DOMAIN_ORDER, DOMAIN_NAMES, REPORTABLE_STATES } = require('./domains');
const rulesLib = require('../domain/reportRules');
const delivery = require('../store/repositories/delivery');
const scoresRepo = require('../store/repositories/scores');
const content = require('../store/repositories/content');

const PROFILE_CONTENT_VERSION = 'profile-v1';
const NOT_ENOUGH_DATA = 'NOT_ENOUGH_DATA';
const NOT_ENOUGH_DATA_MESSAGE = 'Not enough data yet';
const USABLE = new Set(['COMPLETE', 'COMPLETE_WITH_MISSING']);

const fix2 = (n) => Number(Number(n).toFixed(2));

/** The PROFILE payload (section 7). `domains`: [{ code, score, state, completeness, completenessStatus }]. */
function profilePayload({ domains, context }) {
  const byCode = new Map(domains.map((d) => [d.code, d]));
  return {
    scale: { min: 1, max: 5 },
    context: { questionSet: context.questionSet, revision: context.revision, developmentalBand: context.developmentalBand, assessedOn: context.assessedOn },
    domains: DOMAIN_ORDER.map((code) => {
      const d = byCode.get(code);
      const plotted = d && d.score !== null && d.score !== undefined && REPORTABLE_STATES.has(d.state) && USABLE.has(d.completenessStatus);
      if (plotted) {
        return { code, name: DOMAIN_NAMES[code], display: 'PLOTTED', score: fix2(d.score), completeness: fix2(d.completeness), completenessStatus: d.completenessStatus };
      }
      return { code, name: DOMAIN_NAMES[code], display: NOT_ENOUGH_DATA, score: null, completeness: null, completenessStatus: null, message: NOT_ENOUGH_DATA_MESSAGE };
    }),
  };
}

/**
 * @param {{ domains: object[], context: object, band: string|null, rules: object[], actionsByDomain?: Record<string, object[]>,
 *           hasPriorAttempt?: boolean, locale?: string }} input
 * @returns sections [{ sectionType, domainCode, contentVersion, locale, displayOrder, contentSnapshot, released }]
 */
function renderSections({ domains, context, band, rules, actionsByDomain = {}, hasPriorAttempt = false, locale = 'en' }) {
  const out = [];
  const add = (sectionType, domainCode, contentVersion, contentSnapshot) => out.push({
    sectionType, domainCode, contentVersion, locale, displayOrder: out.length + 1, contentSnapshot, released: !rulesLib.HIDDEN_LAYERS.has(sectionType),
  });

  add('PROFILE', null, PROFILE_CONTENT_VERSION, JSON.stringify(profilePayload({ domains, context })));

  const reportable = DOMAIN_ORDER.map((code) => domains.find((d) => d.code === code))
    .filter((d) => d && d.score !== null && REPORTABLE_STATES.has(d.state) && USABLE.has(d.completenessStatus));
  const layers = hasPriorAttempt ? [...rulesLib.DESCRIPTIVE_LAYERS, 'CHANGE'] : rulesLib.DESCRIPTIVE_LAYERS; // CHANGE compares attempts: nothing to compare on the first
  for (const d of reportable) {
    for (const layer of layers) {
      const rule = rulesLib.requireWording(rules, { layer, domain: d.code, state: d.state, band, locale }); // fails closed
      add(layer, d.code, rule.version, rule.approvedTextTemplate);
    }
  }
  for (const d of reportable) { // prescriptive layers: generated only when wording exists, stored hidden, never an error
    const priority = rulesLib.pickWording(rules, { layer: 'PRIORITY', domain: d.code, state: d.state, band, locale });
    if (priority) add('PRIORITY', d.code, priority.version, priority.approvedTextTemplate);
  }
  for (const d of reportable) {
    const actions = actionsByDomain[d.code] || [];
    if (actions.length) add('ACTION', d.code, actions[0].version, JSON.stringify({ actions: actions.map((a) => ({ code: a.code, version: a.version, text: a.text })) }));
  }
  return out;
}

/** Loads everything the renderer needs for one SCORED attempt (read-only; runs inside the caller's SYSTEM transaction). */
async function loadRenderInput(tx, attemptId) {
  const attempt = await delivery.getAttempt(tx, attemptId);
  const set = await tx.c.assessment_versions.findOne({ _id: attempt.assessmentVersionId });
  const scores = await scoresRepo.listForAttempt(tx, attemptId);
  const domains = scores.map((s) => ({ code: s.domainCode, score: s.rawScore, state: s.scoreStatus, completeness: s.completenessRate, completenessStatus: s.completenessStatus }));
  const rules = await content.approvedRules(tx, attempt.assessmentVersionId);
  const actionsByDomain = {};
  for (const d of domains) if (REPORTABLE_STATES.has(d.state) && d.score !== null) actionsByDomain[d.code] = await content.activeActions(tx, d.code);
  // strictly earlier scored attempts of the same participant: a later attempt never changes a regenerated report
  const earlier = (await tx.c.assessment_attempts.find({ participant_id: attempt.participantId, status: { $in: ['SCORED', 'REPORT_READY'] }, created_at: { $lt: attempt.createdAt } }, { limit: 1 })).length > 0;
  const assessedOn = (attempt.submittedAt || attempt.createdAt).toISOString().slice(0, 10);
  return {
    domains, band: attempt.developmentalBandAtAttempt, rules, actionsByDomain, hasPriorAttempt: earlier,
    context: { questionSet: set.version_label, revision: set.revision, developmentalBand: attempt.developmentalBandAtAttempt, assessedOn },
  };
}

/** The renderer the service uses: load the inputs, render the sections. */
const renderAttempt = async (tx, attemptId) => renderSections(await loadRenderInput(tx, attemptId));

module.exports = { renderSections, renderAttempt, loadRenderInput, profilePayload, PROFILE_CONTENT_VERSION, NOT_ENOUGH_DATA, NOT_ENOUGH_DATA_MESSAGE };
