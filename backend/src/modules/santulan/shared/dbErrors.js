/*
 * Maps PostgreSQL errors raised by the canonical schema to HttpError (contracts/api.md §1).
 * Custom SQLSTATEs are defined in migration 008 (SN001-SN011) and 019 (SN012).
 */
const { HttpError } = require('../../../shared/errors');

const BY_SQLSTATE = {
  SN001: [403, 'CONSENT_GATE_CLOSED'],
  SN002: [409, 'VERSION_MISMATCH'],
  SN003: [422, 'INVALID_STATE'],
  SN004: [422, 'ATTEMPT_LOCKED'],          // immutable data
  SN005: [409, 'SESSION_LIMIT'],
  SN006: [409, 'RESPONSE_KEY_CONFLICT'],
  SN007: [422, 'SCALE_OUT_OF_RANGE'],
  SN008: [422, 'ATTEMPT_LOCKED'],
  SN009: [409, 'ASSESSMENT_NOT_OPEN'],
  SN010: [422, 'INVALID_STATE'],
  SN011: [403, 'FORBIDDEN'],
  SN012: [503, 'CATALOG_DRIFT'],
  SN013: [409, 'QUALITY_NOT_CLEAR'],       // scoring before a CLEAR quality outcome
  P0002: [404, 'NOT_FOUND'],                // a procedure was given an id that does not exist
};

// unique-violation constraint/index name -> [status, code]
const BY_CONSTRAINT = {
  uq_participants_auth_subject: [409, 'DUPLICATE_IDENTITY'],
  uq_participant_institution_external_id: [409, 'DUPLICATE_IDENTITY'],
  uq_consent_active_type_protocol: [409, 'CONSENT_DUPLICATE'],
  uq_verified_consent_per_protocol: [409, 'CONSENT_DUPLICATE'],
  uq_one_nonterminal_attempt_per_participant: [409, 'INVALID_STATE'],
};

function mapDbError(err) {
  if (!err || !err.code) return err;
  if (BY_SQLSTATE[err.code]) {
    const [status, code] = BY_SQLSTATE[err.code];
    return new HttpError(status, code, err.message.replace(/^error: /i, ''));
  }
  if (err.code === '23505' && BY_CONSTRAINT[err.constraint]) {
    const [status, code] = BY_CONSTRAINT[err.constraint];
    return new HttpError(status, code, 'The request conflicts with an existing record');
  }
  if (err.code === '42501') return new HttpError(403, 'FORBIDDEN', 'Not permitted');
  return err;
}

module.exports = { mapDbError };
