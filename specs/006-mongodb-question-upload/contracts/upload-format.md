# Contract: Question Spreadsheet Format (replaces the TECH_READY import format)

**Feature**: 006-mongodb-question-upload | **Spec**: [../spec.md](../spec.md) FR-011…FR-018, FR-021 | **Research**: [../research.md](../research.md) R-M09

The reference file is `docs/Santulan_Sample_Questions.xlsx`. This contract makes it machine-checkable. The previous 13-column workbook without options is **no longer accepted** (`OLD_FORMAT_NOT_SUPPORTED`).

## 1. File

| Rule | Value |
|------|-------|
| Format | `.xlsx` (Office Open XML). Extension and ZIP signature both checked. Macros / external links ignored and never executed. |
| Size | ≤ **2 MB** (`413 UPLOAD_TOO_LARGE`) |
| Sheet | `01_Items`; if absent the **first** sheet is used; other sheets are ignored |
| Header | Row 1, one header row, no merged cells; header names matched **case-insensitively after trimming**, canonical lowercase names below |
| Rows | Row 2 onward, one question per row; **≤ 500** question rows (`TOO_MANY_ROWS`); completely empty rows are skipped with a warning |
| Formulas | A cell that **contains a formula** is refused (`FORMULA_NOT_ALLOWED`); text that merely begins with `=`, `+`, `-` or `@` but is stored as text is kept as plain text (and neutralised again on any export) |
| Encoding | Cell text preserved exactly, including the en dash in `13–17` / `18–25` / `13–25`; leading/trailing spaces trimmed |
| Upload form | `ageGroup` = `ADOLESCENT` (13–17) or `EMERGING_ADULT` (18–25), chosen by the admin, required |

## 2. Columns

The first thirteen are the **unchanged** question fields; `option_1…` are new.

| Column | Required | Rule |
|--------|:-:|------|
| `item_code` | ✔ | `C<1-7>-<2 digits>`, e.g. `C4-02`; unique in the file |
| `assessment_version` | ✔ | the set's label; **identical on every row**; `^[a-z0-9][a-z0-9._-]{2,63}$` |
| `domain_code` | ✔ | `C1`…`C7`; must equal the `C<n>` prefix of `item_code` |
| `domain_name` | ✔ | must match the seven-domain dictionary (see §5) |
| `subdomain_code` | ✔ | one of the 72 canonical codes (e.g. `C1.1`, `C7A.5`); must belong to `domain_code` |
| `subdomain_name` | ✔ | must match the canonical name for that code |
| `item_text` | ✔ | non-empty, ≤ **500** characters |
| `keying` | ✔ | `Positive` (case-insensitive). `REVERSE` and anything else are refused: no approved keying transform exists (`KEYING_NOT_SUPPORTED`) |
| `age_band` | ✔ | `13–17`, `18–25` or `13–25`; must **fit the chosen age group** (adolescent: `13–17`/`13–25`; emerging adult: `18–25`/`13–25`) |
| `context` | ✔ | `General`, `School`, `College/Work` or `Digital`; must **fit the age group** (adolescent: `School`/`General`/`Digital`; emerging adult: `College/Work`/`General`/`Digital`) — the scorer only counts those |
| `layer` | ✔ | `CORE` (`V`, `SJT`, `O` are reserved and refused: `LAYER_NOT_SUPPORTED`) |
| `status` | ✔ | `READY` (anything else refused: `STATUS_NOT_READY`) → stored as `ACTIVE` |
| `display_order` | ✔ | positive whole number, **unique within the file** (gaps allowed; delivery follows ascending order) |
| `option_1`, `option_2`, … | ≥ 2 filled per row | option texts, left to right = order shown to the participant; **up to `option_20`**; blank cells are skipped (the rest keep order); each 1–200 characters, plain text, **distinct within the question** (case-insensitive, trimmed) |

Extra columns not listed here (including `option_21+` with no value) are ignored with a warning `UNKNOWN_COLUMN_IGNORED`; a value in `option_21` or beyond is an error (`OPTIONS_TOO_MANY`).

## 3. Validation

All rows are checked before anything is stored; every problem is reported (first **200** returned, plus the total). A failing file stores **nothing** except one audit row.

### 3.1 File-level codes

`FILE_TOO_LARGE`, `FILE_TYPE_INVALID`, `FILE_UNREADABLE`, `SHEET_NOT_FOUND`, `NO_ROWS`, `TOO_MANY_ROWS`, `HEADER_MISSING_COLUMN` (names the column), `OLD_FORMAT_NOT_SUPPORTED` (no `option_*` columns at all), `AGE_GROUP_REQUIRED`, `VERSION_LABEL_INVALID`, `VERSION_LABEL_INCONSISTENT`.

### 3.2 Row / column codes (each carries `row`, `column`, `code`, `message`)

`REQUIRED_VALUE_MISSING`, `CELL_TYPE_INVALID`, `FORMULA_NOT_ALLOWED`, `ITEM_CODE_INVALID`, `ITEM_CODE_DUPLICATE`, `DOMAIN_CODE_UNKNOWN`, `DOMAIN_NAME_MISMATCH`, `SUBDOMAIN_CODE_UNKNOWN`, `SUBDOMAIN_NAME_MISMATCH`, `SUBDOMAIN_DOMAIN_MISMATCH`, `ITEM_TEXT_TOO_LONG`, `KEYING_NOT_SUPPORTED`, `AGE_BAND_INVALID`, `AGE_BAND_DOES_NOT_FIT_GROUP`, `CONTEXT_INVALID`, `CONTEXT_DOES_NOT_FIT_GROUP`, `LAYER_NOT_SUPPORTED`, `STATUS_NOT_READY`, `DISPLAY_ORDER_INVALID`, `DISPLAY_ORDER_DUPLICATE`, `OPTIONS_TOO_FEW`, `OPTIONS_TOO_MANY`, `OPTION_TEXT_TOO_LONG`, `OPTION_DUPLICATE`.

### 3.3 Warnings (do not block)

`UNKNOWN_COLUMN_IGNORED`, `EMPTY_ROW_SKIPPED`, `DOMAIN_WITHOUT_QUESTIONS` (a domain C1–C7 has no question — see §4).

## 4. Result and lifecycle

| Situation | Outcome |
|-----------|---------|
| Valid file, new label | Draft set created (`status DRAFT`, `participation_state CLOSED`, `revision 1`); `201` with counts and warnings |
| Same label, **identical content** (same canonical hash) | No-op: `200`, `created:false`, existing set returned |
| Same label, **different content**, current revision is `DRAFT` | New `revision + 1` draft; the previous revision becomes `RETIRED`; audited |
| Same label, latest revision `FROZEN` or `RETIRED` | Refused `409 SET_NOT_DRAFT` (use a new label) |
| Any error | `422 UPLOAD_VALIDATION_FAILED` with `details[]`; only an audit row `QUESTION_SET_UPLOAD_REJECTED` is written |

**Freeze prerequisites** (checked at freeze, not upload): the set is `DRAFT`; **every domain C1–C7 has at least one CORE question eligible for its age group** (otherwise scoring could never complete — `409 SET_INCOMPLETE` lists the missing domains); the recomputed `content_hash` matches. **Open prerequisites**: the set is `FROZEN`, and no other set is `OPEN` for the same age group (`409 OPEN_SET_EXISTS`).

## 5. Reference dictionaries

- **Domains** (`domain_code` → `domain_name`): C1 Body & Self-Regulation · C2 Emotional Capability · C3 Relational & Social Capability · C4 Identity & Self-Concept · C5 Values, Purpose & Future Agency · C6 Adaptability & Resilience · C7 Self-Directed Learning & Executive Capability.
- **Subdomains**: the 72 codes and names of `backend/seeders/santulan/reference/framework.json` (generated once from the canonical reference; C4 has C4.1–C4.5, no `C4.6`; C5 has C5.1–C5.7; C7 uses `C7A.n`, `C7B.n`, `C7C.n`).

## 6. Canonical form and hash

The set's `content_hash` is the SHA-256 of the canonical JSON of `[ { item_code, domain_code, subdomain_code, item_text, keying, age_band, context, layer, display_order, options:[{position,text}] } ]` sorted by `display_order` then `item_code`, keys sorted, UTF-8 — independent of column order, spacing, or file bytes. `source_file_hash` is the SHA-256 of the uploaded file bytes (kept for the audit trail).

## 7. Template and conversion

- `GET /api/v1/admin/question-sets/template` returns a generated workbook: the header row plus three example rows with the five standard options, `assessment_version` = `example-adolescent-v1`.
- `scripts/questions-convert-catalog.js` converts the frozen v3.1 catalog (175 + 171 questions) into two files in this format (options `Almost never · Rarely · Sometimes · Often · Almost always`); uploading them yields two draft sets with no validation errors (SC-014).

## 8. Examples

Valid row (from `Santulan_Sample_Questions.xlsx`): `C1-01 | santulan-adolescent-pilot-v3.1 | C1 | Body & Self-Regulation | C1.1 | Interoceptive Awareness | I notice early signs in my body when I am getting tired or stressed. | Positive | 13–25 | General | CORE | READY | 1 | Almost never | Rarely | Sometimes | Often | Almost always | | | | |`

Rejected examples: `keying = REVERSE` → `KEYING_NOT_SUPPORTED`; `subdomain_code = C7.1` → `SUBDOMAIN_CODE_UNKNOWN`; `option_2` = `option_1` text → `OPTION_DUPLICATE`; only `option_1` filled → `OPTIONS_TOO_FEW`; cell `=SUM(A1:A2)` in `item_text` → `FORMULA_NOT_ALLOWED`; an 18–25 question in an adolescent upload → `AGE_BAND_DOES_NOT_FIT_GROUP`.
