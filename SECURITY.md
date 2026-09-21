# Security notes for operators

Santulan holds data about minors. Treat everything below as required practice, not advice. Governance decisions (consent copy, the
safeguarding workflow, retention, RPO/RTO) belong to the owners and are listed in
`specs/006-mongodb-question-upload/evidence/launch-gates.md`.

## Secrets and credentials

- **`INTERNAL_API_KEY`** guards the worker and verifier endpoints. Use a long random value, keep it out of source control, and **rotate
  it** whenever someone with access leaves or it may have been exposed: change the value in the environment, restart the API and
  update every caller. Leave it empty to disable service access (a Super Admin token still works).
- **`JWT_SECRET`** signs sessions. Never keep the development default outside a developer machine. Rotating it signs everyone out.
- **MongoDB credentials.** There are two and they must stay apart:
  - `MONGODB_URI_RUNTIME` (least privilege: cannot remove data, cannot change the schema) is the only one the API and workers may have.
  - `MONGODB_URI_ADMIN` (the migrator) is for migrations, seeding, verification and tests. **It must never be in the API's
    environment.** The API does not read it.
  Keep both out of source control (`backend/.env` is git-ignored) and out of logs, tickets and chat.
- **`backend/.mongo/keyfile`** is the replica-set internal authentication key of the local instance. Custody: the operator account
  only; never commit it (it is git-ignored); regenerate it if it leaks. In a production deployment use the platform's own secret store
  and TLS between members.
- The local instance listens on **127.0.0.1:27018** only. Do not expose it. The `MongoDB` service on 27017 belongs to other work and is never touched.

## Data at rest and in transit

- Keep **`EXPORT_DIR`** (research exports) on **encrypted storage** with access limited to the operator account. Exports contain no
  names or contact details, but they are still research data about minors.
- Treat **`mongodump` archives as participant data.** Store them encrypted, restrict access, delete them when the recovery point is
  no longer needed, and never attach them to tickets. The drill (`npm run drill:backup-restore`) writes only an evidence file; its
  temporary archive is deleted when it finishes.
- Use TLS for the API and for MongoDB in any shared or production environment; the local development instance does not.
- Personal data lives in the managed identity provider, not in this database. OTPs, temporary passwords and credential files are
  **never logged outside development**; the development identity adapter is refused in production.

## Operating the platform safely

- **Audit is mandatory.** A privileged change succeeds only together with its audit row. If auditing fails the operation is refused
  (`503 AUDIT_UNAVAILABLE`); do not work around it.
- **Release switches** (`pilotS2`, `advancedEvidence`, `developmentRelease`, `pathwayRelease`) are all OFF by default. Turn one on only
  with the owner's recorded approval; the reason you enter is part of the audit trail.
- **Quality review** is the only place safeguarding-related flag detail appears. Give access to people who need it, and follow the
  approved safeguarding workflow (an owner decision, still open).
- **Suspending** a participant or admin takes effect on their next request.
- The in-memory registration throttle protects one process. Run a **shared store** before running more than one API instance.
- After restoring a backup, re-run `npm run db:verify` and recreate the runtime role (the drill does this) before pointing the API at it.

## Reporting a problem

Report suspected exposure of participant data, credentials or exports to the project owner immediately, before investigating further.
