/* Store error mapping (T010; database-contract section 6). Pure: no database needed. */
const { mapStoreError, isTransient } = require('../../../src/modules/santulan/store/errors');
const securityLog = require('../../../src/modules/santulan/store/securityLog');
const { HttpError } = require('../../../src/shared/errors');

const dupErr = (index) => Object.assign(new Error(`E11000 duplicate key error collection: santulan.x index: ${index} dup key: { a: 1 }`), { code: 11000 });
const validatorErr = () => Object.assign(new Error('Document failed validation'), { code: 121 });

describe('duplicate key maps by index name', () => {
  test.each([
    ['uq_participants_auth_subject', 'DUPLICATE_IDENTITY'],
    ['uq_participant_institution_external_id', 'DUPLICATE_IDENTITY'],
    ['uq_response_version', 'RESPONSE_KEY_CONFLICT'],
    ['uq_responses_idempotency', 'RESPONSE_KEY_CONFLICT'],
    ['uq_verified_consent_per_protocol', 'CONSENT_DUPLICATE'],
    ['uq_consent_active_type_protocol', 'CONSENT_DUPLICATE'],
    ['uq_one_nonterminal_attempt_per_participant', 'INVALID_STATE'],
    ['uq_one_open_set_per_age_group', 'OPEN_SET_EXISTS'],
    ['uq_submit_idempotency', 'SUBMIT_KEY_CONFLICT'],
    ['_id_', 'IDEMPOTENCY_RACE'],
  ])('%s -> %s (409)', (index, code) => {
    const e = mapStoreError(dupErr(index));
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(409);
    expect(e.code).toBe(code);
  });

  test('an unknown index is a 409 INVALID_STATE, never a 500', () => {
    const e = mapStoreError(dupErr('uq_something_new'));
    expect([e.status, e.code]).toEqual([409, 'INVALID_STATE']);
  });
});

describe('validator failure (121) is never a 500', () => {
  test('state collections -> 422 INVALID_STATE', () => {
    for (const collection of ['assessment_attempts', 'consents', 'reports']) {
      const e = mapStoreError(validatorErr(), { collection });
      expect([e.status, e.code]).toEqual([422, 'INVALID_STATE']);
    }
  });
  test('other collections -> 400 VALIDATION_ERROR', () => {
    const e = mapStoreError(validatorErr(), { collection: 'participants' });
    expect([e.status, e.code]).toEqual([400, 'VALIDATION_ERROR']);
  });
  test('the collection tagged on the error is used', () => {
    const err = Object.assign(validatorErr(), { storeContext: { collection: 'consents', operation: 'update' } });
    expect(mapStoreError(err).code).toBe('INVALID_STATE');
  });
});

describe('Unauthorized (13) is a 403 plus a security log entry', () => {
  test('403 FORBIDDEN and one log entry without secrets', () => {
    securityLog.clear();
    const err = Object.assign(new Error('not authorized on santulan to execute command { secret: "x" }'), { code: 13, codeName: 'Unauthorized' });
    const e = mapStoreError(err, { collection: 'audit_logs', operation: 'update' });
    expect([e.status, e.code]).toEqual([403, 'FORBIDDEN']);
    const log = securityLog.recent();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ event: 'UNAUTHORIZED', collection: 'audit_logs', operation: 'update' });
    expect(JSON.stringify(log[0])).not.toContain('secret');
    expect(e.message).not.toContain('secret');
  });
});

describe('transient and network errors fail closed as 503', () => {
  test('labelled transient errors and network errors -> 503 STORE_UNAVAILABLE', () => {
    const labelled = Object.assign(new Error('write conflict'), { code: 112, hasErrorLabel: (l) => l === 'TransientTransactionError' });
    expect(isTransient(labelled)).toBe(true);
    expect(mapStoreError(labelled).code).toBe('STORE_UNAVAILABLE');
    const net = Object.assign(new Error('connection closed'), { name: 'MongoNetworkError' });
    expect(mapStoreError(net)).toMatchObject({ status: 503, code: 'STORE_UNAVAILABLE' });
    const sel = Object.assign(new Error('no primary'), { name: 'MongoServerSelectionError' });
    expect(mapStoreError(sel).status).toBe(503);
  });
  test('an HttpError passes through unchanged and an unknown error is returned as is', () => {
    const h = new HttpError(422, 'X', 'y');
    expect(mapStoreError(h)).toBe(h);
    const other = new TypeError('bug');
    expect(mapStoreError(other)).toBe(other);
  });
});
