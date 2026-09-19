# Database Contract: v3.1 Canonical Alignment (005)

**Branch**: `005-v3-1-canonical-alignment` | **Date**: 2026-09-19 | **Data model**: [../data-model.md](../data-model.md) | **Research**: [../research.md](../research.md)

What the migrations must produce and how the application talks to them. Column-level definitions are in BUILD 01 §6; this contract fixes the **file plan, roles, context, RLS matrix, privileges and verification queries**.

## 1. Migration plan (existing runner, forward-only)

| File | Contents | BUILD 01 source | Check |
|------|----------|-----------------|-------|
| `008_santulan_roles_extensions_types.sql` | `pgcrypto`; `CREATE SCHEMA santulan`; enums; `resolve_*`/`valid_*` functions; `ctx_*()` context functions; role-existence guard (roles created by `docker/init-app-role.sql`) | 000, 001 | enum + function inventory |
| `009_santulan_core_identity_org.sql` | `institutions`, `cohorts`, `admin_users`, `participants`, `participant_cohort_history`, `consents` | 002 | 6 tables |
| `010_santulan_assessment_content.sql` | `response_scales`, `assessment_versions`, `items`, `interpretation_rules`, `development_actions`, `reflection_prompts` | 003 | +6 |
| `011_santulan_assessment_delivery.sql` | `assessment_attempts`, `responses`, `response_events` | 004 | +3 |
| `012_santulan_quality_scoring_reporting.sql` | `quality_flags`, `score_results`, `reports`, `report_sections` | 005 | +4 |
| `013_santulan_growth_pathways.sql` | 5 growth tables, 2 pathway tables | 006 | +7 |
| `014_santulan_research_audit.sql` | `research_exports`, `audit_logs` | 007 | **28 total** |
| `015_santulan_constraints_triggers_functions.sql` | state machines, provenance, immutability, `save_response`, `begin_or_resume_session`, `pause_session`, `submit_attempt(uuid,text)`, release gates | 008 | trigger + function inventory |
| `016_santulan_indexes.sql` | the 29 indexes listed in BUILD 01 §8 — **no additions** | 009 | index inventory |
| `017_santulan_rls.sql` | `ENABLE` + `FORCE` RLS and the §9 policies | 010, BUILD 09 | policy inventory + negative tests |
| `018_santulan_seed_reference_content.sql` | scale, 2 versions, 346 items, 216 actions, 72 prompts, fail-closed | 011 | counts + states |
| `019_santulan_build03_controls.sql` | `participant_open_scope_ck`, `uq_participant_institution_external_id` (auth-pair unique index only if not identical to `uq_participants_auth_subject`), `build03_resolve_registration`, `build03_assert_catalog_route` | BUILD 03 030 | 28 tables |
| `020_santulan_build04_controls.sql` | `consent_verified_method_ck`, `consent_protocol_nonblank_ck`, `uq_consent_active_type_protocol`, `build04_consent_gate`, strengthened `validate_consent_row()` | BUILD 04 040 | 28 tables |
| `021_santulan_build05_controls.sql` | `response_idempotency_nonblank_ck`, `uq_submit_idempotency`, event-session trigger, payload-bound `save_response`, `submit_attempt(uuid,text)`, **drop** legacy `submit_attempt(uuid)`, `participation_control_state()` (R-18) | BUILD 05 050/051 | 28 tables |
| `022_santulan_build06_controls.sql` | quality uniqueness/immutability, score immutability, quality-before-scoring, Q06 detector, `score_attempt`, research-only subdomain view | BUILD 06 060 | 28 tables |
| `023_santulan_build07_controls.sql` | report immutability + begin/complete/fail/retry functions, participant release view, priority/pathway guards, `build07_fire_p5` | BUILD 07 070 | 28 tables |
| `024_santulan_build08_controls.sql` | pilot admin-role trigger, response/audit mutation triggers, research-safe views, export lifecycle + download-audit functions, admin audit helper | BUILD 08 080 | 28 tables |

`013` freeze template and `014` smoke tests from BUILD 01 are **scripts**, not migrations: `scripts/santulan-freeze.js` (fails without a signed response-scale approval hash) and `tests/santulan/database/smoke.test.js`. `DEV_ONLY_RESET.sql` is never created in this repo's migration path.

**Rules**: never edit an applied file; a fix is a new number. Each file carries a header comment with its contract sections and a `-- ASSUMED (D-11)` marker for any value the contract does not list. After each file the table count of `santulan` is asserted by the test suite (`= 28` from `014` on).

## 2. Roles and privileges

| Role | Login | Attributes | Purpose |
|------|-------|-----------|---------|
| owner (`postgres` in dev) | yes | table owner | runs migrations only |
| `app_runtime` | yes | `NOSUPERUSER NOBYPASSRLS`, not owner | web API connection; member of `santulan_worker` |
| `santulan_worker` | no | `NOBYPASSRLS` | controlled write paths via `SET LOCAL ROLE`; `EXECUTE` on the four delivery procedures and the privileged functions |
| `app_platform` (legacy) | yes | `BYPASSRLS` | **must never** be granted any privilege on `santulan.*` |

- `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA santulan FROM PUBLIC`; explicit `GRANT EXECUTE` per function to `santulan_worker` (and to `app_runtime` only for read-only helpers).
- `app_runtime` gets `SELECT` on content tables and on RLS-scoped tables; **no** direct `INSERT/UPDATE/DELETE` on `consents`, `participants`, `score_results`, `report_sections`, `audit_logs`, `responses` (writes go through the functions).
- `app_runtime` has `SELECT` only on `audit_logs` via policy for admin contexts; `INSERT` via the audit helper.

## 3. Transaction context

Every request that touches `santulan.*` runs inside one transaction that begins with:

```sql
SELECT set_config('app.actor_scope',   $1, true);   -- PARTICIPANT | INSTITUTION_ADMIN | RESEARCH_OPERATOR | SUPER_ADMIN | SYSTEM
SELECT set_config('app.participant_id', $2, true);  -- uuid or ''
SELECT set_config('app.admin_user_id',  $3, true);  -- uuid or ''
SELECT set_config('app.institution_id', $4, true);  -- uuid or ''
-- controlled writes additionally:  SET LOCAL ROLE santulan_worker;
```

Values come from the verified JWT and a server-side lookup, never from the client. `santulan.ctx_actor_scope()`, `ctx_participant_id()`, `ctx_admin_user_id()`, `ctx_institution_id()` read them with `NULLIF(current_setting(name, true), '')` so an absent value is `NULL` and every policy comparison with `NULL` is false ⇒ **no context ⇒ deny**. Because the settings are `LOCAL`, they cannot survive to the next pooled use of the connection (SEC-11).

## 4. RLS matrix (BUILD 01 §9, BUILD 09 §6)

| Context | Institution A rows | Institution B rows | OPEN (NULL institution) rows | Privileged tables |
|---------|--------------------|--------------------|------------------------------|-------------------|
| `PARTICIPANT` (own id) | own rows only | deny | own OPEN record only | deny (`admin_users`, `research_exports`, `audit_logs`) |
| `INSTITUTION_ADMIN` A *(inactive in pilot; policies exist)* | allow A | deny | **deny** | deny |
| `SUPER_ADMIN` | allow | allow | allow | allow |
| `SYSTEM` (worker) | controlled | controlled | controlled | controlled |
| none | deny | deny | deny | deny |

Additional read rules: S1 (and S0/SH) `score_results` are not participant-readable; participants read `reports` only when `REPORT_READY` (or T11/T12) and `report_sections` only when `is_released_to_participant`; draft `interpretation_rules`, inactive `development_actions` and draft `reflection_prompts` are hidden from participants; `quality_flags` are admin-only, with institution-admin access joined `attempt → participant → institution` on equality with the **non-NULL** context institution.

Policy names follow BUILD 01 §9 (`p_<table>_read`, `p_<table>_write`, `p_reference_write_*`, `p_quality_admin`, `p_audit_logs_admin`, `p_audit_logs_insert`, …). All protected tables are `FORCE ROW LEVEL SECURITY`.

## 5. Immutability and provenance guards (must exist and be tested)

| Guard | Protects | Test IDs |
|-------|----------|----------|
| Frozen-content trigger | `assessment_versions`, `response_scales`, `items` after `FROZEN` | B05-034, T-B02-011 |
| Response mutation trigger | `UPDATE`/`DELETE` of `responses` content, every role | B05-017/018, B08-054/055 |
| Audit mutation trigger | `UPDATE`/`DELETE` of `audit_logs` | B08-006 |
| Score immutability | `score_results` | B06-023 |
| Report snapshot trigger | all `report_sections` columns except `is_released_to_participant` | B07-019 |
| Quality-facts trigger | detection fields of `quality_flags` | B06-003/004 |
| Attempt-create trigger | consent gate, ACTIVE participant, version/scale `FROZEN`, `OPEN`, age/track | T03-017…020, T04-029/030 |
| Provenance triggers | score, report, growth plan, pathway participant/version must equal the source attempt's | B06-019 |
| Pilot admin-role trigger | ACTIVE ⇒ `SUPER_ADMIN` | B08-009/010 |

## 6. Verification queries (run by the suite and by the restore drill)

```sql
-- exactly 28 base tables
SELECT count(*) FROM information_schema.tables
 WHERE table_schema = 'santulan' AND table_type = 'BASE TABLE';            -- 28

-- fail-closed release defaults
SELECT version_label, status, participation_state FROM santulan.assessment_versions ORDER BY 1;  -- DRAFT / CLOSED ×2
SELECT count(*) FROM santulan.development_actions WHERE active;                                  -- 0
SELECT count(*) FROM santulan.interpretation_rules;                                              -- 0

-- catalog facts
SELECT v.version_label, count(*) AS items, count(DISTINCT i.subdomain_code) AS subdomains
  FROM santulan.items i JOIN santulan.assessment_versions v USING (assessment_version_id)
 GROUP BY 1;                                                               -- 175/72 and 171/72
SELECT count(*) FROM santulan.items WHERE subdomain_code = 'C4.6';         -- 0

-- RLS forced on protected tables
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'santulan' AND c.relkind = 'r' AND NOT c.relforcerowsecurity
   AND relname IN ('participants','consents','assessment_attempts','responses','score_results','reports');  -- 0 rows

-- runtime role safety
SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_runtime';                       -- f, f
```

## 7. Change control

Any added column, table, index or enum value beyond the contract needs the user's approval (strict-per-docs rule) and a numbered forward migration with test impact noted. The legacy schemas are not modified by any file above.
