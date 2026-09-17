# Item Pool Schema Contract: TECH_READY xlsx

**Branch**: `002-capability-assessment` | **Date**: 2026-09-17 | **Spec**: [../spec.md](../spec.md)

Source files: `docs/Santulan_Adolescent_Items_TECH_READY.xlsx` (175 items) and `docs/Santulan_EmergingAdult_Items_TECH_READY.xlsx` (171 items). The `00_ReadMe` sheet of each file defines the import contract; this document makes it machine-checkable.

## File Contract

- Uploaded by an admin: `POST /api/v1/admin/assessments/import` (see [api.md](api.md)).
- `.xlsx` (Office Open XML). Max file size: 2 MB; max 250 items per file (err on tolerance above the 175/171 pools).
- The file MUST contain a `01_Items` sheet with a single header row on row 1; the first sheet may be used as the items sheet.
- One item per data row. Row 1 **is** the header (SheetJS `sheet_to_json` behavior — research §3).
- `assessment_version` in the file MUST match one of the two allowed pilot values exactly: `santulan-adolescent-pilot-v1.0` or `santulan-emergingadult-pilot-v1.0`.

## Columns

| Column              | Required | Type       | Rule                                                        |
|---------------------|----------|------------|-------------------------------------------------------------|
| `item_code`         | yes      | string     | dash notation `D`-`NN` (e.g. `C4-02`); unique within file    |
| `assessment_version`| yes      | string     | one of the two pilot version labels above                    |
| `domain_code`       | yes      | string     | one of `C1`–`C7`                                             |
| `domain_name`       | yes      | string     | must match C1–C7 reference names (see **Domains** below)     |
| `subdomain_code`    | yes      | string     | period notation `Cx.N` (e.g. `C4.2`)                         |
| `subdomain_name`    | yes      | string     | non-empty                                                    |
| `item_text`         | yes      | string     | non-empty, ≤ 500 chars                                       |
| `keying`            | yes      | string     | `Positive` (or `REVERSE`); case-insensitive                  |
| `age_band`          | yes      | string     | `13–25` (General) \| `13–18` \| `18–25`                      |
| `context`           | yes      | string     | `General` \| `School` \| `College/Work`                      |
| `layer`             | yes      | string     | `CORE` (V/SJT/O accepted for forward-compat, not active)     |
| `status`            | yes      | string     | `READY` → stored as `ACTIVE`; any non-READY is rejected      |
| `display_order`     | yes      | integer    | unique within file, ≥ 1; provided sequence (grouped by domain) |

## Domains (C1–C7 reference)

| Code | Name                                      |
|------|-------------------------------------------|
| C1   | Body & Self-Regulation                    |
| C2   | Emotional Capability                      |
| C3   | Relational & Social Capability            |
| C4   | Identity & Self-Concept                   |
| C5   | Values, Purpose & Future Agency           |
| C6   | Adaptability & Resilience                 |
| C7   | Self-Directed Learning & Executive Capability |

## Validation Errors (FR-013, SC-004)

Errors are reported per row with the failing column; examples:

| Row | Column              | Message                                            |
|-----|---------------------|----------------------------------------------------|
| 1   | (header)            | Missing required column 'domain_code'              |
| 4   | domain_code         | Unknown domain code 'C9'                           |
| 7   | item_code           | Duplicate item_code within file                    |
| 9   | item_text           | Item text is required                              |
| 11  | assessment_version  | Unsupported version; expected one of the two pilot labels |
| 13  | status              | Item status must be READY to import                |
| 15  | display_order       | display_order must be a positive integer           |

An import with **zero valid rows** or a version label duplicate of an already-FROZEN version is rejected as `ITEM_POOL_VALIDATION_FAILED`. Re-importing an identical frozen version by its own label is a no-op upsert (research §3) and does not create a new version.

## Notes

- The file's own `00_ReadMe` governs: `layer = CORE` only is active in pilot; `display_order` is provided so the player renders without recomputing order; item text is frozen once the version is live (a change requires a new frozen version — FR-017/`V01`).
- The adolescent and emerging-adult pools MUST NOT be mixed in one assessment version (spec Assumptions).
- Cell `date` handling is a no-op here (all columns are text/integer; SheetJS `cellDates` not required).