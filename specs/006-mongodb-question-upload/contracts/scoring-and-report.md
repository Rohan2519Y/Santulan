# Contract: Scoring, Evidence and Report Generation

**Feature**: 006-mongodb-question-upload | **Spec**: [../spec.md](../spec.md) User Story 8, FR-042…FR-058 | **Source**: `docs/Santulan_Scoring_and_Report_Generation_Layman_Master_Audit_ON_v1_0.docx` (the "scoring master"), BUILD 06, BUILD 07 | **Data model**: [../data-model.md](../data-model.md)

This is the behavioural contract the domain layer (`domain/scoringRules.js`, `qualityRules.js`, `reportRules.js`, `reporting/*`) implements and the tests verify. It replaces the SQL functions `score_attempt`, `build06_*`, `build07_*` of feature 005. Where the scoring master and an earlier build document differ, §11 records the decision.

## 1. Scoring algorithm

```text
scoreAttempt(attemptId, scoringVersion, evidenceConfig, releaseSwitches):          # server/worker only, one transaction
  attempt must be SUBMITTED                                    else stop (INVALID_STATE)
  set = attempt's question set; set must be FROZEN and consistent with the attempt   else stop
  Q06 check: any CURRENT answer whose question belongs to another set?
      → write flag Q06 (HIGH*), attempt → INVALID, stop (no score)                    # *severity ASSUMED, D-11
  latest quality outcome must be CLEAR and no Q06/Q09 flag                            else QUALITY_NOT_CLEAR
  any eligible question with keying REVERSE                                           → fail closed
  for each domain C1…C7:
      eligible = questions of the set: layer CORE, status ACTIVE, domain = D,
                 age_band and context eligible for the set's age group          # never a flat total
      counted  = CURRENT valid answers to those questions (chosen option position p of n options)
      valid    = |counted|; E = |eligible|; E ≥ 1 is guaranteed by the freeze check
      value(p,n) = 1 + (p − 1) × 4 ÷ (n − 1)                                            # n = that question's option count
      status   = INSUFFICIENT           if valid×100 ≤ 60×E
                 INCOMPLETE             if valid×100 ≤ 80×E
                 COMPLETE_WITH_MISSING  if valid < E
                 COMPLETE               otherwise                                        # exact integer arithmetic
      score    = null if INSUFFICIENT else round2( mean of value(p,n) over counted )     # NO imputation
      evidence = S0 if INSUFFICIENT
                 else decideEvidence(domain, status, config, switches)                   # §3
      insert score result (Tier A): score, E, valid, completeness = valid÷E (4 dp), status, evidence, scoringVersion
      if status ∈ {INCOMPLETE, INSUFFICIENT}: raise Q07 for that domain                  # §4
  attempt → SCORING → SCORED   (one transaction; any failure leaves nothing)
  if an approved Q09 exists for the attempt: attempt → QUALITY_HOLD instead of SCORED
```

- **Idempotent**: a second run with the same `scoringVersion` returns the existing set (`ALREADY_SCORED`); a different version on a scored attempt is refused; the unique `(attempt, domain, scoring version)` index is the race guard.
- **No client scores, ever**; the internal endpoint accepts only `{ scoringVersion }`.
- **The response-scale check** of the scoring master ("assessment version and response-scale version must be frozen") is satisfied by the frozen **question set**: options are frozen with their questions (data-model §3.2).

## 2. Boundary table (exact)

| valid ÷ eligible | Missing | Status | Score | Evidence | Example (E = 10) |
|-----------------|---------|--------|-------|----------|------------------|
| 100 % | 0 % | COMPLETE | yes | per §3 | 10 valid |
| > 80 % and < 100 % | > 0 % and < 20 % | COMPLETE_WITH_MISSING | yes (observed answers) | per §3 | 9 valid (90 %) |
| > 60 % and ≤ 80 % | ≥ 20 % and < 40 % | INCOMPLETE | kept, research only | S1 (or SH) — never S2+ | 8 valid (80 %) |
| ≤ 60 % | ≥ 40 % | INSUFFICIENT | none | S0 | 6 valid (60 %) |

Worked check: E = 10, answers `4,3,5,4,4,3,4,5,4` → valid 9, completeness 90 %, sum 36, mean **4.00**, COMPLETE_WITH_MISSING. E = 8, answers `4,4,3,5,4,3,4,5` → 32 ÷ 8 = **4.00**, COMPLETE.

## 3. Evidence state (decided separately from the score)

| State | Meaning | Participant may be told |
|-------|---------|-------------------------|
| S0 | not scored | nothing |
| S1 | research only | no capability conclusion (**default**) |
| S2 | cautious developmental feedback | capability-oriented descriptive wording; no bands, no norms |
| S3 | operational descriptive | validated descriptive wording |
| S4 | norm-referenced | approved bands/percentiles only if intended |
| S5 | longitudinal change | reliable change only when its thresholds are met |
| SH | interpretation held | affected interpretation suppressed |

`decideEvidence`: `SH` if governed configuration holds the domain; else `S1` unless **all** of: release switch **pilot-S2 = ON**, `status ∈ {COMPLETE, COMPLETE_WITH_MISSING}` (completeness > 80 %), and the domain is not held → `S2`. `S3`–`S5` only when the **advanced-evidence** switch is ON *and* governed configuration assigns them; the switch alone never promotes. Per-domain configuration (`EVIDENCE_CONFIG_PATH`, keyed by question-set id) may **hold** (`SH`) or **pin** (`S1`) a domain; it can never promote past what the switches allow.

**Held constructs (interpretation boundary, not deletion)**: Self-Worth `C4.2` and Savoring `C2.10` answers **still count in their domain mean**; participants never see a subdomain score or interpretation; subdomain candidate means exist only in the research-only view `v_candidate_subdomain_scores` (`interpretation_hold = true` for these two).

## 4. Quality flags Q01–Q09

| Code | Meaning | This feature |
|------|---------|--------------|
| Q01 straightlining · Q02 speeding · Q03 long latency · Q04 rapid switching | disengagement signals | **inert** — thresholds are not defined by the sources and are never invented; an approved policy that enables one fails the run closed until an implementation exists |
| Q05 duplicate participation | repeat attempts | **inactive** until a protocol separates invalid duplication from legitimate reassessment (A-15a) |
| Q06 version mismatch | a current answer's question belongs to another set | **hard stop**: no score, attempt `INVALID`, terminal T12 report (BUILD 06 as built in 005) |
| **Q07 missingness cluster** | a domain is INCOMPLETE or INSUFFICIENT | **raised** per such domain (`domain_code` set); severity `LOW` (ASSUMED); review only — never changes scoring or attempt state; idempotent per attempt/domain/code (`uq_quality_flag_logical`) |
| Q08 context/access | opportunity/access concern | governed context process only; never lowers a score |
| Q09 safeguarding | approved external trigger | `CRITICAL`; attempt → `QUALITY_HOLD`; fires P5; never derived from any score; never leaked to participants |

Rules: flags are separate from answers and never rewrite `response_value`; **a low score alone never creates Q09, P3 or P4**.

## 5. Report lifecycle (unchanged from BUILD 07, restated)

```text
attempt SCORED        → begin → PENDING report (one per attempt/version; concurrent begins converge)
render all sections   → store snapshots → complete: report READY + fingerprint, attempt REPORT_READY (same transaction)
render fails          → transaction 1 aborts (no sections persist), transaction 2 marks FAILED_RETRYABLE; attempt stays SCORED
controlled retry      → FAILED_RETRYABLE → PENDING (retry_count + 1, audited, REPORT_RETRY event); same frozen inputs; no retake, no rescore
attempt QUALITY_HOLD  → terminal UNDER_REVIEW, one section: "Your responses are being reviewed."   (identical for every reason)
attempt INVALID       → terminal NOT_ELIGIBLE, one section: "This attempt could not be processed for a report."
```

Participant retrieval: only `REPORT_READY`, `UNDER_REVIEW`, `NOT_ELIGIBLE`; anything else is the same `404 REPORT_NOT_READY`.

## 6. Report composition

| Layer | Content source | At launch | Notes |
|-------|----------------|-----------|-------|
| PROFILE | score results (§7) | visible | always produced; chart payload + per-domain neutral score/status/completeness |
| MEANING · PATTERN · STRENGTH · GROWTH | controlled wording (§8) | visible | only for domains at S2+; cautious, non-causal, non-deficit, no trait labels |
| CHANGE | controlled wording | visible | only when an **earlier** scored attempt exists; descriptive, no improvement claim until reliable-change evidence |
| PRIORITY · ACTION | controlled wording / active library actions | **hidden** | generated and stored; `development release` switch gates release |
| Growth plan · Pathways P1–P4 | growth/pathway engines | **hidden** | `development release` / `pathway release`; **P5 never depends on either** |
| UNDER_REVIEW (T11) · NOT_ELIGIBLE (T12) | fixed strings | visible | one section each |

**Template map (Development & Reporting master)**: T01 domain result (neutral score/status/completeness) → PROFILE; T02 → MEANING; T03 → PATTERN; T04 → STRENGTH; T05 → GROWTH; T06 reflection (unscored prompt, reference content); T07/T08 → ACTION; T09 → review (unscored); T10 → CHANGE; T11/T12 as above.

## 7. PROFILE payload (stored as the exact section text)

```json
{ "scale": { "min": 1, "max": 5 },
  "context": { "questionSet": "<version_label>", "revision": 1, "developmentalBand": "D2", "assessedOn": "YYYY-MM-DD" },
  "domains": [
    { "code": "C1", "name": "Body & Self-Regulation", "display": "PLOTTED",
      "score": 3.5, "completeness": 0.9, "completenessStatus": "COMPLETE_WITH_MISSING" },
    { "code": "C2", "name": "Emotional Capability", "display": "NOT_ENOUGH_DATA", "score": null,
      "completeness": null, "completenessStatus": null, "message": "Not enough data yet" }
    /* exactly seven entries, C1…C7, fixed order */
  ] }
```

- `PLOTTED` only when a score exists **and** the evidence state permits showing it (S2+). Otherwise `NOT_ENOUGH_DATA` with the message "Not enough data yet" — used for INSUFFICIENT domains (the master's copy) and, as an ASSUMED reuse until the owner supplies report copy, for research-only or held domains. **Never plotted at the scale minimum**, never a benchmark, never a band.
- The context snapshot carries no name, date of birth, contact or route; `assessedOn` is the attempt's submission date.
- Deterministic: keys in the order shown, scores fixed to two decimals; the same inputs give the same text.

## 8. Controlled wording — exact match, fail closed

Wording is a row of `interpretation_rules` with `status = APPROVED`, keyed by **(question set, domain, developmental band, evidence state, locale, layer)**.

```text
for each domain with evidence ∈ {S2, S3, S4, S5} and status ∈ {COMPLETE, COMPLETE_WITH_MISSING}:
  for each descriptive layer L ∈ {MEANING, PATTERN, STRENGTH, GROWTH} (+ CHANGE when applicable):
      candidates = approved rules with (set, domain, evidence, locale, layer = L)
                   and (band = participant's band  or  band = null)
      effective  = the band-specific rule if present, else the band-less rule
      if effective does not exist                 → FAIL CLOSED: the whole report generation fails (FAILED_RETRYABLE), nothing invented
      snapshot   = effective.approved_text_template, content_version = effective.version, locale
domains at S0 / S1 / SH / INCOMPLETE / INSUFFICIENT: no interpretation, no failure
```

- **Uniqueness (store-enforced)**: unique partial index `uq_one_approved_rule_per_dimension` on `(assessment_version_id, domain_code, developmental_band, evidence_state, locale, layer)` where `status = APPROVED` — two approved wordings for one exact dimension cannot exist. A band-specific and a band-less wording may coexist (the D1 plain-language variant policy); the band-specific one wins.
- **Fail closed replaces feature 005's silent skip** (§11 d): with the default switches (S1) no interpretation is attempted, so an empty content library is safe; the moment governance turns S2 on, every S2 domain needs its approved wording.
- Prescriptive layers (PRIORITY/ACTION) follow the same exact-match rule but are generated only when their wording exists and never fail the descriptive report; their absence is not an error (they are hidden).
- **Content is per question set**: because wording is keyed to the set id, each newly uploaded and frozen set needs its own approved wording before S2 can be enabled for it (operational note in the quickstart).

## 9. Snapshots and fingerprint

Each section is stored exactly as shown (`content_snapshot`, `content_version`, `locale`, `display_order`, `section_type`, `domain_code`); only `is_released_to_participant` may change afterwards. On completion the report stores `content_hash` = SHA-256 of the canonical JSON array `[ { section_type, domain_code, content_version, locale, display_order, content_snapshot } … ]` in `display_order`; UNDER_REVIEW / NOT_ELIGIBLE hash their single section. Reproducibility (RC-11 / AT-19): identical frozen inputs and content versions ⇒ identical sections and identical `content_hash`. An old report is never rebuilt from today's wording.

## 10. Release switches (default OFF) and participant exposure

| Switch | Gates | Endpoint (Super Admin) |
|--------|-------|------------------------|
| `pilotS2` | promotion of ordinary domains from S1 to S2 | `GET /admin/release-flags`, `POST /admin/release-flags/{flag}` body `{ value: boolean, reason }` |
| `advancedEvidence` | any S3–S5 state | same |
| `developmentRelease` | release of PRIORITY/ACTION sections, growth-plan visibility | same |
| `pathwayRelease` | participant rendering of P1–P4 (P5 exempt) | same |

Stored as `RELEASE_FLAG_CHANGED` audit events (`new_state {flag, value}`, reason, actor); the latest event per flag decides; none ⇒ OFF; an unrecognised value ⇒ OFF (fail closed); the change and its audit row are one transaction. No frontend toggle exists.

Participant exposure: **no score endpoint outside the released report** — feature 005's `GET /attempts/{id}/scores` is withdrawn (api-delta §2); the seven-axis chart is read from the PROFILE section of `GET /reports/{id}`. Reports, exports and responses pass the claims scanner (no subdomain score, Low/Average/High, percentile, norm, reliable-change, diagnostic or personality claim, no attention-disorder or intelligence inference from C7, no "toughness"/silent-endurance framing of resilience).

## 11. Discrepancy log (scoring master vs earlier documents)

| # | Topic | Earlier | Scoring master | Decision |
|---|-------|---------|----------------|----------|
| a | Q05 | BUILD 06 audit: needs a protocol; inert in 005 | RC0 warns when another submitted attempt exists | keep **inactive** until the protocol exists (A-15a) |
| b | Q07 | not built in 005 | RC0 warns at completeness ≤ 80 % | **adopt** (deterministic from the exact boundary; LOW; no state change) |
| c | Missing wording at S2 | 005: section skipped silently | report generation **fails closed** | **adopt** fail closed |
| d | Exactly 60 % complete | BUILD 01 §7: raw score allowed at 60 % | INSUFFICIENT at ≤ 60 % (RC0 remediation) | **follow the master** (stricter) |
| e | Stored counts/status/fingerprint | BUILD 01 has no such columns | `score_results` "stores item counts…"; complete report "stores SHA-256 content hash"; BUILD 08 export wants valid/eligible counts | **add** `eligible_items`, `valid_items`, `completeness_status`, `reports.content_hash` (change record, data-model §9) |
| f | Evidence default | per-domain config, missing ⇒ S1 | global `allow_pilot_s2` OFF ⇒ S1 | **both**: switch OFF ⇒ S1; ON ⇒ S2 unless held/pinned |
| g | Participant score endpoint | 005 returned S2+ scores | no raw research score endpoint before the authorised report | **withdraw** the endpoint |
| h | Report composition | 005 renderer built all layers | RC0 worker builds only PROFILE + MEANING (a gap) | keep the **full descriptive composition** (FR-054) |

## 12. Test matrix (the master's §18, mapped)

| Master test | Expected | Matrix IDs |
|-------------|----------|------------|
| known clean vector | exact means (n = 2, 3, 5, 9, 20) | B06 arithmetic |
| 100/90/80/60 % boundaries | COMPLETE / COMPLETE_WITH_MISSING / INCOMPLETE / INSUFFICIENT exactly | B06-011…015 |
| missing answers | never imputed | B06 |
| answer revision | only current counts | B06-025 |
| cross-version response | Q06, scoring stops | B06-019, B06-022 |
| S1 result | no capability conclusion | B06-039, B07-026 |
| S2 + no approved wording | report fails closed | new (B07-028 family) |
| S2 + one approved wording | correct snapshot stored | B07-027 |
| two approved wordings, same dimension | second refused (unique index) | new (G-28) |
| forced render failure | FAILED_RETRYABLE, attempt SCORED | B07-004, RC-09 |
| controlled retry | no retake/rescore | B07-005, RC-12 |
| QUALITY_HOLD | identical T11 | B07-009…011, RC-10 |
| INVALID | T12 safe message | B07-013 |
| Q09 | no score conversion; P5 separate | B06-051, B07-058…060 |
| radar, insufficient domain | "Not enough data yet", never 1 | B07-035 |
| participant API | no score before the released report | new (SEC/AT) |
| switches | all OFF by default; audited | new |
