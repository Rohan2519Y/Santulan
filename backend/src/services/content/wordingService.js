/*
 * Admin UI path for governed report wording (interpretation_rules), alongside the existing CLI path (scripts/wording-load.js).
 * Reuses that script's pure validation/id helpers (ruleCode, ruleId, DOMAINS/BANDS/STATES/LAYERS) so the two paths can never
 * drift apart on what a valid rule looks like, but writes through the normal application store (SUPER_ADMIN scope, the
 * runtime credential) instead of the migrator credential the script uses - src/ never reads MONGODB_URI_ADMIN (SEC-30).
 *
 * The engine still never writes prose: this only lets an admin do, through the UI, exactly what the script already does -
 * add a DRAFT rule, then approve it - with the same DRAFT -> APPROVED one-way lifecycle and the same uniqueness rules
 * (one row per exact version, at most one APPROVED row per domain/band/evidence-state/locale/layer).
 */
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const { writeAudit } = require('../audit/auditService');
const { ruleCode, ruleId, DOMAINS, BANDS, STATES, LAYERS } = require('../../../scripts/wording-load');

const sa = (actor) => store.superAdminScope(actor.adminUserId);
const actorOf = (actor) => ({ actorType: 'ADMIN', actorId: actor.adminUserId });
const nonblank = (v) => typeof v === 'string' && v.trim() !== '';

const toApi = (r) => ({
  ruleId: r._id, assessmentVersionId: r.assessment_version_id, domainCode: r.domain_code, band: r.developmental_band,
  evidenceState: r.evidence_state, locale: r.locale, layer: r.layer, ruleCode: r.rule_code, text: r.approved_text_template,
  version: r.version, status: r.status, createdAt: r.created_at,
});

/** Every wording rule of one question set, newest/most-relevant first for admin review. */
async function list(actor, assessmentVersionId) {
  return store.withScope(sa(actor), async (tx) => {
    const set = await tx.c.assessment_versions.findOne({ _id: assessmentVersionId });
    if (!set) throw new HttpError(404, 'NOT_FOUND', 'Question set not found');
    const rows = await tx.c.interpretation_rules.find({ assessment_version_id: assessmentVersionId }, { sort: { domain_code: 1, layer: 1, evidence_state: 1, version: -1 } });
    return { set: { setId: set._id, versionLabel: set.version_label, revision: set.revision }, rules: rows.map(toApi) };
  });
}

/** Field-level validation shared by add(); mirrors validateWordingFile's per-rule checks in scripts/wording-load.js. */
function assertValidRule({ domain, band, evidenceState, locale, layer, version, text }) {
  const problems = [];
  if (!DOMAINS.includes(domain)) problems.push(`domain must be one of ${DOMAINS.join(', ')}`);
  if (band !== null && band !== undefined && !BANDS.includes(band)) problems.push(`band must be empty or one of ${BANDS.join(', ')}`);
  if (!STATES.includes(evidenceState)) problems.push(`evidenceState must be one of ${STATES.join(', ')} (no interpretation exists below S2)`);
  if (!nonblank(locale)) problems.push('locale is required');
  if (!LAYERS.includes(layer)) problems.push(`layer must be one of ${LAYERS.join(', ')}`);
  if (!nonblank(version)) problems.push('version is required');
  if (!nonblank(text)) problems.push('text is required');
  if (problems.length) throw new HttpError(422, 'VALIDATION_ERROR', problems.join('; '));
}

/** Adds one DRAFT rule (idempotent on an identical resubmit; 409 if the same version already holds different text). */
async function add(actor, { assessmentVersionId, domain, band = null, evidenceState, locale, layer, version, text }, correlationId) {
  assertValidRule({ domain, band, evidenceState, locale, layer, version, text });
  const trimmedText = text.trim();
  return store.withScope(sa(actor), async (tx) => {
    const set = await tx.c.assessment_versions.findOne({ _id: assessmentVersionId });
    if (!set) throw new HttpError(404, 'NOT_FOUND', 'Question set not found');
    const r = { domain, band: band || null, evidenceState, locale, layer, version };
    const code = ruleCode(r);
    const id = ruleId(set._id, r);
    const existing = await tx.c.interpretation_rules.findOne({ _id: id });
    if (existing) {
      if (existing.approved_text_template !== trimmedText) throw new HttpError(409, 'WORDING_VERSION_CONFLICT', `${code} version ${version} already exists with different text; add it under a new version`);
      return { created: false, rule: toApi(existing) };
    }
    const doc = {
      _id: id, assessment_version_id: set._id, domain_code: domain, developmental_band: band || null, evidence_state: evidenceState,
      locale, layer, rule_code: code, approved_text_template: trimmedText, version, status: 'DRAFT', created_at: new Date(),
    };
    await tx.c.interpretation_rules.insertOne(doc);
    await writeAudit(tx, { ...actorOf(actor), actionType: 'WORDING_LOADED', targetEntity: 'interpretation_rules', targetId: id, newState: { ruleCode: code, version, status: 'DRAFT' }, correlationId });
    return { created: true, rule: toApi(doc) };
  }, { transaction: true });
}

/** DRAFT -> APPROVED. Refused (409) if a different rule is already the approved one for this exact dimension. */
async function approve(actor, ruleIdValue, reason, correlationId) {
  return store.withScope(sa(actor), async (tx) => {
    const existing = await tx.c.interpretation_rules.findOne({ _id: ruleIdValue });
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Wording rule not found');
    if (existing.status === 'APPROVED') return toApi(existing);
    if (existing.status !== 'DRAFT') throw new HttpError(409, 'INVALID_STATE', `${existing.rule_code} is ${existing.status.toLowerCase()}, not draft`);
    const r = await tx.c.interpretation_rules.updateOne({ _id: ruleIdValue, status: 'DRAFT' }, { $set: { status: 'APPROVED' } });
    if (r.modified !== 1) throw new HttpError(409, 'INVALID_STATE', 'The rule changed while approving; try again');
    await writeAudit(tx, {
      ...actorOf(actor), actionType: 'WORDING_APPROVED', targetEntity: 'interpretation_rules', targetId: ruleIdValue,
      previousState: { status: 'DRAFT' }, newState: { status: 'APPROVED', ruleCode: existing.rule_code, version: existing.version }, reason, correlationId,
    });
    return toApi({ ...existing, status: 'APPROVED' });
  }, { transaction: true });
}

module.exports = { list, add, approve, DOMAINS, BANDS, STATES, LAYERS };
