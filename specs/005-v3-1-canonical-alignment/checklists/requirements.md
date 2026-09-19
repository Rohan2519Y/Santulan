# Specification Quality Checklist: v3.1 Canonical Alignment

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-19 | **Revised**: 2026-09-19
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details beyond the contract-mandated database objects (the SanTulan 2.0 contracts *are* the requirement source; named objects come from BUILD 01–09)
- [x] Focused on user value and business needs
- [x] Written so non-technical stakeholders can follow the stories; contract detail is confined to FRs and tables
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain (open items recorded as decisions D-01…D-07 with an applied default)
- [x] Requirements are testable and unambiguous (each story cites its BUILD test matrix: T03 28, T04 36, B05 45, B06 60, B07 80, B08 84, AT/RC 44, SEC 30)
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic where possible
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded (legacy platform untouched; no plan/tasks/implementation in this revision)
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows (catalog, registration, consent, sign-in/roster, delivery, scoring, reporting, admin/research, security/launch, UI)
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] Source discrepancies between documents are recorded, not silently resolved

## Source Coverage (revision 2026-09-19)

- [x] BUILD 00–09 contracts, manifests and audit workbooks read; RELEASE_01 workbook and runbook read
- [x] Source workbooks read: Pilot 1.2 ERD master, Development Reporting master v1.1, both v3_0 item pools, combined pool, BUILD 02 canonical rows
- [x] Images read: `Final.jpeg`, `image.png`, `WhatsApp Image…jpeg`, and all 25 UI samples
- [x] Sample institutional roster read (194 rows: 2 aged 12, 3 aged 18)

## Notes

- Verified by diff: the on-disk v3_0 pools differ from the v3.1 canonical rows in exactly 4 rows per form (C4.5→C4.4, C4.6→C4.5). The earlier draft's claim that v3_0 already carried legal C4 codes was wrong and is corrected.
- Not verifiable from disk: the `…_v3_1.xlsx` files and their SHA-256 hashes, and every `*_SQL_Package_*.zip` / OpenAPI file named in the manifests. Conformance is by catalog reconciliation; SQL must be derived from the contract text.
- Blocking governance gates are owned outside engineering (legal consent copy, Q09 workflow, evidence-state approval, report copy, response-scale sign-off, official launch runbook). The pilot decision remains NO-GO until they close.
