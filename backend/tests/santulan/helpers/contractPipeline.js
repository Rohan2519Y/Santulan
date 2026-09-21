/*
 * Shared setup for the BUILD 07 HTTP suites (reports, growth plans, pathways) on MongoDB. They go through the real app and the runtime
 * credential on the SCRATCH database and COMMIT their rows (cleaned by committed.cleanupFixtures). A "scored attempt" is a submitted
 * attempt (fixture answers) that the real quality + scoring services then process; S2 evidence needs the audited pilotS2 switch,
 * exactly as production would.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const config = require('../../../src/config');
const app = require('../../../src/app');
const f = require('./committed');
const F = require('./fixtures');
const H = require('./mongoHarness');
const P = require('./pipeline');
const reportService = require('../../../src/modules/santulan/reporting/reportService');

const DOMAINS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
const INTERNAL = { 'X-Internal-Api-Key': 'test-internal-key' };
const CONTENT_VERSION = 'test-content-v1';
const ZERO_ID = '00000000-0000-4000-8000-000000000000';
const api = () => request(app);
const key = (tag) => `${tag}-${f.u()}-${f.u()}`;
const asToken = (who, method, p, body) => api()[method](`/api/v1${p}`).set({ Authorization: `Bearer ${who.token}` }).send(body);
const post = (p, who, body = {}) => asToken(who, 'post', p, body);
const get = (p, who) => api().get(`/api/v1${p}`).set({ Authorization: `Bearer ${who.token}` });
const internal = (method, p, body) => api()[method](`/api/v1${p}`).set(INTERNAL).send(body);

let set = null;
let switchAdmin = null;
const currentSet = () => set;

/** Opens a fresh adolescent question set (2 questions per domain) for the suite. */
async function openAdolescentSet() {
  set = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 2 });
  switchAdmin = await f.admin();
  return set;
}

const setSwitch = (flag, value) => P.setSwitch(flag, value, switchAdmin.adminUserId);
/** The same change as a Super Admin makes it: POST /admin/release-flags/{flag} (audited, takes effect at once). */
const flipViaApi = (flag, value, reason = 'test release switch change') => post(`/admin/release-flags/${flag}`, switchAdmin, { value, reason });

/** Turns every release switch OFF again (the default) - call from afterEach / afterAll. */
async function resetSwitches() {
  if (!switchAdmin) return;
  for (const flag of ['pilotS2', 'advancedEvidence', 'developmentRelease', 'pathwayRelease']) await setSwitch(flag, false);
}

/**
 * A participant with a SCORED attempt. s2: true scores the usable domains at S2 (the audited pilotS2 switch is ON while scoring);
 * the default is S1 (research only), the fail-closed default. hold: domains held (SH); evidence: { domain: 'SH' | 'S1' } from the governed file.
 * value(item) -> position | null.
 */
async function scoredAttempt({ s2 = false, value = () => 3, age = 15, hold = [], evidence = {} } = {}) {
  const a = await P.submittedAttempt(set, { age, value });
  await setSwitch('pilotS2', s2);
  let file = null;
  const configured = { ...Object.fromEntries(hold.map((d) => [d, 'SH'])), ...evidence }; // the governed file can hold (SH) or pin (S1); it can never promote to S2
  if (Object.keys(configured).length) {
    file = path.join(os.tmpdir(), `santulan-${f.u()}-evidence.json`);
    fs.writeFileSync(file, JSON.stringify({ [set.setId]: configured }));
    config.evidenceConfigPath = file;
  }
  let r;
  try { r = await P.runPipeline(a.attemptId); } finally {
    config.evidenceConfigPath = '';
    if (file) fs.rmSync(file, { force: true });
    await setSwitch('pilotS2', false);
  }
  if (!r.score) throw new Error(`not scored: ${JSON.stringify(r)}`);
  return { p: { participantId: a.participantId, token: a.token }, id: a.attemptId };
}

/** A SUBMITTED attempt moved to QUALITY_HOLD (a plain hold, or a Q09 flag) or INVALID, with no score. */
async function terminalAttempt(kind, { q09 = false } = {}) {
  const a = await P.submittedAttempt(set, { value: () => 3 });
  const db = await H.admin();
  await db.collection('assessment_attempts').updateOne({ _id: a.attemptId }, { $set: { status: kind } });
  if (q09) await db.collection('quality_flags').insertOne(F.qualityFlag(a.attemptId, { flag_code: 'Q09', severity: 'CRITICAL', domain_code: null }));
  return { p: { participantId: a.participantId, token: a.token }, id: a.attemptId };
}

/** Approved interpretation wording for the open set. rule: { domain, state = 'S2', band = null, layer, text }. */
async function approveRules(rules) {
  const db = await H.admin();
  const docs = rules.map((r) => F.rule(set.setId, {
    domain_code: r.domain, layer: r.layer, evidence_state: r.state || 'S2', developmental_band: r.band || null, status: 'APPROVED', version: CONTENT_VERSION,
    rule_code: `${r.layer}.${r.domain}.${r.state || 'S2'}.${r.band || 'ANY'}.${f.u()}`, approved_text_template: r.text,
  }));
  if (docs.length) await db.collection('interpretation_rules').insertMany(docs);
}
const clearRules = async () => (await H.admin()).collection('interpretation_rules').deleteMany({ version: CONTENT_VERSION });

/** Marks a domain's library actions ACTIVE (cleanup restores inactive) and returns them in the read-model shape. */
async function activateActions(domain) {
  const db = await H.admin();
  await db.collection('development_actions').updateMany({ domain_code: domain }, { $set: { active: true } });
  return (await db.collection('development_actions').find({ domain_code: domain }).sort({ action_code: 1 }).toArray())
    .map((a) => ({ action_code: a.action_code, library_version: a.library_version, subdomain_code: a.subdomain_code, action_text: a.action_text, control_flags: a.control_flags || {}, evidence_status: a.evidence_status }));
}

/** Generates the report through the internal endpoint. */
const generate = (attemptId) => internal('post', `/internal/attempts/${attemptId}/report`, {});

const growthPlanOf = async (attemptId) => (await H.admin()).collection('growth_plans').findOne({ source_attempt_id: attemptId });
const attemptStatus = async (id) => (await P.attemptOf(id)).status;

module.exports = {
  f, F, H, P, DOMAINS, INTERNAL, CONTENT_VERSION, ZERO_ID, api, key, post, get, internal, asToken, openAdolescentSet, currentSet, setSwitch, flipViaApi, resetSwitches,
  scoredAttempt, terminalAttempt, approveRules, clearRules, activateActions, generate, growthPlanOf, attemptStatus, reportService,
};
