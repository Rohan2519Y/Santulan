# Data Model: Platform SQL Database

> **Superseded in part (2026-09-19).** The requester directed that the database be strictly the design in `docs/SQL-Database-Schema.md` and that the older feature-002 tables be removed. This document describes the original plan, which added things the doc does not contain (integrity triggers, `erase_student()`, an `app_readonly` role, append-only audit privileges, bypass/helper functions, extra indexes) and kept the feature-002 tables. **Those additions were not built.** What was built is recorded in `tasks.md` and the "Scope revision" section of `spec.md`.

**Branch**: `004-platform-sql-database` | **Date**: 2026-09-19 | **Plan**: [plan.md](plan.md)

## Overview

The field-level definition of all 22 tables is `docs/SQL-Database-Schema.md` (§2 ER diagram, §3 DDL). It is **not repeated here**. This file records what the plan needs beyond it: how the tables group, how each is scoped for tenant isolation, what happens on delete, the three changes made to the doc's DDL, the state machines the columns imply, and which constraint proves which requirement.

The new tables live in the same database as the 17 existing capability-assessment tables and share no foreign keys with them.

## 1. Tables at a glance

`Scope` = how row-level security decides who may see a row (contract details: [contracts/database-contract.md](contracts/database-contract.md)). *Direct* = own school column. *Via account* = visible only if the owning account row is visible. *None* = global catalog.

| # | Table | Group | Key | Scope | Notes |
|---|-------|-------|-----|-------|-------|
| 1 | `schools` | Tenancy | `school_id` | Direct (`school_id`) | Tenant root; deactivate via `status`, never delete |
| 2 | `accounts` | Identity | `account_id` | Direct (`school_id`) | **+ `deleted_at`** (fix #2). Platform/superuser rows have NULL school → invisible to school staff |
| 3 | `student_profiles` | Identity | `account_id` (FK) | Via account | Trigger: owner must be a student |
| 4 | `staff_profiles` | Identity | `account_id` (FK) | Via account | Trigger: owner must be counsellor/principal/teacher/support |
| 5 | `parent_profiles` | Identity | `account_id` (FK) | Via account | Trigger: owner must be a parent. `linked_student_account_ids UUID[]` (GIN) |
| 6 | `school_assignments` | Tenancy | `assignment_id` | Direct | Partial unique: one active principal per school |
| 7 | `capability_grants` | Permissions | `grant_id` | Via account | `fields` allowed only for `update` |
| 8 | `escalation_events` | Safeguarding | `escalation_id` | Direct | Severity 3–5 |
| 9 | `counsellor_notes` | Safeguarding | `note_id` | Via account (student) | `content_sealed BYTEA` |
| 10 | `consent_records` | Consent | `consent_id` | Direct | General onboarding consent |
| 11 | `scp_consents` | Consent | `consent_id` | Direct | Renewable, per academic year |
| 12 | `scp_sessions` | SCP | `session_id` | Via account (student) | Sealed `item_responses_sealed`, `domain_scores` JSONB |
| 13 | `scp_assents` | SCP | `assent_id` | Via account (student) | **+ `UNIQUE (session_id)`** (fix #3) |
| 14 | `protocols` | Protocol library | `protocol_id` | None (global) | `protocol_code` unique |
| 15 | `protocol_orientations` | Protocol library | `orientation_id` | Via account | `UNIQUE (account_id, protocol_id)` |
| 16 | `protocol_route_events` | Protocol library | `event_id` | Via account (student) | |
| 17 | `queue_signals` | Guidance | `signal_id` | Direct | **+ `school_id`** (fix #1) |
| 18 | `class_guidance_state` | Guidance | `state_id` | Direct | `UNIQUE (school_id, class_label)` |
| 19 | `content_modules` | Content | `module_id` | None (global) | Empty `target_school_ids` = all schools |
| 20 | `module_completions` | Content | `completion_id` | Via account | `UNIQUE (account_id, module_id)` |
| 21 | `group_sessions` | Content | `group_session_id` | Direct | |
| 22 | `audit_events` | Audit | `audit_id` | Direct (`actor_school_id`) | Append-only for `app_runtime` |

New enum types (7): `account_type_enum`, `account_status_enum`, `role_enum`, `school_assignment_role_enum`, `resource_enum`, `action_enum`, `scope_type_enum`.

## 2. Changes to the doc's DDL

| # | Change | Reason | Traces to |
|---|--------|--------|-----------|
| 1 | `queue_signals.school_id UUID NOT NULL → schools ON DELETE CASCADE` + index | ERD shows it; tenant isolation needs a school on the row | FR-023, FR-016 |
| 2 | `accounts.deleted_at TIMESTAMPTZ` | ERD shows it; the "deleted" status needs a deletion time | FR-039 |
| 3 | `UNIQUE (session_id)` on `scp_assents` | ERD says "one assent per session" | FR-026 |

Everything else — including the doc's additional indexes, `CHECK`s and partial unique indexes — is built as written. Added beyond the doc, none of which alters a table's columns: nine indexes (research §8), two trigger functions (research §6, §7), two helper SQL functions and the policies (research §4), grants (research §5, §9).

## 3. Delete behavior (from the doc's foreign keys)

**Cascades from the student's account** (erasing a student removes these — FR-038): `student_profiles`, `consent_records`, `scp_consents` (student side), `scp_sessions` → `scp_assents`, `escalation_events`, `counsellor_notes` (student side), `queue_signals`, `protocol_route_events` (student side), `module_completions`, `protocol_orientations`, `capability_grants`, `school_assignments`, `parent_profiles`/`staff_profiles` (own row).

**Does not cascade — refuses the delete** (`NO ACTION`; FR-039): an account named as author/actor in retained records — `counsellor_notes.counsellor_account_id`, `protocol_route_events.practitioner_account_id`, `escalation_events.acknowledged_by/resolved_by`, `school_assignments.assigned_by`, `capability_grants.granted_by`, `staff_profiles.approved_by`, `scp_consents.parent_account_id/granted_by`, `scp_sessions.voided_by`, `content_modules.published_by`, `group_sessions.counsellor_account_id`, `audit_events.actor_account_id`. Those accounts are marked `status='deleted'` + `deleted_at` and retained.

**Schools**: `accounts.school_id` is `NO ACTION`, so a school with accounts cannot be deleted; deactivate it. Deleting a school with no accounts cascades to its assignments, escalations, consents, guidance, group sessions and queue signals.

**Parent link list**: not a foreign key. An `AFTER DELETE ON accounts` trigger strips the deleted id from every `parent_profiles.linked_student_account_ids` so erasure leaves no trace (research §6).

**One erasure path — `erase_student(account_id)`**: because a student who appears in the audit trail cannot be hard-deleted, erasure is a function, not a bare `DELETE`. It removes all student-scoped rows and the parent-list entries, then deletes the account row — or, if retained records still reference it, anonymises it in place (`status='deleted'`, `deleted_at` set, personal fields cleared, credentials made unusable). Either way FR-038 and FR-039 both hold (research §6).

## 4. State machines

**`accounts.status`**: `pending → active ⇄ suspended`, `active → locked → active`, any → `deleted` (with `deleted_at`). `password_hash` may be NULL only in `pending` (constraint). A parent account starts `pending` at student registration and activates in place.

**`student_profiles.onboarding_state`**: `dormant → consent_recorded → active`, any → `withdrawn`. `active` requires `login_id`, a password on the account, and consent on file — an application rule; the schema stores the state and the check that it is one of the four values.

**`escalation_events.status`**: `open → acknowledged → resolved`. The table stores `acknowledged_by/at`, `resolved_by/at`; ordering is an application rule, not a constraint (the doc defines none).

**`scp_consents`**: `status` is free text in the doc (no allowed-value list), so the schema does not restrict it; validity is carried by `valid_from`/`valid_until`/`withdrawn_at`.

**`scp_sessions`**: `state` and `participation_status` are free text in the doc; `voided_at/by/void_reason` record a void. Sealed answers are opaque JSONB values written by the application.

**`protocols.review_status`**: `draft → approved → retired` (constrained to those three values).

**`school_assignments`**: active while `revoked_at IS NULL`; revoking sets the time and keeps the row.

## 5. Requirement → constraint traceability

| Requirement | Enforced by |
|-------------|-------------|
| FR-001, FR-002, FR-003 | Migrations 003–005 via the existing runner; `_migrations` tracking; additive only |
| FR-005, FR-007 | `accounts` enums, `email`/`mobile` `UNIQUE` |
| FR-006 | `CHECK school_id_matches_account_type` |
| FR-008 | `CHECK password_required_unless_pending` |
| FR-009, FR-010, FR-011 | Separate profile tables + `enforce_profile_role()` trigger; `login_id`/`work_email` `UNIQUE` |
| FR-012 | `school_assignments.revoked_at` (row retained) |
| FR-013 | Partial unique index `uq_one_active_principal_per_school` |
| FR-014, FR-015 | `CHECK fields_only_on_update`; `resource_enum` excludes removed resources |
| FR-016, FR-017, FR-018 | RLS on 20 tables (FORCE) + fail-closed `app_school_id()` + `app_bypass()` |
| FR-019 | Column-level grants to `app_readonly` (research §5) |
| FR-020 | `content_sealed BYTEA NOT NULL`; `item_responses_sealed JSONB`; no plain-text column exists |
| FR-021 | `escalation_level BETWEEN 3 AND 5`, status `CHECK` |
| FR-024 | `UNIQUE (school_id, class_label)` |
| FR-026 | `UNIQUE (session_id)` on `scp_assents` (fix #3) |
| FR-028, SC-009 | Composite index on `scp_sessions (student_account_id, checkpoint, completed_at DESC)` |
| FR-029 | `protocol_code UNIQUE`, `review_status CHECK` |
| FR-030, FR-033 | `UNIQUE (account_id, protocol_id)`, `UNIQUE (account_id, module_id)` |
| FR-035, FR-036 | `audit_events` single table; `event_class` value `'class_a_decrypt'`; append-only grants |
| FR-037 | All references are declared foreign keys; only the parent list is exempt |
| FR-038, FR-039 | §3 above — `erase_student()`, cascades, `NO ACTION` author/actor foreign keys, `deleted_at` |
| FR-040 | No such table/enum value exists (structure test) |

## 6. Assessment module tables (added 2026-09-19; not part of the schema doc)

Restored by migration `007` beside the doc's 22 tables. Definitions are those of `001_init_capability_assessment.sql` and `002_responses_rls.sql`, except as noted.

**Tables (15)**: `response_scales`, `assessment_versions`, `items`, `participant_profiles`, `consents`, `assessment_attempts`, `responses`, `response_events`, `quality_flags`, `score_results`, `interpretation_rules`, `reports`, `report_sections`, `content_import_records`, `participation_controls`. **Enums (18)**: `LifecycleStatus`, `ToolBand`, `ItemKeying`, `ItemLayer`, `ItemStatus`, `ParticipationRoute`, `AgeBand`, `ParticipantContext`, `ConsentType`, `ConsentStatus`, `AttemptStatus`, `ResponseEventType`, `QualityFlagCode`, `ScoreStatus`, `ReportGenerationStatus`, `ReportSectionType`, `ImportStatus`, `ParticipationAction`.

**Changed from 001 (the only differences)**

| Column | Was | Now |
|--------|-----|-----|
| `participant_profiles.user_id` | `TEXT` → `users(id)` | `UUID NOT NULL` → `accounts(account_id)` (still unique) |
| `quality_flags.reviewed_by` | `TEXT` → `users(id)`, `ON DELETE SET NULL` | `UUID` → `accounts(account_id)`, `ON DELETE SET NULL` |
| `content_import_records.imported_by` | `TEXT NOT NULL` → `users(id)` | `UUID NOT NULL` → `accounts(account_id)` |

`users` and `UserRole` are not restored. No table here is referenced by any of the doc's 22 tables, and no column was added. `participant_profiles` belongs to the student's `accounts` row; `responses` keeps its row-level-security policy keyed on `app.participant_profile_id`.
