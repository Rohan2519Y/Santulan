# Catalog Import Contract: v3.1 Canonical Alignment (005)

**Branch**: `005-v3-1-canonical-alignment` | **Date**: 2026-09-19 | **Research**: [../research.md](../research.md) R-05 | **Source**: BUILD 02 (Assessment Catalog & Item Import v3.1)

How the two v3.1 item banks reach `santulan.items` and how they are proven correct.

## 1. Sources actually available

| Role | File | Use |
|------|------|-----|
| **Import source (canonical rows)** | `docs/Santulan 2.0/BUILD_02_…/Santulan_BUILD_02_Assessment_Catalog_and_Item_Audit_v3_1.xlsx` sheets `03_ADOL_CANONICAL` (175), `04_EA_CANONICAL` (171), `01_ASSESSMENT_CATALOG`, `06_SUBDOMAIN_COVERAGE` | generates the normalized CSVs |
| Cross-check | `docs/Santulan 2.0/Santulan_Adolescent_Items_TECH_READY_v3_0.xlsx`, `…EmergingAdult…_v3_0.xlsx` | must differ from the source **only** in the 4 subdomain codes per form (`C4-10`, `C4-11`/`C4-12`, `C4-13`, `C4-14`/`C4-15`: `C4.5→C4.4`, `C4.6→C4.5`) |
| Audit reference only | `Santulan_PILOT_READY_Item_Pool_v3_0.xlsx` (222 rows) | never imported as an administration version |
| **Not on disk** | `…_TECH_READY_v3_1.xlsx`, `*_Import_Package_v3_1.zip`, `normalized/*.csv` | their roles are replaced by the generated CSVs; their SHA-256 values are recorded, not verifiable |

## 2. Normalized CSV files (`backend/seeders/santulan/`)

| File | Rows | Columns |
|------|------|---------|
| `assessment_catalog_v3_1.csv` | 2 | `assessment_version_id, version_label, configuration, participant_min_age, participant_max_age, response_scale_version, content_hash, source_file_hash, status, participation_state` |
| `adolescent_items_v3_1.csv` | 175 | `version_label, item_code, domain_code, domain_name, subdomain_code, subdomain_name, item_text, source_keying, keying, age_band, context, layer, pilot_status, display_order, item_content_hash` |
| `emergingadult_items_v3_1.csv` | 171 | same |
| `canonical_subdomain_reference_v3_1.csv` | 72 | `domain_code, subdomain_code, subdomain_name` |
| `response_scale_v3_1.json` | 1 | version, points, anchor labels (1 Almost never … 5 Almost always), keying definition, content hash — `DRAFT` |
| `MANIFEST.json` | — | file SHA-256 of each CSV, generation tool version, workbook SHA-256 (computed from the file on disk), derivation rule for `item_id` |

CSV rules: UTF-8, LF, no BOM; `item_text` byte-exact (no trimming, quote handling only); the en dash in `13–17` / `18–25` / `13–25` preserved; generation is deterministic and re-runnable (`scripts/catalog-generate-csv.js`), and a unit test regenerates and compares byte-for-byte.

## 3. Field mapping (BUILD 02 §7)

| CSV | DB | Transformation | Validation |
|-----|----|----------------|------------|
| `version_label` | `assessment_versions.version_label` | none | equals frozen v3.1 label |
| `item_code` | `items.item_code` | none | unique within version |
| `domain_code` / `subdomain_code` / `subdomain_name` | same | none | canonical 7-domain / 72-subdomain map; **no `C4.6`; C4 only C4.1–C4.5; C5 items C5.1–C5.7** |
| `domain_name` | *(not stored)* | validation only | matches the seven-domain dictionary |
| `item_text` | `items.item_text` | none | exact |
| `keying` | `items.keying` | `Positive → POSITIVE` only | anything else aborts |
| `age_band`, `context`, `layer` | same | none | allowed sets; layer must be `CORE` |
| `pilot_status` | `items.pilot_status` | verbatim (READY-family label kept) | — |
| — | `items.status` | constant `ACTIVE` | — |
| `display_order` | `items.display_order` | integer | unique and contiguous `1..N` per version |
| `item_content_hash` | `items.item_content_hash` | verbatim | 64 hex characters |
| — | `items.item_id` | UUIDv5(`namespace`, `assessment_version_id:item_code`) | namespace recorded in `MANIFEST.json` (D-08) |

## 4. Modes

| Mode | Behaviour |
|------|-----------|
| `verify` (offline) | No DB. Checks CSV hashes vs `MANIFEST.json`, row counts (175/171), uniqueness, contiguity, 72-subdomain coverage per form, 124 shared codes with identical text/subdomain, legality (no `C4.6`, C5 codes), allowed sets, keying, hash format, and the v3_0 cross-check (exactly 4 code diffs per form) |
| `reconcile` (default) | Requires 28 tables and both versions `DRAFT`/`CLOSED`. Compares every canonical field for every row **by `(version_label, item_code)`**. Exact match ⇒ no-op (never `UPDATE`). Any difference, extra DB row, or missing row ⇒ fail + full rollback. Writes one `audit_logs` event with a stable correlation ID and the manifest hash. Emits a receipt |
| `apply` | As reconcile, but may **insert** missing rows only while the version is `DRAFT`/`CLOSED` **and** zero attempts reference it; records inserted `item_id`s in the receipt. Never used in CI against a shared DB |
| `rollback-from-receipt` | Deletes only receipt-recorded inserted IDs, only while `DRAFT`/`CLOSED` and zero attempts |

All modes run under a controlled technical role (owner / `SYSTEM` context), never a participant credential; they read no participant data; failure output names `item_code` and the differing field, not the bank.

## 5. Receipt (`catalog_receipt_<timestamp>.json`)

`mode`, `startedAt`, `finishedAt`, `dbServerVersion`, `migrationRevision`, `manifestSha256`, per-version `{label, expectedRows, dbRows, insertedIds[], noop: n}`, `checks: {name, result}[]`, `derivation: {itemIdNamespace}`, `operator`, `exitCode`. Retained as release evidence (B02 §18).

## 6. Acceptance (T-B02-001…020 + AT-B00-06/07/08)

| Check | Expected |
|-------|----------|
| Rows | 175 / 171; combined unique 222; shared codes 124; zero shared text/construct mismatch |
| Subdomains | 72 in each form |
| Domains | A: 24/24/24/10/14/20/59 · EA: 23/21/24/10/14/20/59 |
| Age-band-specific rows | 51 (`13–17`) · 47 (`18–25`); 124 shared `13–25` |
| Context | A: General 123, School 50, Digital 2 · EA: General 123, College/Work 46, Digital 2 |
| Pilot status | A: READY 152 / POST-PILOT PRIORITY 21 / FIRST DRAFT 2 · EA: 146 / 23 / 2 |
| Idempotency | second `reconcile` ⇒ 0 inserts, 0 updates |
| Negative | injected duplicate code, order gap, changed text, missing row, extra row, opened version, attempt-bearing apply ⇒ each fails as listed in BUILD 02 §20 |
| Release guard | both versions still `DRAFT`/`CLOSED`; scale `DRAFT` |
