/*
 * Harness for the canonical-schema tests (specs/005-v3-1-canonical-alignment).
 * Every test runs inside BEGIN ... ROLLBACK on ONE owner connection, so no data is ever left behind.
 * It refuses to run unless the database name contains test|qual|scratch (never the shared dev database).
 * Fixtures are built as the owner (a superuser bypasses RLS - right for seeding); isolation assertions switch to a
 * restricted role with SET LOCAL ROLE, because a superuser would pass every isolation test trivially.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { randomUUID } = require('crypto');
const { Client } = require('pg');

const DB_URL = process.env.SANTULAN_TEST_DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/santulan_qual';
const ALLOWED_ROLES = new Set(['app_runtime', 'santulan_worker']);

function assertScratch() {
  const name = new URL(DB_URL).pathname.replace('/', '');
  if (!/(test|qual|scratch)/.test(name)) {
    throw new Error(`refusing to run canonical tests against database "${name}" (must contain test|qual|scratch)`);
  }
}

const uniq = () => randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();

function buildTx(client) {
  const tx = {
    client,
    exec: (sql, params) => client.query(sql, params),
    q: async (sql, params) => (await client.query(sql, params)).rows,
    one: async (sql, params) => (await client.query(sql, params)).rows[0],
    async asRole(name) {
      if (!ALLOWED_ROLES.has(name)) throw new Error(`unsupported role ${name}`);
      await client.query(`SET LOCAL ROLE ${name}`);
    },
    asOwner: () => client.query('RESET ROLE'),
    /** Sets the trusted transaction context exactly like the server middleware would. */
    async ctx({ scope = '', participantId = '', adminUserId = '', institutionId = '' } = {}) {
      await client.query(
        `SELECT set_config('app.actor_scope', $1, true), set_config('app.participant_id', $2, true),
                set_config('app.admin_user_id', $3, true), set_config('app.institution_id', $4, true)`,
        [scope, participantId, adminUserId, institutionId],
      );
    },
    /** Asserts the statement is refused with the SQLSTATE (runs in a savepoint so one test can assert several refusals). */
    async refused(sql, params, sqlstate) {
      await client.query('SAVEPOINT refused_sp');
      let failure = null;
      try {
        await client.query(sql, params);
      } catch (err) {
        failure = err;
      }
      await client.query('ROLLBACK TO SAVEPOINT refused_sp');
      await client.query('RELEASE SAVEPOINT refused_sp');
      if (!failure) throw new Error(`expected refusal (${sqlstate}) but statement succeeded: ${sql.slice(0, 90)}`);
      if (sqlstate && failure.code !== sqlstate) {
        throw new Error(`expected SQLSTATE ${sqlstate}, got ${failure.code}: ${failure.message}`);
      }
      return failure;
    },

    // ------------------------------------------------------------ fixtures (owner)
    async institution(type = 'SCHOOL') {
      return tx.one(`INSERT INTO santulan.institutions (institution_code, institution_name, institution_type)
                     VALUES ($1, $2, $3) RETURNING *`, [`INST-${uniq()}`, 'Test Institution', type]);
    },
    async cohort(institutionId) {
      return tx.one(`INSERT INTO santulan.cohorts (institution_id, cohort_code, cohort_name)
                     VALUES ($1, $2, 'Test Cohort') RETURNING *`, [institutionId, `C-${uniq()}`]);
    },
    async participant({ age = 15, route = 'OPEN', institutionId = null, cohortId = null } = {}) {
      return tx.one(`INSERT INTO santulan.participants (santulan_id, participation_route, institution_id, cohort_id, age_years_at_registration)
                     VALUES ($1, $2, $3, $4, $5) RETURNING *`, [`STN-TEST${uniq()}`, route, institutionId, cohortId, age]);
    },
    /** PENDING -> GRANTED -> VERIFIED for every consent the participant needs. */
    async verifyConsents(participantId, minor) {
      const specs = minor
        ? [['PARENT_GUARDIAN_CONSENT', 'PARENT'], ['STUDENT_ASSENT', 'SELF']]
        : [['ADULT_SELF_CONSENT', 'SELF']];
      const ids = [];
      for (const [type, giver] of specs) {
        const c = await tx.one(`INSERT INTO santulan.consents (participant_id, consent_type, giver_relationship, protocol_version)
                                VALUES ($1, $2, $3, 'test-protocol-1') RETURNING consent_id`, [participantId, type, giver]);
        await tx.exec('UPDATE santulan.consents SET status = \'GRANTED\', granted_at = now() WHERE consent_id = $1', [c.consent_id]);
        await tx.exec(`UPDATE santulan.consents SET status = 'VERIFIED', verified_at = now(), verification_method = 'TEST_METHOD'
                        WHERE consent_id = $1`, [c.consent_id]);
        ids.push(c.consent_id);
      }
      return ids;
    },
    /** Freezes the scale and one version and opens participation (test-only, inside the rolled-back transaction). */
    async openVersion(label) {
      await tx.exec(`UPDATE santulan.response_scales SET status = 'FROZEN', frozen_at = now() WHERE status = 'DRAFT'`);
      await tx.exec(`UPDATE santulan.assessment_versions SET status = 'FROZEN', frozen_at = now() WHERE version_label = $1`, [label]);
      await tx.exec(`UPDATE santulan.assessment_versions SET participation_state = 'OPEN' WHERE version_label = $1`, [label]);
      return tx.one('SELECT * FROM santulan.assessment_versions WHERE version_label = $1', [label]);
    },
    async attempt(participantId, versionId, age) {
      return tx.one(`INSERT INTO santulan.assessment_attempts (participant_id, assessment_version_id, age_years_at_attempt)
                     VALUES ($1, $2, $3) RETURNING *`, [participantId, versionId, age]);
    },
    async item(versionLabel, order = 1) {
      return tx.one(`SELECT i.* FROM santulan.items i JOIN santulan.assessment_versions v USING (assessment_version_id)
                      WHERE v.version_label = $1 AND i.display_order = $2`, [versionLabel, order]);
    },
  };
  return tx;
}

/** Runs fn(tx) inside a transaction that is always rolled back. */
async function withTx(fn) {
  assertScratch();
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const tx = buildTx(client);
    await tx.ctx({ scope: 'SYSTEM' }); // default: trusted server context, so definer procedures accept the owner
    return await fn(tx);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

module.exports = { withTx, uniq };
