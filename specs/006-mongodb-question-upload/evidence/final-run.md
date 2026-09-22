# Final run (T174)

**Date**: 2026-09-22 · **Machine**: Windows, MongoDB 8.0.10 dedicated instance on 127.0.0.1:27018, replica set `rs0`, authorization on.

## Backend — `npm run test:santulan`

```
Test Suites: 78 passed, 78 total
Tests:       1 skipped, 847 passed, 848 total
```

The one skip is the documented `RUN_LOAD` informational case (B05-039: a burst-save timing measurement, not a pass/fail gate —
see `quickstart-results.md` §8). No other test is skipped. This includes, newly in this pass:

- `tests/santulan/integration/e2eJourney.test.js` — the T172 continuous journey (register → self-consent → upload/freeze/open →
  answer → submit → score → report → admin export), acceptance 3 and 4 (immutability, isolation) asserted inline.
- The CR-006-12 (delete a draft set) and CR-006-13 (adult self-consent) contract tests in `questionSetsLifecycle.test.js` and
  `consent.test.js`.
- The previously owner-deferred US5/US6/US7 suites: `researchExport.test.js`, `claims.test.js`, `isolation.test.js`,
  `abuse.test.js`, `platform.test.js`, `atRcTraceability.test.js`, `questionsConvert.test.js`, `repoClean.test.js`,
  `setupFromScratch.test.js`.

Two real bugs were found and fixed while getting to this result, both in operational scripts rather than the core
store/service code:

1. `scripts/export-synthetic.js` generated an `item_code` that did not match the store validator's `^C[1-7]-[0-9]{2}$` pattern
   (fixed: per-domain numbering, C7's `C7A.1`-style subdomain naming).
2. `scripts/backup-restore-drill.js` had two bugs that had never been exercised end to end before this pass: its own default
   restore-target name (`santulan_restore_drill`) did not satisfy its own scratch-database-name check, and `mongodump`/
   `mongorestore` were called with a URI that already named a database (`/santulan`) *and* a separate `--db`/namespace flag,
   which the CLI tools reject or silently no-op on (0 documents restored, no error). Both fixed; see the three earlier FAIL
   evidence files under `backend/release/evidence/` alongside the final PASS one for the debugging trail.

A third bug, in the frontend (not this section, see below): the delete-confirmation dialog and the page both rendered the same
error message when a delete was refused, because both read the same shared `problem` state. Fixed by suppressing the page-level
render while the delete dialog is open.

## Backend — T161 backup/restore drill

```
npm run drill:backup-restore
```

**PASS** — `backend/release/evidence/backup-restore-2026-09-22T11-51-09-803Z.json`: mongodump (gzip archive, SHA-256
`2e8512221596b189bba104f001deadca9773ce6e208884ba75cfdd70108bf92c`) → clean the restore target → mongorestore → recreate the
least-privilege role → `db-verify` on the restored copy → the store-guarantee suite → one end-to-end journey (attempt, answers,
submit, quality, score, report) on the restored copy. Every step PASS. Source `santulan_qual`, target
`santulan_restore_drill_scratch` (both scratch databases; the drill never touches `santulan`).

## Frontend

```
npm test               -> Test Suites: 17 passed, 17 total ; Tests: 181 passed, 181 total
npm run check:contrast -> 156 pair checks (light and dark themes) meet WCAG 2.1 AA
npm run build          -> Compiled successfully (132.31 kB main.js gzip, 18.81 kB main.css gzip)
```

Includes, newly in this pass: `src/tests/selfConsent.test.js` (7 tests, CR-006-13) and three new CR-006-12 delete-flow tests in
`adminDashboard.test.js`.

## Evidence register coverage (`backend/tests/santulan/evidence/register.json`)

`tests/santulan/security/atRcTraceability.test.js` passes all four of its checks: every one of the 102 canonical matrix ids
(AT-01…32, RC-01…12, SEC-01…30 except SEC-15, G-01…29) has an entry; no id is `PASS` without a `file` that exists on disk and a
`runAt`; no unknown matrix id is present; no `PASS` for a required id points outside `tests/santulan/**`. 239 entries total: 182
`PASS`, 54 `NOT_EXECUTED` (staging-only checks — TLS/at-rest evidence and the AT/RC/SEC ids that need a staging application, per
`launch-gates.md`), 2 `INFORMATIONAL`, 1 `SKIPPED` (the documented `RUN_LOAD` case). No gate was changed from `NOT_EXECUTED`
without real evidence.

## Result

0 unexpected failures across backend, frontend, contrast and build. Launch status remains **NO-GO**: the 54 `NOT_EXECUTED`
staging-only ids and `launch-gates.md` E1–E11 are outstanding by scope (they need a staging application), not because of any
defect found in this run.
