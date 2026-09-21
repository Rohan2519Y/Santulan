# Dedicated local MongoDB instance (T008, 2026-09-20)

Command: `npm run db:local:init -- --write-env`, then `npm run db:local:status`.

Non-secret output of `npm run db:local:status`:

```
port 27018: listening
setName: rs0
state: PRIMARY
authorization: enabled
```

- Config, data, keyFile, log and pid file live in the git-ignored `backend/.mongo/`.
- Users: `root_admin` (admin, root; password printed once at init and not stored), `santulan_migrator` (dbOwner on `santulan` and `santulan_qual`), `santulan_runtime` (no roles until migration 004 grants the least-privilege role). Credentials for the last two are in the git-ignored `backend/.env`.
- The existing `MongoDB` Windows service on 127.0.0.1:27017 was **not** modified: `Get-Service MongoDB` still reports `Running` on port 27017, and `scripts/mongo-local.js` refuses port 27017.
- No Docker.
