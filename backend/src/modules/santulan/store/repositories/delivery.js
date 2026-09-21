/*
 * Attempts and their events (assessment_attempts, response_events). Attempt moves are compare-and-set (a stale source state
 * changes nothing) and bump lock_version; events are insert-only. The attempt's participant, question set and age are never
 * updated (they are not in the update whitelist of the access layer).
 */
const { v4: uuidv4 } = require('uuid');
const { camel } = require('../naming');
const attemptRules = require('../../domain/attemptRules');

const A = (d) => camel(d, 'attemptId');

async function getAttempt(tx, attemptId) {
  return A(await tx.c.assessment_attempts.findOne({ _id: attemptId }));
}

async function latestAttemptOf(tx, participantId) {
  const [row] = await tx.c.assessment_attempts.find({ participant_id: participantId }, { sort: { created_at: -1 }, limit: 1 });
  return A(row || null);
}

async function insertAttempt(tx, { participantId, assessmentVersionId, ageYears }) {
  const now = new Date();
  const doc = {
    _id: uuidv4(), participant_id: participantId, assessment_version_id: assessmentVersionId, age_years_at_attempt: ageYears,
    developmental_band_at_attempt: ageYears <= 15 ? 'D1' : ageYears <= 17 ? 'D2' : ageYears <= 20 ? 'D3' : 'D4',
    status: 'CREATED', session_count: 0, created_at: now, started_at: null, submitted_at: null, completed_at: null, last_activity_at: null,
    scoring_version: null, lock_version: 0,
  };
  await tx.c.assessment_attempts.insertOne(doc);
  return A(doc);
}

/**
 * Applies `patch` only if the attempt is still in `from`; increments lock_version. Returns true when it applied.
 * Refuses any move the attempt state machine does not allow.
 */
async function moveAttempt(tx, attemptId, from, patch) {
  if (patch.status && patch.status !== from && !attemptRules.canTransition(from, patch.status)) throw attemptRules.invalidState(`The attempt cannot move from ${from} to ${patch.status}`);
  return tx.c.assessment_attempts.transition(attemptId, { status: from }, patch, { $inc: { lock_version: 1 } });
}

/** Marks activity on the attempt (no state change). */
async function touchAttempt(tx, attemptId) {
  await tx.c.assessment_attempts.updateOne({ _id: attemptId }, { $set: { last_activity_at: new Date() } });
}

/** Appends an event (insert-only). The event's session number can never exceed the attempt's session count. */
async function appendEvent(tx, attempt, { event_type: eventType, session_number: sessionNumber = null, item_id: itemId = null, metadata = {} }) {
  attemptRules.assertEventSession(attempt, { session_number: sessionNumber });
  const doc = { _id: uuidv4(), attempt_id: attempt.attemptId, item_id: itemId, event_type: eventType, session_number: sessionNumber, occurred_at: new Date(), metadata };
  await tx.c.response_events.insertOne(doc);
  return doc;
}

async function findSubmitEvent(tx, attemptId) {
  return tx.c.response_events.findOne({ attempt_id: attemptId, event_type: 'SUBMIT' });
}

async function eventsOf(tx, attemptId) {
  return tx.c.response_events.find({ attempt_id: attemptId }, { sort: { occurred_at: 1, _id: 1 } });
}

module.exports = { getAttempt, latestAttemptOf, insertAttempt, moveAttempt, touchAttempt, appendEvent, findSubmitEvent, eventsOf, fromAttempt: A };
