-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('participant', 'admin');

-- CreateEnum
CREATE TYPE "LifecycleStatus" AS ENUM ('DRAFT', 'FROZEN', 'RETIRED');

-- CreateEnum
CREATE TYPE "ToolBand" AS ENUM ('ADOLESCENT', 'EMERGING_ADULT');

-- CreateEnum
CREATE TYPE "ItemKeying" AS ENUM ('POSITIVE', 'REVERSE');

-- CreateEnum
CREATE TYPE "ItemLayer" AS ENUM ('CORE', 'V', 'SJT', 'O');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ParticipationRoute" AS ENUM ('OPEN', 'INSTITUTIONAL');

-- CreateEnum
CREATE TYPE "AgeBand" AS ENUM ('D1', 'D2', 'D3', 'D4');

-- CreateEnum
CREATE TYPE "ParticipantContext" AS ENUM ('SCHOOL', 'COLLEGE_WORK', 'GENERAL');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('ADULT_SELF_CONSENT', 'PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'GRANTED', 'VERIFIED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED', 'SUBMITTED', 'SCORING', 'SCORED', 'REPORT_READY', 'QUALITY_HOLD', 'INVALID', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ResponseEventType" AS ENUM ('SESSION_START', 'SESSION_END', 'PAUSE', 'RESUME', 'RESPONSE_SAVED', 'SUBMIT');

-- CreateEnum
CREATE TYPE "QualityFlagCode" AS ENUM ('Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08', 'Q09');

-- CreateEnum
CREATE TYPE "ScoreStatus" AS ENUM ('S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'SH');

-- CreateEnum
CREATE TYPE "ReportGenerationStatus" AS ENUM ('PENDING', 'REPORT_READY', 'FAILED_RETRYABLE');

-- CreateEnum
CREATE TYPE "ReportSectionType" AS ENUM ('T01_DOMAIN_RESULT', 'T02_DESCRIPTIVE_SUMMARY', 'T03_STRENGTHS', 'T04_GROWTH_AREAS', 'T05_PRIORITIES', 'T06_ACTIONS', 'T07_GROWTH_PLAN', 'T08_PATHWAY', 'T09_QUALITY_NOTE', 'T10_ADMIN_ONLY', 'T11_HOLD_NEUTRAL', 'T12_NOT_ELIGIBLE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('accepted', 'rejected');

-- CreateEnum
CREATE TYPE "ParticipationAction" AS ENUM ('PAUSE', 'STOP', 'REOPEN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_scales" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "scale_points" INTEGER NOT NULL,
    "anchor_labels" JSONB NOT NULL,
    "keying_definition" JSONB NOT NULL,
    "frozen_at" TIMESTAMP(3),
    "status" "LifecycleStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "response_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_versions" (
    "id" TEXT NOT NULL,
    "version_label" TEXT NOT NULL,
    "response_scale_id" TEXT NOT NULL,
    "tool_band" "ToolBand" NOT NULL,
    "source_file" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "frozen_at" TIMESTAMP(3),
    "status" "LifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "is_active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "assessment_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "assessment_version_id" TEXT NOT NULL,
    "item_code" TEXT NOT NULL,
    "domain_code" TEXT NOT NULL,
    "subdomain_code" TEXT NOT NULL,
    "domain_name" TEXT NOT NULL,
    "subdomain_name" TEXT NOT NULL,
    "item_text" TEXT NOT NULL,
    "keying" "ItemKeying" NOT NULL,
    "age_band" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "layer" "ItemLayer" NOT NULL DEFAULT 'CORE',
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "display_order" INTEGER NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "santulan_id" TEXT NOT NULL,
    "participation_route" "ParticipationRoute" NOT NULL,
    "age_band" "AgeBand" NOT NULL,
    "is_minor" BOOLEAN NOT NULL,
    "context" "ParticipantContext" NOT NULL,
    "administration_language" TEXT NOT NULL DEFAULT 'en',

    CONSTRAINT "participant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" TEXT NOT NULL,
    "participant_profile_id" TEXT NOT NULL,
    "consent_type" "ConsentType" NOT NULL,
    "protocol_version" TEXT NOT NULL,
    "verification_method" TEXT,
    "verified_at" TIMESTAMP(3),
    "status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_attempts" (
    "id" TEXT NOT NULL,
    "participant_profile_id" TEXT NOT NULL,
    "assessment_version_id" TEXT NOT NULL,
    "scoring_version" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'CREATED',
    "session_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responses" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "participant_profile_id" TEXT NOT NULL,
    "response_value" INTEGER NOT NULL,
    "response_version" INTEGER NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "supersedes_response_id" TEXT,
    "response_time_ms" INTEGER,
    "answered_at" TIMESTAMP(3) NOT NULL,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_events" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "item_id" TEXT,
    "event_type" "ResponseEventType" NOT NULL,
    "session_number" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "response_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_flags" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "domain_code" TEXT,
    "flag_code" "QualityFlagCode" NOT NULL,
    "severity" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disposition" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "quality_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_results" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "participant_profile_id" TEXT NOT NULL,
    "domain_code" TEXT NOT NULL,
    "raw_score" DECIMAL(3,2) NOT NULL,
    "valid_response_count" INTEGER NOT NULL,
    "eligible_item_count" INTEGER NOT NULL,
    "completeness_rate" DECIMAL(4,3) NOT NULL,
    "score_status" "ScoreStatus" NOT NULL,
    "scoring_version" TEXT NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interpretation_rules" (
    "id" TEXT NOT NULL,
    "assessment_version_id" TEXT NOT NULL,
    "domain_code" TEXT NOT NULL,
    "developmental_band" TEXT NOT NULL,
    "evidence_state" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "rule_code" TEXT NOT NULL,
    "approved_text_template" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "LifecycleStatus" NOT NULL DEFAULT 'FROZEN',

    CONSTRAINT "interpretation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "participant_profile_id" TEXT NOT NULL,
    "report_version" TEXT NOT NULL,
    "generation_status" "ReportGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "generated_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_sections" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "section_type" "ReportSectionType" NOT NULL,
    "domain_code" TEXT,
    "content_version" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "content_snapshot" JSONB NOT NULL,
    "is_released_to_participant" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "report_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_import_records" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "version_label" TEXT NOT NULL,
    "imported_by" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "error_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_import_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participation_controls" (
    "id" TEXT NOT NULL,
    "action" "ParticipationAction" NOT NULL,
    "reason" TEXT,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participation_controls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "response_scales_version_key" ON "response_scales"("version");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_versions_version_label_key" ON "assessment_versions"("version_label");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_versions_one_active" ON "assessment_versions"("is_active") WHERE (is_active = true);

-- CreateIndex
CREATE UNIQUE INDEX "items_code_per_version" ON "items"("item_code", "assessment_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "participant_profiles_user_id_key" ON "participant_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "participant_profiles_santulan_id_key" ON "participant_profiles"("santulan_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_attempts_idempotency_key_key" ON "assessment_attempts"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_one_active_per_participant_version" ON "assessment_attempts"("participant_profile_id", "assessment_version_id") WHERE (status IN ('CREATED','STARTED','IN_PROGRESS','PAUSED'));

-- CreateIndex
CREATE UNIQUE INDEX "responses_idempotency_key_key" ON "responses"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "responses_one_current_per_attempt_item" ON "responses"("attempt_id", "item_id") WHERE (is_current = true);

-- CreateIndex
CREATE UNIQUE INDEX "score_results_one_per_attempt_domain" ON "score_results"("attempt_id", "domain_code");

-- CreateIndex
CREATE UNIQUE INDEX "interpretation_rules_unique_lookup" ON "interpretation_rules"("assessment_version_id", "domain_code", "developmental_band", "evidence_state", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "reports_attempt_id_key" ON "reports"("attempt_id");

-- AddForeignKey
ALTER TABLE "assessment_versions" ADD CONSTRAINT "assessment_versions_response_scale_id_fkey" FOREIGN KEY ("response_scale_id") REFERENCES "response_scales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_assessment_version_id_fkey" FOREIGN KEY ("assessment_version_id") REFERENCES "assessment_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_profiles" ADD CONSTRAINT "participant_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_participant_profile_id_fkey" FOREIGN KEY ("participant_profile_id") REFERENCES "participant_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_participant_profile_id_fkey" FOREIGN KEY ("participant_profile_id") REFERENCES "participant_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_assessment_version_id_fkey" FOREIGN KEY ("assessment_version_id") REFERENCES "assessment_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "assessment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_participant_profile_id_fkey" FOREIGN KEY ("participant_profile_id") REFERENCES "participant_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_supersedes_response_id_fkey" FOREIGN KEY ("supersedes_response_id") REFERENCES "responses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_events" ADD CONSTRAINT "response_events_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "assessment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_events" ADD CONSTRAINT "response_events_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_flags" ADD CONSTRAINT "quality_flags_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "assessment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_flags" ADD CONSTRAINT "quality_flags_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_results" ADD CONSTRAINT "score_results_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "assessment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_results" ADD CONSTRAINT "score_results_participant_profile_id_fkey" FOREIGN KEY ("participant_profile_id") REFERENCES "participant_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interpretation_rules" ADD CONSTRAINT "interpretation_rules_assessment_version_id_fkey" FOREIGN KEY ("assessment_version_id") REFERENCES "assessment_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "assessment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_participant_profile_id_fkey" FOREIGN KEY ("participant_profile_id") REFERENCES "participant_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_sections" ADD CONSTRAINT "report_sections_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_import_records" ADD CONSTRAINT "content_import_records_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
