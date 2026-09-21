# Backup and restore drill — evidence (feature 006)

Fill this in (or attach the JSON written by `npm run drill:backup-restore`) for every drill. A drill is evidence only for the
database it restored **and** the date it ran; a later schema or data change needs a new drill.

| Field | Value |
|-------|-------|
| Operator | |
| Host | |
| Date and time (start – finish) | |
| Source database | |
| Restore target (scratch) | |
| Archive SHA-256 | |
| MongoDB version / tools version | |
| Result | PASS / FAIL |

## Steps

| # | Step | Result | Notes |
|---|------|--------|-------|
| 1 | `mongodump` of the source database (gzip archive) | | |
| 2 | Clean scratch restore target | | |
| 3 | `mongorestore` into the target (`--nsFrom` / `--nsTo`) | | |
| 4 | Least-privilege role recreated for the restored database | | |
| 5 | `db-verify` on the restored copy (27 collections, 9 views, 50 indexes, hashes, one current answer per question…) | | |
| 6 | Store-guarantee suite on the restored copy | | |
| 7 | End-to-end journey on the restored copy (attempt → answers → submit → quality → score → report) | | |

## Recovery objectives (RPO / RTO)

The drill shows the mechanics work; it does **not** set the objectives. RPO and RTO are open governance items
(`launch-gates.md`). Record the measured restore duration here as an input to that decision:

- Backup duration: 
- Restore duration: 
- Data size (documents / MB): 

## Sign-off

`Owner: TODO(GOVERNANCE_OWNERS)` — a gate is not passed on this page; it is passed only when the owner records it in `launch-gates.md`.
