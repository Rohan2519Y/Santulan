/*
 * One-time, short-lived credential export store (spec 005 T076 / contracts/api.md US4): after a roster commit the
 * plaintext temporary passwords exist ONLY here, in process memory, for a short window; GET /admin/credentials/export
 * consumes the entry (single download) and it then expires from memory. Nothing is written to the database.
 */
const crypto = require('crypto');

const DEFAULT_TTL_MS = 30 * 60 * 1000;

const exports_ = new Map(); // importId -> { rows: [{santulanId, temporaryPassword}], createdAt, expired }

function purge(now = Date.now()) {
  for (const [id, entry] of exports_) {
    if (entry.expired || now - entry.createdAt > DEFAULT_TTL_MS) exports_.delete(id);
  }
}

function makeImportId() {
  return `imp_${crypto.randomBytes(12).toString('base64url')}`;
}

/** Stores the plaintext credentials for a committed import; returns the id used for the single export. */
function store(rows, now = Date.now()) {
  purge(now);
  const importId = makeImportId();
  exports_.set(importId, { rows, createdAt: now });
  return importId;
}

/** Returns and removes the credentials for one download; null when unknown, expired or already consumed. */
function take(importId) {
  purge();
  const entry = exports_.get(importId);
  if (!entry) return null;
  exports_.delete(importId);
  return entry && entry.rows ? entry.rows : null;
}

/** Sanitised CSV so the export opens in Excel without formula injection ('='/'+'/'-'/'@' are prefixed with a tab). */
function toCsv(rows) {
  const safe = (value) => String(value).replace(/^([=+\-@])/, '\t$1');
  const lines = ['santulan_id,temporary_password'];
  for (const row of rows) lines.push(`${safe(row.santulanId)},${safe(row.temporaryPassword)}`);
  return `${lines.join('\n')}\n`;
}

module.exports = { store, take, toCsv, DEFAULT_TTL_MS };