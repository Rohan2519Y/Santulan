/*
 * Fixtures for HTTP contract tests on MongoDB (feature 006). The API opens its own connection through the store, so fixtures are
 * COMMITTED to the SCRATCH database (never `santulan`) with the migrator credential, use the reserved prefixes STN-FX / FX-, and
 * are removed by cleanupFixtures() through the migrator (the runtime credential can never remove). Tokens are minted like the
 * server would after sign-in.
 */
const { randomUUID } = require('crypto');
const H = require('./mongoHarness');
const F = require('./fixtures');
const { signToken } = require('../../../src/middleware/auth');

const u = () => randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const fxSantulanId = () => {
  let s = 'STN-FX';
  const b = require('crypto').randomBytes(18);
  for (let i = 0; i < 18; i += 1) s += CROCKFORD[b[i] & 31];
  return s;
};

const insert = async (coll, doc) => { const db = await H.admin(); await db.collection(coll).insertOne(doc); return doc; };

const institution = async (status = 'ACTIVE') => (await insert('institutions', F.institution({ institution_code: `FX-T-${u()}`, status })))._id;
const cohort = async (institutionId, status = 'ACTIVE') => (await insert('cohorts', F.cohort(institutionId, { cohort_code: `FX-C-${u()}`, status })))._id;

async function admin(status = 'ACTIVE', role = 'SUPER_ADMIN') {
  const doc = await insert('admin_users', F.admin({ status, role, auth_provider: 'santulan-dev', auth_provider_subject_id: `FX-admin-${u()}` }));
  return { adminUserId: doc._id, token: signToken({ sub: doc._id, role: 'admin', adminUserId: doc._id }) };
}

const participantToken = (participantId) => signToken({ sub: participantId, role: 'participant', participantId });
const purposeToken = (purpose, claims) => signToken({ sub: 'x', purpose, ...claims }, '10m');

/** An ACTIVE OPEN participant with every required consent VERIFIED (or none, when consents = false). */
async function participant(age, { consents = true } = {}) {
  const p = await insert('participants', F.participant({ santulan_id: fxSantulanId(), age_years_at_registration: age }));
  if (consents) {
    const specs = p.is_minor ? [['PARENT_GUARDIAN_CONSENT', 'PARENT'], ['STUDENT_ASSENT', 'SELF']] : [['ADULT_SELF_CONSENT', 'SELF']];
    for (const [type, giver] of specs) {
      await insert('consents', F.verifiedConsent(p._id, { consent_type: type, giver_relationship: giver, protocol_version: 'TEST-PROTOCOL-1', verification_method: 'TEST_METHOD_A' }));
    }
  }
  return { participantId: p._id, santulanId: p.santulan_id, token: participantToken(p._id) };
}

/** Records an operational control-plane event (append-only; the latest one decides). */
const controlEvent = async (state) => insert('audit_logs', F.audit({ action_type: 'PARTICIPATION_CONTROL', target_entity: 'participation', new_state: { state }, occurred_at: new Date() }));

/** Removes every fixture participant and the rows that hang off them, plus tracked institutions/admins, as the migrator. */
async function cleanupFixtures() {
  const db = await H.admin();
  const mine = (await db.collection('participants').find({ santulan_id: /^STN-FX/ }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  const attempts = (await db.collection('assessment_attempts').find({ participant_id: { $in: mine } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  const reports = (await db.collection('reports').find({ participant_id: { $in: mine } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  const plans = (await db.collection('growth_plans').find({ participant_id: { $in: mine } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  const priorities = (await db.collection('growth_priorities').find({ plan_id: { $in: plans } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  const goals = (await db.collection('growth_goals').find({ priority_id: { $in: priorities } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  const decisions = (await db.collection('pathway_decisions').find({ participant_id: { $in: mine } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  const del = (coll, filter) => db.collection(coll).deleteMany(filter);
  await del('growth_reviews', { goal_id: { $in: goals } });
  await del('growth_actions', { goal_id: { $in: goals } });
  await del('growth_goals', { priority_id: { $in: priorities } });
  await del('growth_priorities', { plan_id: { $in: plans } });
  await del('growth_plans', { participant_id: { $in: mine } });
  await del('pathway_reviews', { pathway_decision_id: { $in: decisions } });
  await del('pathway_decisions', { participant_id: { $in: mine } });
  await del('report_sections', { report_id: { $in: reports } });
  await del('reports', { participant_id: { $in: mine } });
  await del('interpretation_rules', { version: 'test-content-v1' });
  await db.collection('development_actions').updateMany({ active: true }, { $set: { active: false } });
  await del('score_results', { attempt_id: { $in: attempts } });
  await del('quality_flags', { attempt_id: { $in: attempts } });
  await del('responses', { attempt_id: { $in: attempts } });
  await del('response_events', { attempt_id: { $in: attempts } });
  await del('assessment_attempts', { participant_id: { $in: mine } });
  await del('consents', { participant_id: { $in: mine } });
  await del('participant_profiles', { participant_id: { $in: mine } });
  await del('participants', { _id: { $in: mine } });
  await del('audit_logs', { action_type: { $in: ['PARTICIPATION_CONTROL', 'PARTICIPANT_PROFILE_SUBMITTED'] } });
  // question sets created by tests carry the label prefix fx- (and their questions, wording and audit rows)
  const setIds = (await db.collection('assessment_versions').find({ version_label: /^fx-/ }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  await del('items', { assessment_version_id: { $in: setIds } });
  await del('interpretation_rules', { assessment_version_id: { $in: setIds } });
  await del('assessment_versions', { _id: { $in: setIds } });
  await del('audit_logs', { action_type: { $regex: '^(QUESTION_SET_|RELEASE_FLAG_)' } });
}

/** Direct (migrator) access to the scratch database for assertions. */
const db = () => H.admin();

/**
 * Publishes a question set for a test: uploads a valid workbook (7 domains x perDomain questions), freezes it and opens it for the
 * age group, after closing any other open set of that group. optionCounts[i] gives question i's option count (default 5).
 * Returns { setId, label, items: [{ itemId, itemCode, order, domainCode, optionCount }] }. Cleanup removes the fx- set.
 */
async function openSet({ ageGroup = 'ADOLESCENT', perDomain = 1, optionCounts = [], open = true } = {}) {
  const W = require('./questionWorkbook');
  const service = require('../../../src/services/questionsets/questionSetService');
  const a = await admin();
  const actor = { adminUserId: a.adminUserId };
  const label = `fx-set-${u().toLowerCase()}`;
  const rows = W.validRows({ label, perDomain, ageGroup });
  rows.forEach((r, i) => {
    const n = optionCounts[i] || 5;
    r.options = n === 5 ? W.STANDARD : Array.from({ length: n }, (_, k) => `Choice ${k + 1}`);
  });
  const db = await H.admin();
  await db.collection('assessment_versions').updateMany({ configuration: ageGroup, participation_state: 'OPEN' }, { $set: { participation_state: 'CLOSED' } });
  const up = await service.upload({ buffer: W.workbook(rows), fileName: 'q.xlsx', ageGroup, actor });
  await service.freeze(actor, up.body.setId);
  if (open) await service.open(actor, up.body.setId, 'test fixture');
  const items = (await db.collection('items').find({ assessment_version_id: up.body.setId }).sort({ display_order: 1 }).toArray())
    .map((i) => ({ itemId: i._id, itemCode: i.item_code, order: i.display_order, domainCode: i.domain_code, optionCount: i.options.length }));
  return { setId: up.body.setId, label, items, adminToken: a.token };
}

/** Closes every open fixture set (restores the scratch database to "nothing open"). */
const closeOpenSets = async () => (await H.admin()).collection('assessment_versions').updateMany({ participation_state: 'OPEN' }, { $set: { participation_state: 'CLOSED' } });

/** Answers every question of the attempt's set with `value(item)` (a position, or null to skip). Inserts as the migrator. */
async function answerAll(attemptId, value = () => '3') {
  const db = await H.admin();
  const att = await db.collection('assessment_attempts').findOne({ _id: attemptId });
  const items = await db.collection('items').find({ assessment_version_id: att.assessment_version_id }).sort({ display_order: 1 }).toArray();
  const docs = [];
  for (const it of items) {
    const v = value({ itemId: it._id, itemCode: it.item_code, domainCode: it.domain_code, order: it.display_order, optionCount: it.options.length });
    if (v === null || v === undefined) continue;
    docs.push(F.response(attemptId, it._id, { response_value: String(v), idempotency_key: `fx-${attemptId}-${it._id}` }));
  }
  if (docs.length) await db.collection('responses').insertMany(docs);
  return docs.length;
}

module.exports = { openSet, closeOpenSets, answerAll, db, insert, institution, cohort, admin, participantToken, purposeToken, u, participant, controlEvent, cleanupFixtures, fxSantulanId };
