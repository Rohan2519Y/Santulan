/*
 * HTTP helpers for the canonical API: strict request schemas (unknown keys are a VALIDATION_ERROR - this is how
 * client-supplied scores, santulan_id, participant_id or DB-context values are refused), a correlation-id middleware and
 * a log redactor.
 */
const { randomUUID } = require('crypto');
const { z } = require('zod');

/** z.object(...).strict(): unknown keys are rejected, never silently ignored. */
const strictObject = (shape) => z.object(shape).strict();

function correlation(req, res, next) {
  const incoming = req.headers['x-correlation-id'];
  req.correlationId = typeof incoming === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
}

const REDACT_KEYS = /^(auth_?provider_?subject_?id|external_?student_?id|otp|code|token|password|new_?password|temporary_?password|secret|authorization)$/i;

/** Returns a copy with sensitive values replaced; safe to log. */
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, REDACT_KEYS.test(k) ? '[REDACTED]' : redact(v)]));
  }
  return value;
}

module.exports = { strictObject, correlation, redact };
