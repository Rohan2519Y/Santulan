/* Controlled content reads: approved wording (interpretation_rules) and active library actions (development_actions). */
const { camel } = require('../db/naming');

const R = (d) => camel(d, 'ruleId');

/** All APPROVED wording of a question set and locale (one query; the report renderer picks per domain and layer). */
async function approvedRules(tx, assessmentVersionId, locale = 'en') {
  return (await tx.c.interpretation_rules.find({ assessment_version_id: assessmentVersionId, locale, status: 'APPROVED' }, { sort: { domain_code: 1, layer: 1, version: 1 } })).map(R);
}

/** ACTIVE Foundation actions of a domain, excluding held-interpretation ones (never auto-targeted). */
async function activeActions(tx, domainCode, { limit = 3 } = {}) {
  const rows = await tx.c.development_actions.find({ domain_code: domainCode, active: true, progression_level: 'Foundation' }, { sort: { action_code: 1 } });
  return rows.filter((a) => !/REPORTING HOLD/i.test(a.evidence_status)).slice(0, limit)
    .map((a) => ({ code: a.action_code, version: a.library_version, subdomainCode: a.subdomain_code, text: a.action_text }));
}

module.exports = { approvedRules, activeActions };
