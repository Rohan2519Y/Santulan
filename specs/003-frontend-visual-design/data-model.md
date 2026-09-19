# Data Model: Frontend Visual Design (003)

> **Revision notice (2026-09-19)** — This file was generated before the Santulan 2.0 UI revision of [spec.md](spec.md). It still describes the earlier *calm & warm* cream/terracotta restyle of six existing screens and a system-font-only approach. The current requirements are the revised [spec.md](spec.md), [contracts/design-system.md](contracts/design-system.md) and [contracts/screen-inventory.md](contracts/screen-inventory.md) (25 reference screens, new public/registration/dashboard/profile screens, font budget instead of system-fonts-only). Regenerate this file with `/speckit-plan` / `/speckit-tasks` before implementing; until then treat conflicting details here as superseded.

**Branch**: `003-frontend-visual-design` | **Date**: 2026-09-18 | **Plan**: [plan.md](plan.md)

## No Data Model Changes

This feature is a **presentation-layer change only** (per spec FR-009 and Assumptions). It restyles existing screens and renders existing 002-capability-assessment data; it adds **no new entities, fields, relationships, or migrations**. All data contracts and their validation live in `specs/002-capability-assessment/data-model.md` and `specs/002-capability-assessment/contracts/`.

## Entities (unchanged, referenced for UI states)

The visual design renders data from these existing 002 entities. Only the fields that drive **visual state** are listed (each maps to a UI treatment):

| 002 Entity     | Fields driving visual state                                                | UI treatment (003)                                   |
|----------------|----------------------------------------------------------------------------|------------------------------------------------------|
| AssessmentAttempt | `status` (`IN_PROGRESS/Paused/etc.`), `sessionCount` (1–4)              | Progress indicator: answered/total + current domain + "session N of 4" (US1.FR-002) |
| Item           | `domain_code`/`domain_name`, order (sections)                              | Section grouping in the question flow                |
| Response/Current | answered vs. total (progress)                                             | Progress bar/fraction visual                        |
| ScoreResult    | `rawScore`, `completenessRate`, `scoreStatus` (`S0…S5/SH`)                | Result cards, one per domain (US1 scenario 3)        |
| QualityFlag    | `flagCode` (Q01–Q09), `disposition` (needs review vs. dispositioned)      | Admin flag badges (icon+label, never color alone)    |
| Report/ReportSection | released sections vs. gated; T11/T12 neutral message                    | Released report layers; distinct neutral treatment   |
| AssessmentVersion | active/retired                                                           | Admin "active version" status chip                   |
| ParticipationControl | pause/stop/reopen state                                                 | Admin participation state chip                       |
| Import (ContentImportRecord) | `status` accepted/rejected + row errors                                | Import outcome + scannable error list                |

**Validation rules**: no new validation; the change must not alter any data, endpoint, or validation from 002 (FR-009 regression requirement).

## State & Message Types (visual contract inputs)

The status treatments must cover these two source buckets:

- **Participant statuses**: normal result / neutral held-under-review (T11/T12) / insufficient data / session-limit warning / validation error on answers.
- **Admin statuses**: import success / import failure with row errors / participation paused|stopped|open / quality flag needs review vs. dispositioned / submission score status.

Mapping to concrete treatment (icon + label + color token) is defined in [contracts/design-system.md](contracts/design-system.md), not here.