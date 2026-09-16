# CSV Schema Contract: `mcq_template.csv`

**Branch**: `001-assessment-service` | **Date**: 2026-09-16 | **Spec**: [../spec.md](../spec.md)

## File Contract

- Uploaded by an admin via `POST /api/v1/admin/assessments/upload` (see [api.md](api.md)).
- UTF-8 encoded, RFC 4180 (fields may be quoted, commas inside quotes supported).
- Single header row; one question per data row.
- Max file size: 1 MB; max 200 questions per file.

## Columns

| Column        | Required | Type    | Rule                                                   |
|---------------|----------|---------|--------------------------------------------------------|
| `question`    | yes      | string  | non-empty, ≤ 500 chars (FR-013)                        |
| `option_a`    | yes      | string  | non-empty, ≤ 300 chars                                 |
| `option_b`    | yes      | string  | non-empty, ≤ 300 chars                                 |
| `option_c`    | yes*     | string  | non-empty if present, ≤ 300 chars                      |
| `option_d`    | yes*     | string  | non-empty if present, ≤ 300 chars                      |
| `option_e`    | no       | string  | non-empty if present, ≤ 300 chars                      |
| `option_f`    | no       | string  | non-empty if present, ≤ 300 chars                      |
| `answer`      | yes      | string  | one of `a`–`f` (case-insensitive), must reference an existing option exactly once per row (FR-014) |
| `mandatory`   | no       | boolean | `true`/`false`; default `true` (FR-003)                |

\* `option_c` and `option_d` are required only if any question in the file uses more than two options. Validation requires **2–6 options** per question and **exactly one** `answer`.

## Validation Errors (FR-014, SC-006)

Errors are reported per row with column names; examples:

| Row | Column   | Message                                                   |
|-----|----------|-----------------------------------------------------------|
| 1   | (header) | Missing required column 'question'                        |
| 3   | answer   | Question must have exactly one correct option             |
| 5   | option_c | Empty option present (rows 5)                             |
| 7   | question | Question text is required                                 |

A file with **zero valid rows** (empty file or all rows invalid) is rejected as `CSV_VALIDATION_FAILED`.

## Example File

```csv
question,option_a,option_b,option_c,option_d,answer,mandatory
What is H2O?,Water,Salt,Acid,Base,a,true
Largest planet?,Earth,Mars,Jupiter,Venus,c,true
Capital of France?,London,Paris,Rome,Madrid,b,false
```

Interpretation:
- Row 1 → Question "What is H2O?" with 4 options; correct = option_a "Water"; mandatory.
- Row 2 → Question "Largest planet?"; correct = option_c "Jupiter"; mandatory.
- Row 3 → Question "Capital of France?"; correct = option_b "Paris"; NOT mandatory.

## Notes

- `answer` values must exist among the row's non-empty options (`a`–`f`).
- Rows are assigned `sort_order = 1..N` in file order (FR-002); options get `sort_order = 1..M` per question.
- A header row is mandatory; first row is always treated as the header.