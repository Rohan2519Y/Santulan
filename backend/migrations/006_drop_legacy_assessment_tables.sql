-- Remove the feature-002 capability-assessment tables so the database contains only the
-- design in docs/SQL-Database-Schema.md (the 22 platform tables added by 003) plus the
-- migration runner's own _migrations tracker.
--
-- Requested explicitly: "remove the unwanted tables". This is irreversible for the data in
-- them. A full pg_dump taken immediately before applying this file is kept (git-ignored) at
-- backend/backups/santulandb-before-legacy-drop-2026-09-19.sql.
--
-- The migration files that created these tables (001, 002) are left in place: on a brand-new
-- database they still run in order and this file then removes what they created, so the
-- migration history stays consistent.
--
-- Consequence: the feature-002 backend code (backend/src/modules/assessment, auth routes,
-- seeders and their tests) queries these tables and will fail until it is retired or rebuilt
-- on the new schema.
--
-- No platform table references any of these tables (no foreign key crosses between the two
-- sets), so a plain DROP TABLE with no CASCADE is sufficient - it will error rather than
-- silently drop anything else if that ever stops being true. The 002 row-level-security
-- policy on "responses" is dropped together with the table.

DROP TABLE
    "report_sections",
    "reports",
    "score_results",
    "quality_flags",
    "response_events",
    "responses",
    "assessment_attempts",
    "consents",
    "participant_profiles",
    "items",
    "interpretation_rules",
    "assessment_versions",
    "response_scales",
    "content_import_records",
    "participation_controls",
    "users";

-- The enum types created by 001 were used only by those tables.
DROP TYPE
    "UserRole",
    "LifecycleStatus",
    "ToolBand",
    "ItemKeying",
    "ItemLayer",
    "ItemStatus",
    "ParticipationRoute",
    "AgeBand",
    "ParticipantContext",
    "ConsentType",
    "ConsentStatus",
    "AttemptStatus",
    "ResponseEventType",
    "QualityFlagCode",
    "ScoreStatus",
    "ReportGenerationStatus",
    "ReportSectionType",
    "ImportStatus",
    "ParticipationAction";
