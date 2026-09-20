/*
 * Grants for the canonical `santulan` schema (BUILD 01 §7.1, BUILD 09 §4; contracts/database-contract.md §2).
 * Runs after scripts/migrate.js; idempotent.
 *
 *   app_runtime     web API connection: NOSUPERUSER NOBYPASSRLS, not the owner. Reads RLS-scoped tables and may write
 *                   only the participant-/admin-owned tables its policies allow. It has NO direct write access to
 *                   consents, participants, attempts, responses, scores, reports or audit reads - controlled writes
 *                   go through SET LOCAL ROLE santulan_worker.
 *   santulan_worker NOLOGIN: the controlled write path (registration, consent verification, delivery procedures,
 *                   scoring, reporting, exports). app_runtime may SET ROLE to it but does NOT inherit its privileges.
 *   app_platform    legacy BYPASSRLS login role: never granted anything on santulan.
 */
require('dotenv').config();
const { Client } = require('pg');

const RUNTIME_WRITE = [
  'institutions', 'cohorts', 'participant_cohort_history', 'admin_users', 'quality_flags', 'research_exports',
  'growth_plans', 'growth_priorities', 'growth_goals', 'growth_actions', 'growth_reviews', 'pathway_reviews',
];
const RUNTIME_FUNCTIONS = [
  'ctx_actor_scope()', 'ctx_participant_id()', 'ctx_admin_user_id()', 'ctx_institution_id()', 'ctx_is_privileged()',
  'own_participant(uuid)', 'can_read_participant(uuid)', 'can_read_attempt(uuid)', 'can_read_report(uuid)',
  'can_read_pathway(uuid)', 'participant_of_plan(uuid)', 'participant_of_priority(uuid)', 'participant_of_goal(uuid)',
  'participant_has_required_consent(uuid)', 'build04_consent_gate(uuid)', 'participation_control_state()', 'valid_domain_code(text)', 'valid_subdomain_code(text)',
  'subdomain_belongs_to_domain(text, text)', 'resolve_assessment_track(smallint)', 'resolve_developmental_band(smallint)',
];

async function roleExists(client, name) {
  return (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name])).rowCount > 0;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const schema = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'santulan'");
    if (!schema.rowCount) {
      console.log('Schema santulan not found; nothing to grant.'); // eslint-disable-line no-console
      return;
    }
    const hasRuntime = await roleExists(client, 'app_runtime');
    const hasWorker = await roleExists(client, 'santulan_worker');
    if (!hasWorker) throw new Error('role santulan_worker is missing (created by migration 008)');

    await client.query('GRANT USAGE ON SCHEMA santulan TO santulan_worker');
    await client.query('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA santulan TO santulan_worker');
    await client.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA santulan TO santulan_worker');

    if (hasRuntime) {
      await client.query('GRANT USAGE ON SCHEMA santulan TO app_runtime');
      await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA santulan TO app_runtime');
      // the research-only candidate subdomain view (BUILD 06 §12) is never reachable by the participant-facing runtime role
      if ((await client.query("SELECT to_regclass('santulan.v_candidate_subdomain_scores') AS v")).rows[0].v) await client.query('REVOKE ALL ON santulan.v_candidate_subdomain_scores FROM app_runtime');
      for (const t of RUNTIME_WRITE) await client.query(`GRANT INSERT, UPDATE ON santulan.${t} TO app_runtime`);
      await client.query('GRANT INSERT ON santulan.audit_logs TO app_runtime');
      for (const f of RUNTIME_FUNCTIONS) await client.query(`GRANT EXECUTE ON FUNCTION santulan.${f} TO app_runtime`);
      // SET ROLE is allowed, privileges are NOT inherited (least privilege).
      await client.query('GRANT santulan_worker TO app_runtime WITH INHERIT FALSE, SET TRUE');
    } else {
      console.warn('app_runtime role not found; create it (docker/init-app-role.sql).'); // eslint-disable-line no-console
    }

    if (await roleExists(client, 'app_platform')) {
      await client.query('REVOKE ALL ON SCHEMA santulan FROM app_platform');
      await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA santulan FROM app_platform');
    }
    console.log('Granted santulan privileges (app_runtime read/scoped-write, santulan_worker controlled writes).'); // eslint-disable-line no-console
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err); // eslint-disable-line no-console
  process.exitCode = 1;
});
