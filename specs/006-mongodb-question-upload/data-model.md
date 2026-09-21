# Data Model: MongoDB Canonical Model and Question Sets

**Feature**: 006-mongodb-question-upload | **Date**: 2026-09-20 | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

The canonical data model is the 28 entities of BUILD 01 §6 (constitution III), held in MongoDB, plus only the additions and one retirement listed in §9 (change record 006). Column-level detail of each entity is **unchanged** from feature 005's relational data model (`specs/005-v3-1-canonical-alignment/data-model.md`, `contracts/database-contract.md`); this document defines the **mapping**, the **deltas**, the **store-level rules** (validators, indexes, tiers) and the **application-enforced rules** MongoDB cannot express.

## 1. Conventions

| Topic | Rule |
|-------|------|
| Identifiers | `_id` is the entity's UUID as a **string** (so API ids, `zod.uuid()` checks and audit targets stay identical). Items use UUIDv5 over `assessment_version_id:item_code`, so a re-uploaded identical set yields identical ids. |
| Field names | Stored in **snake_case exactly as BUILD 01 columns**; the access layer returns camelCase to callers (as `shared/db.js` did). |
| Types | uuid → string (UUID); text → string; smallint/integer/bigint → `int`/`long`; numeric(4,2)/(5,4) → `double` rounded by the domain layer and range-checked by the validator; boolean → `bool`; timestamptz → `date`; date → `string` `YYYY-MM-DD`; jsonb → `object`; enum → `string` with `enum` in the validator. |
| Nullability | A nullable column is present with value `null` (never omitted), so partial-index filters (`$type`) and unique-with-null semantics behave predictably. |
| Undeclared fields | Refused by every validator (`additionalProperties:false`). |
| Validation | Each collection: `$and[ $jsonSchema, $expr… ]`, `validationLevel: strict`, `validationAction: error` (checked on insert **and** update). Set by data-model migrations only (migrator credential). |
| Deletion | No collection has a delete path for the runtime credential (research R-M04). Retirement is by status. |
| Time | Server clock (`new Date()` in the domain layer / `$$NOW`), never client-supplied. |

## 2. Entity → collection map

Tier: **A** append-only (`find`,`insert`) · **B** governed mutation (`find`,`insert`,`update`; the access layer exposes only the named mutation) · **V** read-only view.

| # | BUILD 01 entity | Collection | Tier | Permitted mutation (B) / note |
|---|-----------------|------------|------|--------------------------------|
| 1 | institutions | `institutions` | B | `status`, name/parent edits by Super Admin |
| 2 | cohorts | `cohorts` | B | `status`, edits |
| 3 | participants | `participants` | B | `status` (suspend/reactivate/withdraw); derived fields immutable |
| 4 | participant_cohort_history | `participant_cohort_history` | A | append only |
| 5 | consents | `consents` | B | state transitions per the consent machine |
| 6 | response_scales | — | — | **RETIRED by CR-006** (options are per question; see §9) |
| 7 | assessment_versions | `assessment_versions` | B | **the question set**: `status` DRAFT→FROZEN (+`frozen_at`, `content_hash`), `participation_state`; superseded revision → `RETIRED` |
| 8 | items | `items` | **A** | **questions with embedded `options`**; content never changes after insert |
| 9 | assessment_attempts | `assessment_attempts` | B | state machine, `session_count` (+1), timestamps, `lock_version` |
| 10 | responses | `responses` | B | `is_current` true→false only (D-M02) |
| 11 | response_events | `response_events` | **A** | append only |
| 12 | quality_flags | `quality_flags` | B | `disposition`, `reviewed_by/at`, `review_note` only |
| 13 | score_results | `score_results` | **A** | append only |
| 14 | interpretation_rules | `interpretation_rules` | B | governed content status |
| 15 | development_actions | `development_actions` | B | `active` |
| 16 | reflection_prompts | `reflection_prompts` | B | `status` |
| 17 | reports | `reports` | B | `generation_status`, `retry_count`, error fields, `generated_at` |
| 18 | report_sections | `report_sections` | B | `is_released_to_participant` only |
| 19 | growth_plans | `growth_plans` | B | `status`, `updated_at` |
| 20 | growth_priorities | `growth_priorities` | B | `participant_selected`, `priority_text` |
| 21 | growth_goals | `growth_goals` | B | goal fields, `status` |
| 22 | growth_actions | `growth_actions` | B | own text snapshot only |
| 23 | growth_reviews | `growth_reviews` | **A** | append only |
| 24 | pathway_decisions | `pathway_decisions` | **A** | append only (a route is superseded by a new decision) |
| 25 | pathway_reviews | `pathway_reviews` | **A** | append only |
| 26 | research_exports | `research_exports` | B | lifecycle state, `file_reference`, `completed_at` |
| 27 | admin_users | `admin_users` | B | `status` |
| 28 | audit_logs | `audit_logs` | **A** | append only |
| — | *(not canonical)* dev sign-in credentials | `dev_identity_credentials` | B | dev only, refuses production (research R-M16) |
| V | research-safe projections | `v_research_participants`, `v_research_attempts`, `v_research_item_responses`, `v_research_domain_scores`, `v_research_quality_flags`, `v_research_response_events`, `v_research_assessment_versions`, `v_research_cohorts`, and the research-only `v_candidate_subdomain_scores` | V | see §8 |

Counting rule for the constitution: **27 active entities + the retirement of `response_scales`**, all persisted as their own collections (no embedding of independent-lifecycle data). The only embedded child is `items.options` (an owned, immutable list — constitution III allows embedding an owned child with no independent lifecycle). The upload record is **not** a new collection: it is an `audit_logs` entry (D-M05).

## 3. Deltas from BUILD 01 (what actually differs)

### 3.1 `assessment_versions` — the question set

| Field | Type | Rule |
|-------|------|------|
| `_id` | string UUID | UUIDv5 over `version_label:revision` (deterministic) |
| `version_label` | string | pattern `^[a-z0-9][a-z0-9._-]{2,63}$`; from the sheet's `assessment_version` |
| **`revision`** | int ≥ 1 | **added (CR-006)**; increments when different content is uploaded under a DRAFT label |
| `configuration` | enum `ADOLESCENT` \| `EMERGING_ADULT` | the **age group** chosen at upload |
| `participant_min_age`, `participant_max_age` | int | validator `$expr`: adolescent ⇒ 13/17, emerging adult ⇒ 18/25 (BUILD 01 `assessment_configuration_age_ck`) |
| `content_hash` | string, 64 hex | SHA-256 of canonical JSON of the questions + options |
| `source_file_hash` | string, 64 hex | SHA-256 of the uploaded file bytes |
| `status` | enum `DRAFT` \| `FROZEN` \| `RETIRED` | `RETIRED` = superseded draft revision or retired set (no new enum value) |
| `participation_state` | enum `CLOSED` \| `OPEN` \| `PAUSED` \| `STOPPED` | default `CLOSED`; validator: `OPEN` requires `status = FROZEN` |
| `frozen_at` | date \| null | validator: `status = FROZEN` ⇒ set |
| ~~`response_scale_id`~~ | — | **removed (CR-006)** |

### 3.2 `items` — the question

BUILD 01 columns unchanged (`item_code`, `domain_code`, `subdomain_code`, `subdomain_name`, `item_text`, `keying`, `age_band`, `context`, `layer`, `pilot_status`, `display_order`, `status`, `item_content_hash`, `created_at`) **plus**:

| Field | Type | Rule |
|-------|------|------|
| **`options`** | array of `{ position: int, text: string }` | **added (CR-006)**; 2–20 entries; `position` runs 1…n in order; text 1–200 chars, plain text; texts distinct (validator `$expr`: `$size(options) == $size($setUnion(options.text))`); positions strictly `1..n` (upload guarantees; validator checks `minItems 2`, `maxItems 20`, `position` bounds) |

Sheet → field mapping: `item_code`→`item_code`; `domain_*`/`subdomain_*` → same (names validated against the framework map); `item_text`→`item_text` (≤ 500); `keying` `Positive` → `POSITIVE` (anything else, including `REVERSE`, is rejected at upload); `age_band`, `context`, `layer` verbatim; `status` `READY` → `status = ACTIVE` and `pilot_status = 'READY'`; `display_order` verbatim; `option_1…option_n` → `options` (blank cells skipped, order kept). `item_content_hash` = SHA-256 of `item_text` + options.

### 3.3 `responses`

`response_value` is now the chosen option's **position** as a string; validator pattern `^([1-9]|1[0-9]|20)$`. The server additionally checks the position against that question's `options.length` (application rule, §7). Everything else (`response_version`, `is_current`, `supersedes_response_id`, `idempotency_key`, `response_time_ms`, `presented_order`, `answered_at`) unchanged.

### 3.4 `score_results` (Tier A; behaviour in [contracts/scoring-and-report.md](contracts/scoring-and-report.md))

BUILD 01 fields unchanged (`attempt_id`, `participant_id`, `assessment_version_id`, `domain_code`, `raw_score`, `completeness_rate`, `score_status`, `scoring_version`, `calculated_at`) **plus**:

| Field | Type | Rule |
|-------|------|------|
| **`eligible_items`** | int ≥ 1 | **added (CR-006-8)**: questions eligible for the domain in the attempt's set (never a flat total) |
| **`valid_items`** | int, 0…`eligible_items` | **added**: current valid answers counted |
| **`completeness_status`** | enum `COMPLETE` \| `COMPLETE_WITH_MISSING` \| `INCOMPLETE` \| `INSUFFICIENT` | **added**: exact status of the scoring master (FR-045) |

`raw_score` is the domain mean of `value(position, n)` (research R-M08), two decimals, or `null` for `INSUFFICIENT`. `score_status` (evidence state) defaults to `S1`. Rows are never updated: a new scoring version adds rows.

### 3.5 `assessment_attempts`

Unchanged. `assessment_version_id` points at the question set the participant was given and is immutable.

### 3.6 `reports`

BUILD 01 fields unchanged plus **`content_hash`** (string, 64 hex, or `null`) — **added (CR-006-9)**: SHA-256 of the ordered section snapshots, written in the same update that sets the terminal state (scoring-and-report §9). Resolves BUILD 07 audit B07-AUD-013 and the scoring master ("complete report stores a SHA-256 content hash").

### 3.7 `interpretation_rules` (controlled wording)

BUILD 01 fields unchanged plus **`layer`** (enum `MEANING` \| `PATTERN` \| `STRENGTH` \| `GROWTH` \| `CHANGE` \| `PRIORITY` \| `ACTION`, required) — **added (CR-006-10)** so the exact-match key of the scoring master — question set, domain, age stage, evidence state, language, **layer** — is a real field instead of a `rule_code` prefix convention (feature 005's assumption is dropped). At most one `APPROVED` rule per key is enforced by `uq_one_approved_rule_per_dimension` (§5.4).

## 4. Store-level rules — validators (same-document constraints)

Everything below is enforced **by the store** on insert and update (constitution III bullet 3). Each has a failing-first store test.

| Collection | Validator rules (from BUILD 01 checks) |
|------------|----------------------------------------|
| `institutions` | `institution_type ∈ {SCHOOL,COLLEGE,UNIVERSITY}`; `parent_institution_id ≠ _id` |
| `participants` | age 13–25; **derived fields consistent**: `developmental_band` (13–15 D1, 16–17 D2, 18–20 D3, 21–25 D4), `assessment_track` (`<18` ADOLESCENT else EMERGING_ADULT), `is_minor` (`age < 18`) via `$expr`; OPEN route ⇒ `institution_id`, `cohort_id`, `external_student_id` all null; INSTITUTIONAL ⇒ institution and cohort set; `auth_provider` and `auth_provider_subject_id` both set or both null; `santulan_id` pattern |
| `consents` | type/giver combinations (`ADULT_SELF_CONSENT`/`STUDENT_ASSENT` ⇒ giver `SELF`; `PARENT_GUARDIAN_CONSENT` ⇒ `PARENT` or `GUARDIAN`; `INSTITUTION_DELEGATED` allowed only as a value, unused); non-blank `protocol_version`; `VERIFIED` ⇒ `verified_at` and non-blank `verification_method`; timestamp order checks |
| `assessment_versions` | see §3.1; age ranges; `OPEN` ⇒ `FROZEN` |
| `items` | valid domain code; `age_band ∈ {13–17, 18–25, 13–25}`; `context ∈ {General, School, College/Work, Digital}`; `layer` enum; `display_order > 0`; option list (§3.2); `status ∈ {ACTIVE, RETIRED}` |
| `assessment_attempts` | `session_count` 0–4; `age_years_at_attempt` 13–25; status enum; `developmental_band_at_attempt` consistent with age |
| `responses` | `response_value` pattern; `response_version > 0`; `idempotency_key` non-blank; `is_current` bool |
| `response_events` | `session_number` 1–4 or null; event type enum |
| `quality_flags` | `flag_code = Q09 ⇒ severity = CRITICAL`; reviewer trio all-or-none |
| `score_results` | `raw_score` null or 1.00–5.00; `completeness_rate` 0–1 and equal to `valid_items ÷ eligible_items` within rounding; `valid_items ≤ eligible_items`; **`completeness_status` consistent with the counts by exact integer arithmetic** (`INSUFFICIENT` ⇔ `valid×100 ≤ 60×eligible`; `INCOMPLETE` ⇔ `≤ 80×eligible`; `COMPLETE_WITH_MISSING` ⇔ `valid < eligible`; `COMPLETE` ⇔ all valid); **`INSUFFICIENT ⇔ raw_score null ⇔ score_status S0`** (60 % is INSUFFICIENT — scoring master, RC0 remediation); **`INCOMPLETE ⇒ score_status ∈ {S1, SH}`** (never S2+); S0 only with `INSUFFICIENT` (all same-document, so store-enforced) |
| `reports` | enum states; `retry_count ≥ 0`; **`generation_status ∈ {REPORT_READY, UNDER_REVIEW, NOT_ELIGIBLE} ⇒ content_hash` set; `PENDING`/`FAILED_RETRYABLE ⇒` null** |
| `interpretation_rules` | `layer` required and in the enum; `status` enum; non-blank `approved_text_template`; `locale` non-blank |
| `report_sections` | `display_order > 0`; section type enum; PRIORITY/ACTION never inserted released |
| `growth_*`, `pathway_decisions` | enums; `pathway_decisions.status ∈ S0…S7`; `growth_priorities.candidate_rank > 0` |
| `research_exports` | status enum; `READY ⇒ file_reference` set; `FAILED ⇒ file_reference` null |
| `admin_users` | **`status = ACTIVE ⇒ role = SUPER_ADMIN`** (BUILD 08 pilot-role control, same-document) |
| `audit_logs` | actor type enum; required fields |

## 5. Indexes

**Convention**: names identical to BUILD 01 §8. SQL `WHERE x IS NOT NULL` → partial filter `{ x: { $type: 'string' } }`; SQL `NOT IN (…)` → **positive `$in` list** (MongoDB rejects `$nin`/`$ne` in partial filters — verified). Descending columns kept.

### 5.1 The 29 BUILD 01 §8 indexes

| # | Name | Collection | Keys | Unique | Partial filter |
|---|------|------------|------|:-:|----|
| 1 | `idx_institutions_parent` | institutions | `parent_institution_id` | | `parent_institution_id: {$type:'string'}` |
| 2 | `idx_cohorts_institution_status` | cohorts | `institution_id, status` | | |
| 3 | `uq_participants_auth_subject` | participants | `auth_provider, auth_provider_subject_id` | ✔ | `auth_provider_subject_id: {$type:'string'}` |
| 4 | `idx_participants_institution` | participants | `institution_id` | | `institution_id: {$type:'string'}` |
| 5 | `idx_participants_cohort` | participants | `cohort_id` | | `cohort_id: {$type:'string'}` |
| 6 | `idx_participant_history_participant` | participant_cohort_history | `participant_id, assigned_at:-1` | | |
| 7 | `idx_consents_participant_status` | consents | `participant_id, status` | | |
| 8 | `uq_verified_consent_per_protocol` | consents | `participant_id, consent_type, protocol_version` | ✔ | `status: 'VERIFIED'` |
| 9 | `idx_items_version_domain_order` | items | `assessment_version_id, domain_code, display_order` | | |
| 10 | `idx_items_version_subdomain` | items | `assessment_version_id, subdomain_code` | | |
| 11 | `idx_items_code` | items | `item_code` | | |
| 12 | `idx_attempts_participant_status` | assessment_attempts | `participant_id, status` | | |
| 13 | `uq_one_nonterminal_attempt_per_participant` | assessment_attempts | `participant_id` | ✔ | `status: {$in: [CREATED, STARTED, IN_PROGRESS, PAUSED, SUBMITTED, SCORING, SCORED, QUALITY_HOLD]}` |
| 14 | `uq_response_version` | responses | `attempt_id, item_id, response_version` | ✔ | |
| 15 | `uq_current_response` | responses | `attempt_id, item_id` | ✔ | `is_current: true` |
| 16 | `idx_responses_attempt_current` | responses | `attempt_id, is_current` | | |
| 17 | `idx_response_events_attempt_time` | response_events | `attempt_id, occurred_at` | | |
| 18 | `idx_quality_flags_attempt` | quality_flags | `attempt_id, flag_code` | | |
| 19 | `idx_scores_attempt` | score_results | `attempt_id, domain_code` | | |
| 20 | `idx_reports_participant` | reports | `participant_id, created_at:-1` | | |
| 21 | `idx_report_sections_report` | report_sections | `report_id, display_order` | | |
| 22 | `idx_growth_plans_participant` | growth_plans | `participant_id, created_at:-1` | | |
| 23 | `idx_growth_priorities_plan` | growth_priorities | `plan_id, candidate_rank` | | |
| 24 | `idx_growth_reviews_goal` | growth_reviews | `goal_id, review_date:-1` | | |
| 25 | `idx_pathway_decisions_participant` | pathway_decisions | `participant_id, created_at:-1` | | |
| 26 | `idx_pathway_reviews_decision` | pathway_reviews | `pathway_decision_id, reviewed_at:-1` | | |
| 27 | `idx_research_exports_requested_by` | research_exports | `requested_by, created_at:-1` | | |
| 28 | `idx_audit_logs_target` | audit_logs | `target_entity, target_id, occurred_at:-1` | | |
| 29 | `idx_audit_logs_actor` | audit_logs | `actor_type, actor_id, occurred_at:-1` | | |

### 5.2 Indexes added by BUILD 03–06 in feature 005 (carried over unchanged)

| Name | Collection | Keys | Unique | Partial filter |
|------|------------|------|:-:|----|
| `uq_participant_institution_external_id` | participants | `institution_id, external_student_id` | ✔ | `external_student_id: {$type:'string'}` |
| `uq_consent_active_type_protocol` | consents | `participant_id, consent_type, protocol_version` | ✔ | `status: {$in: [PENDING, GRANTED, VERIFIED]}` |
| `uq_submit_idempotency` | response_events | `attempt_id, metadata.idempotency_key` | ✔ | `event_type: 'SUBMIT'` |
| `uq_quality_flag_logical` | quality_flags | `attempt_id, domain_code, flag_code` | ✔ | (a `null` domain compares equal to `null`) |

### 5.3 Inline `UNIQUE` constraints of BUILD 01 §6 → named unique indexes

`uq_institutions_code` (`institution_code`), `uq_participants_santulan_id`, `uq_cohorts_institution_code` (`institution_id, cohort_code`), `uq_admin_users_auth` (`auth_provider, auth_provider_subject_id`), `uq_items_version_code` (`assessment_version_id, item_code`), `uq_items_version_order` (`assessment_version_id, display_order`), `uq_interpretation_rules_key` (`assessment_version_id, rule_code, version, locale`), `uq_development_actions_key` (`action_code, library_version`), `uq_reflection_prompts_key` (`prompt_code, version`), `uq_responses_idempotency` (`idempotency_key`), `uq_scores_key` (`attempt_id, domain_code, scoring_version`), `uq_reports_attempt` (`attempt_id`), `uq_report_sections_order` (`report_id, display_order`), `uq_growth_goals_priority` (`priority_id`) — 14 in all, checked against migrations 009–014. Two BUILD 01 uniques are **not** carried: `response_scales.version` (entity retired) and `assessment_versions.version_label` (replaced by `uq_one_live_revision_per_label`, §5.4). The dev-only collection adds `uq_dev_identity` (`provider, subject_id`), which is not a canonical entity and is not counted below. *(Nothing here is invented; the migration is generated from BUILD 01 §6.)*

### 5.4 Added by change record 006 (need owner approval — D-M03/D-M04)

| Name | Collection | Keys | Unique | Partial filter | Purpose |
|------|------------|------|:-:|----|---------|
| `uq_one_open_set_per_age_group` | assessment_versions | `configuration` | ✔ | `participation_state: 'OPEN'` | constitution II: at most one open set per age group (store-enforced) |
| `uq_one_live_revision_per_label` | assessment_versions | `version_label` | ✔ | `status: {$in: [DRAFT, FROZEN]}` | one live revision per label; superseded ones are `RETIRED` |
| `uq_one_approved_rule_per_dimension` | interpretation_rules | `assessment_version_id, domain_code, developmental_band, evidence_state, locale, layer` | ✔ | `status: 'APPROVED'` | scoring master: exactly one approved wording per exact dimension (a `null` band is the band-less wording; a band-specific one wins) |

Total: 29 + 4 + 14 (inline) + 3 = **50 named canonical indexes** (+ 1 dev-only); every one is listed here, none is anonymous.

## 6. State machines (unchanged from feature 005 data-model §3)

Attempt (`CREATED → STARTED → IN_PROGRESS ⇄ PAUSED → SUBMITTED → SCORING → SCORED → REPORT_READY`, with `QUALITY_HOLD`, `INVALID`, `EXPIRED` branches), consent (`PENDING → GRANTED → VERIFIED → WITHDRAWN`), report (`PENDING → REPORT_READY | FAILED_RETRYABLE → PENDING`; `UNDER_REVIEW`/`NOT_ELIGIBLE` terminal), research export (`REQUESTED → GENERATING → READY | FAILED`), question set (`DRAFT → FROZEN`, `participation_state CLOSED → OPEN → CLOSED/PAUSED/STOPPED`, superseded draft → `RETIRED`), pathway states S0–S7. **Enforcement**: a transition table per aggregate in `domain/*Rules.js` plus **compare-and-set** in the repository (`updateOne({_id, status: from}, …)`); a stale `from` matches nothing and is reported as a conflict. The store guards *shape*, the domain layer guards *moves*.

## 7. Application-enforced invariants (MongoDB cannot express these)

Each was a SQL trigger, function or cross-table check. Each becomes a named rule in the domain layer, runs **inside the same transaction** as the write, refuses on violation, has a failing-first test carrying the original matrix ID, and is re-verified after data changes by `scripts/db-verify.js`.

| Invariant | Was (SQL) | Now (domain rule) | Tests |
|-----------|-----------|-------------------|-------|
| Reference existence (participant, cohort, item, version, attempt, report exist) | foreign keys | repository `assertExists` in the transaction | T03, B05 |
| Cohort belongs to the participant's institution; INSTITUTIONAL scope | participant scope trigger | `registrationRules.assertScope` | T03-009 |
| Consent transitions; type/giver/age compatibility; verified-at rules | consent triggers | `consentRules` (uses the participant's stored age) | T04-005…026 |
| Consent gate + ACTIVE participant + set FROZEN & OPEN + control plane + age within range at attempt creation | attempt-create trigger | `attemptRules.assertCanStart` (single transaction with the unique open-attempt index as the race guard) | T03-017…020, B05-031…033 |
| Attempt state machine; participant/version/age immutable; `session_count` +1 per boundary | attempt update trigger | `attemptRules.transition` + compare-and-set | B05 |
| Answer: attempt writable, question belongs to the attempt's set, `CORE`+`ACTIVE`, **position ≤ option count**, contiguous versions, supersedes the immediate prior | response insert trigger + `save_response` | `responseRules.save` (transaction; duplicate-key on `uq_response_version`/`uq_current_response` = concurrent loser) | B05-001…045 |
| Only `is_current` may change on a response | response mutation trigger | `responseRepository.retireCurrent` is the **only** update path; scan test | B08-054/055 |
| Quality: Q06 detector, Q09 routes the attempt to `QUALITY_HOLD`, outcome event validity, detection facts immutable | triggers + `build06_*` | `qualityRules` + repository allows only disposition fields | B06 |
| Scorer: quality CLEAR first, SUBMITTED, set FROZEN, eligibility, missingness, position→score, one transaction, seven rows | `score_attempt` | `scoringRules.scoreAttempt` (transaction; `uq_scores_key` is the race guard) | B06-001…060 |
| Score/report/growth/pathway provenance (participant and version equal the attempt's) | provenance triggers | rules on each insert | B06-019 |
| Report machine; sections only while PENDING (or the single T11/T12); release gates; snapshot immutability | BUILD 07 triggers/functions | `reportRules` + Tier-B repository exposing only the release flag | B07 |
| Priority guard (S2–S5, ≤ 3 selected), goal/action guards | BUILD 07 triggers | `growthRules` (plan-level compare-and-set counter or transactional count) | B07-037…046 |
| Pathway guard, precedence, P5 hook idempotency, plan pause | BUILD 07 | `pathwayRules` | B07-052…065, 080 |
| Frozen content immutable; hash unchanged | frozen-content triggers | `items` is Tier A; set `status` compare-and-set; `content_hash` verified at open / start / `db-verify` | T-B02-011 |
| Control plane (latest audit event decides; unrecognised = STOPPED) | `participation_control_state()` | `controlPlane.getState` reads the latest event | B05, B08-001…004 |
| Actor may act on this attempt | `assert_attempt_actor` | the scope filter (R-M05) | SEC-04/05 |
| Export lifecycle transitions; download only when READY; audit atomic | BUILD 08 functions | `exportRules` + compare-and-set | B08-033…040 |
| Evidence decision: S1 by default; S2 only with the pilot-S2 switch, completeness > 80 % and not held; S3–S5 need the advanced switch | scorer + config | `scoringRules.decideEvidence` reading the audited switches | B06-039…041, new |
| Report wording exact match; **fail closed** when an S2+ domain has no approved wording; descriptive layers for S2+ domains only | RC0 (was skipped silently in 005) | `reportRules.pickWording` / `reportService` (two transactions: aborted render, then `FAILED_RETRYABLE`) | new (B07-028 family) |
| Report fingerprint equals the hash of the stored sections; terminal reports always carry one | — | `reportRules.fingerprint` + `db-verify` recomputation | B07-003, RC-11 |
| Release switches default OFF, latest audited event decides, unknown ⇒ OFF | control plane pattern (R-18) | `releaseFlags.get/set` (audit in the same transaction) | new |
| Q07 raised for every INCOMPLETE/INSUFFICIENT domain; Q06 hard stop; Q09 never derived from a score | RC0 / BUILD 06 | `qualityRules` | B06 |

**Constitution note (Complexity Tracking, D-M06)**: constitution III bullet 3 asks that constraint-like invariants live *in the data store*. Same-document constraints (§4) and uniqueness (§5) do. The invariants above are cross-document or state-transition rules that neither MongoDB validators nor privileges can express; they are the documented residual, mitigated by transactions, negative tests and the integrity verifier.

## 8. Research-safe views (identity minimisation, BUILD 08 §10)

| View | Source | Fields kept (never `participant_id`, `auth_provider*`, `external_student_id`, contact, guardian) |
|------|--------|---------------------------------------------------------------------------------------------------|
| `v_research_participants` | participants ⨝ institutions ⨝ cohorts | `santulan_id`, `participation_route`, `assessment_track`, `developmental_band`, `institution_id`, `institution_code`, `cohort_id`, `cohort_code`, `education_stage`, `participant_status`, `created_at` |
| `v_research_attempts` | attempts ⨝ participants ⨝ versions | `attempt_id`, `santulan_id`, `version_label`, status, `session_count`, timestamps, filter columns (`institution_id`, `cohort_id`, `participant_status`) |
| `v_research_item_responses` | responses ⨝ attempts ⨝ items | `response_id`, `attempt_id`, `santulan_id`, `item_code`, `response_value` (position), `option_count`, `response_version`, `is_current`, `response_time_ms`, `presented_order`, `answered_at`, filter columns |
| `v_research_domain_scores` | score_results ⨝ attempts | `attempt_id`, `santulan_id`, `domain_code`, `raw_score`, **`eligible_items`, `valid_items`**, `completeness_rate`, **`completeness_status`**, `score_status`, `scoring_version`, `calculated_at` (the valid/eligible counts BUILD 08 asks for are now stored) |
| `v_research_quality_flags` | quality_flags ⨝ attempts (excludes `Q09`) | code, severity, `detected_at`, `disposition`, `reviewed_at` (no reviewer id, no note) |
| `v_research_response_events` | response_events ⨝ attempts | type, `session_number`, `occurred_at`, `metadata` minus `idempotency_key` |
| `v_research_assessment_versions` | assessment_versions | label, revision, configuration, `content_hash`, status, `frozen_at` |
| `v_research_cohorts` | cohorts ⨝ institutions | institution/cohort codes, type, academic year, stage, band, status |
| `v_candidate_subdomain_scores` | items ⨝ responses ⨝ attempts | **research-only, never participant-facing** (scoring master §8): per attempt/subdomain candidate mean using the same position→value rule, eligible/answered counts, `interpretation_hold = true` for `C4.2` and `C2.10`; held answers still count in the domain mean. **Not granted to the runtime credential** (read by the migrator credential in research scripts). |

## 9. Change record 006 — additions and retirement for owner approval

| # | Change | Where | Why |
|---|--------|-------|-----|
| CR-006-1 | MongoDB replaces PostgreSQL as the only system of record | whole model | owner direction 2026-09-20 |
| CR-006-2 | **Added** `items.options` (embedded, immutable, 2–20) | `items` | variable options (spec FR-014/015) |
| CR-006-3 | **Retired** entity `response_scales` and field `assessment_versions.response_scale_id` | §2, §3.1 | the scale is now a per-question option list (spec FR-023) |
| CR-006-4 | **Added** `assessment_versions.revision`; indexes `uq_one_open_set_per_age_group`, `uq_one_live_revision_per_label` | §3.1, §5.4 | draft re-upload without deletion; one open set per age group |
| CR-006-5 | `response_value` now holds the option **position**; scoring by even position spacing | §3.3, research R-M08 | spec FR-014 (default awaiting psychometric approval; evidence stays S1) |
| CR-006-6 | Upload record realised as `audit_logs` entries (no new collection) | research R-M09 | fewest additions |
| CR-006-7 | Non-canonical `dev_identity_credentials` collection (dev only) | §2 | replaces the PostgreSQL `dev_identity` schema (D-17) |
| CR-006-8 | **Added** `score_results.eligible_items`, `valid_items`, `completeness_status`; 60 % complete is now `INSUFFICIENT` | §3.4 | scoring master (stores item counts; RC0 remediation), BUILD 08 export needs |
| CR-006-9 | **Added** `reports.content_hash` | §3.6 | scoring master; closes B07-AUD-013 |
| CR-006-10 | **Added** `interpretation_rules.layer` and index `uq_one_approved_rule_per_dimension` | §3.7, §5.4 | scoring master: exactly one approved wording per dimension |
| CR-006-11 | Release switches recorded as `RELEASE_FLAG_CHANGED` audit events (no new entity) | contracts/scoring-and-report §10 | scoring master §15, handover change-control |

**Alternative offered for `responses` (D-M02)**: drop the stored `is_current` and derive "current" from a supersedes chain with a unique partial index on `supersedes_response_id` (each answer can be superseded once, so no forks) plus `uq_response_version`. `responses` then moves to **Tier A** and the store itself forbids any change to a saved answer. It removes a BUILD 01 field (`is_current`) and its two indexes (`uq_current_response`, `idx_responses_attempt_current`), so it is a further change record; the default keeps BUILD 01 as documented.
