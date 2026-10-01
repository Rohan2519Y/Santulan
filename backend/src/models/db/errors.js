/*
 * Maps MongoDB errors to HttpError (database-contract section 6). Duplicate keys map BY INDEX NAME to the earlier per-index
 * codes; validator failures (121) never surface as a 500; Unauthorized (13) is a 403 plus a security log entry; network and
 * transient errors become 503 STORE_UNAVAILABLE (fail closed: nothing partial).
 */
const { HttpError } = require('../../errors');
const securityLog = require('./securityLog');

const BY_INDEX = {
  _id_: [409, 'IDEMPOTENCY_RACE'], // a deterministic document id (idempotency outcome) was already inserted by another request
  uq_participants_auth_subject: [409, 'DUPLICATE_IDENTITY'],
  uq_participant_institution_external_id: [409, 'DUPLICATE_IDENTITY'],
  uq_participants_santulan_id: [409, 'DUPLICATE_IDENTITY'],
  uq_dev_identity: [409, 'DUPLICATE_IDENTITY'],
  uq_response_version: [409, 'RESPONSE_KEY_CONFLICT'],
  uq_responses_idempotency: [409, 'RESPONSE_KEY_CONFLICT'],
  uq_current_response: [409, 'RESPONSE_KEY_CONFLICT'],
  uq_submit_idempotency: [409, 'SUBMIT_KEY_CONFLICT'],
  uq_verified_consent_per_protocol: [409, 'CONSENT_DUPLICATE'],
  uq_consent_active_type_protocol: [409, 'CONSENT_DUPLICATE'],
  uq_one_nonterminal_attempt_per_participant: [409, 'INVALID_STATE'],
  uq_one_open_set_per_age_group: [409, 'OPEN_SET_EXISTS'],
  uq_one_live_revision_per_label: [409, 'SET_NOT_DRAFT'],
  uq_scores_key: [409, 'INVALID_STATE'],
  uq_reports_attempt: [409, 'INVALID_STATE'],
  uq_institutions_code: [409, 'DUPLICATE_CODE'],
  uq_cohorts_institution_code: [409, 'DUPLICATE_CODE'],
  uq_interpretation_rules_key: [409, 'WORDING_VERSION_CONFLICT'],
  uq_one_approved_rule_per_dimension: [409, 'WORDING_ALREADY_APPROVED'],
};

// Collections whose validator failures mean "the requested state change is not allowed" rather than "bad input".
const STATE_COLLECTIONS = new Set(['assessment_attempts', 'consents', 'reports', 'quality_flags', 'score_results', 'report_sections', 'assessment_versions', 'research_exports']);

const TRANSIENT_LABELS = ['TransientTransactionError', 'UnknownTransactionCommitResult', 'RetryableWriteError'];
const NETWORK_NAMES = /MongoNetworkError|MongoServerSelectionError|MongoNetworkTimeoutError|MongoTopologyClosedError|MongoNotConnectedError|PoolClearedError/;
const TRANSIENT_CODES = [6, 7, 89, 91, 189, 262, 9001, 10107, 11600, 11602, 13435, 13436];

function indexNameOf(err) {
  const m = /index: (\S+) dup key/.exec(err.message || '');
  return m ? m[1] : null;
}

function isTransient(err) {
  if (!err) return false;
  if (typeof err.hasErrorLabel === 'function' && TRANSIENT_LABELS.some((l) => err.hasErrorLabel(l))) return true;
  return NETWORK_NAMES.test(err.name || '') || TRANSIENT_CODES.includes(err.code);
}

function mapStoreError(err, context = {}) {
  if (!err || err instanceof HttpError) return err;
  if (err.storeContext) context = { ...err.storeContext, ...context };
  const mapped = mapDriverError(err, context);
  // keep the original driver error for diagnostics (never serialised into responses)
  if (mapped !== err && mapped instanceof HttpError) Object.defineProperty(mapped, 'cause', { value: err, enumerable: false });
  return mapped;
}

function mapDriverError(err, context) {
  const code = err.code !== undefined ? err.code : err.errorResponse && err.errorResponse.code;
  if (code === 11000) {
    const hit = BY_INDEX[indexNameOf(err)];
    return hit
      ? new HttpError(hit[0], hit[1], 'The request conflicts with an existing record')
      : new HttpError(409, 'INVALID_STATE', 'The request conflicts with an existing record');
  }
  if (code === 121) {
    if (context.collection && STATE_COLLECTIONS.has(context.collection)) return new HttpError(422, 'INVALID_STATE', 'The change is not allowed in the current state');
    return new HttpError(400, 'VALIDATION_ERROR', 'The stored record shape was refused');
  }
  if (code === 13 || err.codeName === 'Unauthorized') {
    securityLog.record({ event: 'UNAUTHORIZED', collection: context.collection || null, operation: context.operation || null, codeName: err.codeName || 'Unauthorized' });
    return new HttpError(403, 'FORBIDDEN', 'Not permitted');
  }
  if (isTransient(err)) return new HttpError(503, 'STORE_UNAVAILABLE', 'The data store could not confirm the operation; nothing was changed');
  return err;
}

module.exports = { mapStoreError, isTransient, indexNameOf, BY_INDEX };
