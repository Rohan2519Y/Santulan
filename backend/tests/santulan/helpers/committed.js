/*
 * Fixtures for HTTP contract tests, which cannot use the rolled-back harness (the API opens its own connections).
 * They COMMIT to the scratch database (never the dev database) using unique values, and mint tokens like the
 * server would after sign-in. Rows are never deleted (the schema forbids it); the scratch DB is disposable.
 */
const { randomUUID } = require('crypto');
const { Client } = require('pg');
const { signToken } = require('../../../src/shared/middleware/auth');

const OWNER_URL = process.env.DATABASE_URL;

async function owner(fn) {
  if (!/(test|qual|scratch)/.test(new URL(OWNER_URL).pathname)) throw new Error('refusing to write committed fixtures outside a scratch database');
  const client = new Client({ connectionString: OWNER_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const u = () => randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();

const institution = (status = 'ACTIVE') => owner(async (c) => (await c.query(
  `INSERT INTO santulan.institutions (institution_code, institution_name, institution_type, status) VALUES ($1,'Test School','SCHOOL',$2) RETURNING institution_id`,
  [`T-${u()}`, status])).rows[0].institution_id);

const cohort = (institutionId, status = 'ACTIVE') => owner(async (c) => (await c.query(
  `INSERT INTO santulan.cohorts (institution_id, cohort_code, cohort_name, status) VALUES ($1,$2,'Test Cohort',$3) RETURNING cohort_id`,
  [institutionId, `C-${u()}`, status])).rows[0].cohort_id);

async function admin(status = 'ACTIVE', role = 'SUPER_ADMIN') {
  const id = await owner(async (c) => (await c.query(
    `INSERT INTO santulan.admin_users (role, auth_provider, auth_provider_subject_id, status) VALUES ($1,'santulan-dev',$2,$3) RETURNING admin_user_id`,
    [role, `admin-${u()}`, status])).rows[0].admin_user_id);
  return { adminUserId: id, token: signToken({ sub: id, role: 'admin', adminUserId: id }) };
}

const participantToken = (participantId) => signToken({ sub: participantId, role: 'participant', participantId });
const purposeToken = (purpose, claims) => signToken({ sub: 'x', purpose, ...claims }, '10m');

/**
 * Delivery fixtures. The catalog reconcile/freeze suites need the scratch versions DRAFT/CLOSED, so a delivery suite opens a
 * version for its duration and MUST restore it in afterAll (the restore bypasses the frozen-content triggers as the owner).
 * If a run is killed before afterAll, rebuild the scratch database: node scripts/santulan-scratch-db.js
 */
// Delivery fixtures use their own Santulan ID prefix so they never collide with the rolled-back STN-TEST rows of the database suite.
const FIXTURE_PREFIX = 'STN-FX';

/** Removes every delivery fixture (attempts, answers, events, consents, participants) - as the owner, bypassing the append-only triggers. */
const cleanupFixtures = () => owner(async (c) => {
  await c.query("SET session_replication_role = 'replica'");
  const mine = "(SELECT participant_id FROM santulan.participants WHERE santulan_id LIKE 'STN-FX%')";
  const attempts = `(SELECT attempt_id FROM santulan.assessment_attempts WHERE participant_id IN ${mine})`;
  await c.query(`DELETE FROM santulan.score_results WHERE attempt_id IN ${attempts}`);
  await c.query(`DELETE FROM santulan.quality_flags WHERE attempt_id IN ${attempts}`);
  await c.query(`DELETE FROM santulan.responses WHERE attempt_id IN ${attempts}`);
  await c.query(`DELETE FROM santulan.response_events WHERE attempt_id IN ${attempts}`);
  await c.query(`DELETE FROM santulan.assessment_attempts WHERE participant_id IN ${mine}`);
  await c.query(`DELETE FROM santulan.consents WHERE participant_id IN ${mine}`);
  await c.query("DELETE FROM santulan.participants WHERE santulan_id LIKE 'STN-FX%'");
});

/** Answers every item of the attempt's version in one statement (the attempt must be IN_PROGRESS). value(itemRow) -> '1'..'5' | null. */
const answerAll = (attemptId, value = () => '3') => owner(async (c) => {
  const items = (await c.query(`SELECT i.item_id, i.item_code, i.domain_code, i.display_order FROM santulan.items i
                                  JOIN santulan.assessment_attempts a USING (assessment_version_id) WHERE a.attempt_id = $1 ORDER BY i.display_order`, [attemptId])).rows;
  const picked = items.map((it) => ({ it, v: value(it) })).filter((x) => x.v !== null && x.v !== undefined);
  await c.query(
    `INSERT INTO santulan.responses (attempt_id, item_id, response_value, response_version, is_current, idempotency_key)
     SELECT $1::uuid, x.item_id, x.val, 1, true, 'fx-' || $3::text || '-' || x.item_id::text FROM unnest($2::uuid[], $4::text[]) AS x(item_id, val)`,
    [attemptId, picked.map((x) => x.it.item_id), attemptId, picked.map((x) => String(x.v))]);
  return picked.length;
});

const openVersion = (label) => owner(async (c) => {
  await c.query("UPDATE santulan.response_scales SET status = 'FROZEN', frozen_at = now() WHERE status = 'DRAFT'");
  await c.query("UPDATE santulan.assessment_versions SET status = 'FROZEN', frozen_at = now() WHERE version_label = $1 AND status = 'DRAFT'", [label]);
  await c.query("UPDATE santulan.assessment_versions SET participation_state = 'OPEN' WHERE version_label = $1", [label]);
});
const restoreVersions = () => owner(async (c) => {
  await c.query("SET session_replication_role = 'replica'");
  await c.query("UPDATE santulan.assessment_versions SET participation_state = 'CLOSED', status = 'DRAFT', frozen_at = NULL");
  await c.query("UPDATE santulan.response_scales SET status = 'DRAFT', frozen_at = NULL");
});

/** An ACTIVE OPEN participant with every required consent VERIFIED (or none, when consents = false). */
async function participant(age, { consents = true } = {}) {
  return owner(async (c) => {
    const santulanId = `${FIXTURE_PREFIX}${u()}${u()}`.slice(0, 24);
    const p = (await c.query(
      `INSERT INTO santulan.participants (santulan_id, participation_route, age_years_at_registration) VALUES ($1,'OPEN',$2) RETURNING participant_id, is_minor`, [santulanId, age])).rows[0];
    if (consents) {
      const specs = p.is_minor ? [['PARENT_GUARDIAN_CONSENT', 'PARENT'], ['STUDENT_ASSENT', 'SELF']] : [['ADULT_SELF_CONSENT', 'SELF']];
      for (const [type, giver] of specs) {
        const id = (await c.query(`INSERT INTO santulan.consents (participant_id, consent_type, giver_relationship, protocol_version) VALUES ($1,$2,$3,'TEST-PROTOCOL-1') RETURNING consent_id`, [p.participant_id, type, giver])).rows[0].consent_id;
        await c.query("UPDATE santulan.consents SET status = 'GRANTED', granted_at = now() WHERE consent_id = $1", [id]);
        await c.query("UPDATE santulan.consents SET status = 'VERIFIED', verified_at = now(), verification_method = 'TEST_METHOD_A' WHERE consent_id = $1", [id]);
      }
    }
    return { participantId: p.participant_id, santulanId, token: participantToken(p.participant_id) };
  });
}

/** Records an operational control-plane event (append-only; the latest one decides). */
const controlEvent = (state) => owner((c) => c.query(
  `INSERT INTO santulan.audit_logs (actor_type, action_type, target_entity, new_state, occurred_at) VALUES ('SYSTEM','PARTICIPATION_CONTROL','participation',$1::jsonb, clock_timestamp())`, [JSON.stringify({ state })]));

const query = (sql, params) => owner(async (c) => (await c.query(sql, params)).rows);

module.exports = { owner, institution, cohort, admin, participantToken, purposeToken, query, u, openVersion, restoreVersions, participant, controlEvent, cleanupFixtures, answerAll };
