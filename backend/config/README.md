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
