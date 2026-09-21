/* Delivery collections, runtime credential (G-01; B05). */
const H = require('../helpers/mongoHarness');
const F = require('../helpers/fixtures');

afterAll(async () => { await H.closeAll(); });

const ok = (coll, doc) => H.accepts(coll, doc);
const pid = F.participant()._id;
const vid = F.versionDoc()._id;

describe('assessment_attempts', () => {
  test('B05-050 session_count is 0..4', async () => {
    for (const n of [0, 1, 4]) expect(await ok('assessment_attempts', F.attempt(pid, vid, { session_count: n }))).toBe(true);
    expect(await ok('assessment_attempts', F.attempt(pid, vid, { session_count: 5 }))).toBe(false);
    expect(await ok('assessment_attempts', F.attempt(pid, vid, { session_count: -1 }))).toBe(false);
  });
  test('B05-051 age 13..25 and developmental band consistent with the age', async () => {
    expect(await ok('assessment_attempts', F.attempt(pid, vid, { age_years_at_attempt: 12, developmental_band_at_attempt: 'D1' }))).toBe(false);
    expect(await ok('assessment_attempts', F.attempt(pid, vid, { age_years_at_attempt: 26, developmental_band_at_attempt: 'D4' }))).toBe(false);
    expect(await ok('assessment_attempts', F.attempt(pid, vid, { age_years_at_attempt: 19, developmental_band_at_attempt: 'D3' }))).toBe(true);
    expect(await ok('assessment_attempts', F.attempt(pid, vid, { age_years_at_attempt: 19, developmental_band_at_attempt: 'D2' }))).toBe(false);
  });
  test('B05-052 status must be one of the eleven attempt states', async () => {
    for (const s of ['CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED', 'SUBMITTED', 'SCORING', 'SCORED', 'REPORT_READY', 'QUALITY_HOLD', 'INVALID', 'EXPIRED']) {
      expect(await ok('assessment_attempts', F.attempt(pid, vid, { status: s }))).toBe(true);
    }
    expect(await ok('assessment_attempts', F.attempt(pid, vid, { status: 'DONE' }))).toBe(false);
  });
});

describe('responses', () => {
  const aid = F.attempt(pid, vid)._id;
  const iid = F.item(vid)._id;
  test('B05-053 response_value is an option position 1..20', async () => {
    for (const v of ['1', '5', '9', '10', '19', '20']) expect(await ok('responses', F.response(aid, iid, { response_value: v }))).toBe(true);
    for (const v of ['0', '21', '01', 'a', '', '3.5', ' 3']) expect(await ok('responses', F.response(aid, iid, { response_value: v }))).toBe(false);
    expect(await ok('responses', F.response(aid, iid, { response_value: 3 }))).toBe(false);
  });
  test('B05-054 response_version > 0, idempotency key not blank, is_current is a boolean', async () => {
    expect(await ok('responses', F.response(aid, iid, { response_version: 0 }))).toBe(false);
    expect(await ok('responses', F.response(aid, iid, { idempotency_key: '  ' }))).toBe(false);
    expect(await ok('responses', F.response(aid, iid, { is_current: 'yes' }))).toBe(false);
    expect(await ok('responses', F.response(aid, iid, { response_time_ms: -1 }))).toBe(false);
    expect(await ok('responses', F.response(aid, iid, { presented_order: 0 }))).toBe(false);
  });
});

describe('response_events', () => {
  const aid = F.attempt(pid, vid)._id;
  test('B05-055 session_number is 1..4 or null; event types are the eight listed', async () => {
    expect(await ok('response_events', F.responseEvent(aid, { session_number: null }))).toBe(true);
    expect(await ok('response_events', F.responseEvent(aid, { session_number: 4 }))).toBe(true);
    expect(await ok('response_events', F.responseEvent(aid, { session_number: 0 }))).toBe(false);
    expect(await ok('response_events', F.responseEvent(aid, { session_number: 5 }))).toBe(false);
    for (const t of ['SESSION_START', 'SESSION_END', 'PAUSE', 'RESUME', 'RESPONSE_SAVED', 'SUBMIT', 'QUALITY_CHECK_COMPLETED', 'REPORT_RETRY']) {
      expect(await ok('response_events', F.responseEvent(aid, { event_type: t }))).toBe(true);
    }
    expect(await ok('response_events', F.responseEvent(aid, { event_type: 'CLICK' }))).toBe(false);
    expect(await ok('response_events', F.responseEvent(aid, { metadata: 'x' }))).toBe(false);
  });
});
