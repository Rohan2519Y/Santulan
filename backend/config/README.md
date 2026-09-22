# Governed configuration

Files here are **templates**. Real values need the approvals named below; nothing in this repository invents them.

## `quality-policy.example.json` → `QUALITY_POLICY_PATH`

```json
{ "version": "q06-only", "detectors": {} }
```

- No file, or this template: only **Q06** (version mismatch, deterministic) runs. Q09 is fired only through the internal
  safeguarding endpoint and only for trigger sources listed under `detectors.Q09.approvedTriggerSources`.
- `Q01`–`Q04` and `Q07` need **empirically approved thresholds** (BUILD 06 audit B06-AUD-006); `Q05` needs a **protocol
  definition** separating invalid duplication from legitimate reassessment (B06-AUD-007); `Q08` needs approved
  context/access signals (B06-AUD-008); `Q09` needs approved trigger content and the human escalation workflow
  (B06-AUD-009). Their detectors are inert stubs: **enabling one in this file makes the quality run fail closed**
  until an approved implementation exists. Do not add cutoffs here on your own.

## `evidence-config.example.json` → `EVIDENCE_CONFIG_PATH`

```json
{ "<assessment_version_id>": { "C1": "S2" } }
```

- Missing file, missing version or missing domain ⇒ **S1** (research only). Only `S1`, `S2` and `SH` are accepted here;
  `S3`–`S5` remain behind the database release gate and are never enabled from a file.
- `S2` (developmental feedback) may be set only when governed pilot evidence authorises it (B06-AUD-010).

## `messages.json`

Participant-facing controlled copy. The wording is owner-approved content; the values shipped here are neutral
placeholders marked `TODO(copy)`.

## `consent-protocols.example.json` → `CONSENT_PROTOCOLS_PATH`

```json
[{ "protocolVersion": "...", "consentType": "PARENT_GUARDIAN_CONSENT" | "STUDENT_ASSENT" | "ADULT_SELF_CONSENT", "contentHash": "<64 hex>", "allowedVerificationMethods": ["CODE", ...] }]
```

- No file, or an entry missing for a `(protocolVersion, consentType)` pair: that consent is `PROTOCOL_UNAPPROVED` and
  **cannot even be created** (fail closed). No legal consent/assent wording lives in this repository; `contentHash` is
  the fingerprint of text the owner approves elsewhere.
- `allowedVerificationMethods` is a list of **codes**, never a contact detail, OTP or free text (`requireApprovedMethod`
  rejects anything that looks like one). An empty list means no method is approved yet, so `POST /consents/:id/verify`
  is refused for that protocol no matter who calls it.
- **`SELF_ATTESTED`** (CR-006-13, 2026-09-22, temporary until a real verification workflow is defined): the method code
  `POST /consents/self-consent` uses for `ADULT_SELF_CONSENT`, and (CR-006-14, 2026-09-22) `POST
  /consents/minor-self-service` also uses it for a minor's own `STUDENT_ASSENT` — that one is a genuine self-attestation
  either way, adult or minor, so the same code applies to both.
- **`STUDENT_ATTESTED_FOR_PARENT`** (CR-006-14, 2026-09-22, temporary until a real parent/guardian portal exists): the
  method `POST /consents/minor-self-service` uses for `PARENT_GUARDIAN_CONSENT` when the minor attests it themselves on
  their own device, in the absence of a separate parent-facing sign-in. Listing it under `PARENT_GUARDIAN_CONSENT` is
  what turns that checkbox on. It is a **distinct code from `SELF_ATTESTED`** so the audit trail can never be misread as
  an actual parent's own action; the admin-mediated flow (a real parent/guardian verifying their own consent through
  `POST /consents` + `POST /consents/:id/verify`) is completely unchanged and still available alongside it. The template
  above shows the intended shape; copy it and set real `protocolVersion`/`contentHash` values only once the owner has
  approved the actual consent/assent text.
- **Local development**: `backend/.env` points `CONSENT_PROTOCOLS_PATH` at `config/consent-protocols.local.json`
  (git-ignored, placeholder text/hash — never real approved wording) so the self-consent and minor-self-service
  checkboxes work when testing against the real dev database. Without this, every consent type is `PROTOCOL_UNAPPROVED`
  and nothing in `/consents/*` can even be created.
