/* Assessment delivery collections (BUILD 01 section 6.9-6.11; BUILD 05). */
const E = require('../enums');
const D = require('../dsl');

const { uuid, str, int, bool, date, obj, collection, eq } = D;

const age = '$age_years_at_attempt';
const assessmentAttempts = collection('assessment_attempts', 'B', {
  participant_id: uuid(),
  assessment_version_id: uuid(),
  age_years_at_attempt: int({ min: 13, max: 25 }),
  developmental_band_at_attempt: str({ enum: E.BAND }),
  status: str({ enum: E.ATTEMPT_STATUS }),
  session_count: int({ min: 0, max: 4 }),
  created_at: date(),
  started_at: date({ nullable: true }),
  submitted_at: date({ nullable: true }),
  completed_at: date({ nullable: true }),
  last_activity_at: date({ nullable: true }),
  scoring_version: str({ nullable: true }),
  lock_version: int({ min: 0 }),
}, [
  eq('$developmental_band_at_attempt', {
    $switch: {
      branches: [
        { case: { $lte: [age, 15] }, then: 'D1' },
        { case: { $lte: [age, 17] }, then: 'D2' },
        { case: { $lte: [age, 20] }, then: 'D3' },
      ],
      default: 'D4',
    },
  }),
]);

const responses = collection('responses', 'B', {
  attempt_id: uuid(),
  item_id: uuid(),
  response_value: str({ pattern: '^([1-9]|1[0-9]|20)$' }), // the chosen option's position (CR-006-5)
  response_version: int({ min: 1 }),
  is_current: bool(),
  supersedes_response_id: uuid({ nullable: true }),
  response_time_ms: int({ min: 0, nullable: true }),
  presented_order: int({ min: 1, nullable: true }),
  answered_at: date(),
  idempotency_key: str({ nonblank: true }),
});

const responseEvents = collection('response_events', 'A', {
  attempt_id: uuid(),
  item_id: uuid({ nullable: true }),
  event_type: str({ enum: E.EVENT_TYPE }),
  session_number: int({ min: 1, max: 4, nullable: true }),
  occurred_at: date(),
  metadata: obj(),
});

module.exports = [assessmentAttempts, responses, responseEvents];
