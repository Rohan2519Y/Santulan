/*
 * Attempt rules (BUILD 05; data-model section 7). The attempt state machine, the create gate and the session machine as PURE
 * functions plus the assertions that need the store. Transitions are applied with compare-and-set in the repository, so a stale
 * source state changes nothing. Delivery stops at SUBMITTED: nothing here invokes quality or scoring.
 */
const { HttpError } = require('../../errors');
const controlPlane = require('./controlPlane');

const MAX_SESSIONS = 4;
const NONTERMINAL = ['CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED', 'SUBMITTED', 'SCORING', 'SCORED', 'QUALITY_HOLD'];
const OPEN_STATES = new Set(['CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED']);
const WRITABLE = new Set(['STARTED', 'IN_PROGRESS']);

// enforce_attempt_update (migration 015): the legal moves
const TRANSITIONS = {
  CREATED: ['STARTED', 'IN_PROGRESS', 'EXPIRED', 'INVALID'], // IN_PROGRESS = STARTED then IN_PROGRESS in one atomic first-session step
  STARTED: ['IN_PROGRESS', 'PAUSED', 'SUBMITTED', 'QUALITY_HOLD', 'INVALID', 'EXPIRED'],
  IN_PROGRESS: ['PAUSED', 'SUBMITTED', 'QUALITY_HOLD', 'INVALID', 'EXPIRED'],
  PAUSED: ['IN_PROGRESS', 'SUBMITTED', 'QUALITY_HOLD', 'INVALID', 'EXPIRED'],
  SUBMITTED: ['SCORING', 'QUALITY_HOLD', 'INVALID'],
  SCORING: ['SCORED', 'QUALITY_HOLD', 'INVALID'],
  SCORED: ['REPORT_READY', 'QUALITY_HOLD', 'INVALID'],
  QUALITY_HOLD: ['SCORING', 'SCORED', 'INVALID', 'EXPIRED'],
  REPORT_READY: [],
  INVALID: [],
  EXPIRED: [],
};

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

const locked = (status) => new HttpError(422, 'ATTEMPT_LOCKED', `The attempt is ${status} and cannot be changed this way`);
const invalidState = (message) => new HttpError(422, 'INVALID_STATE', message);

/**
 * Create gate: the participant is ACTIVE, the consent gate is open, the age is inside the set's range, and the set is FROZEN and
 * OPEN with the control plane OPEN. `gate` is { open } from consentRules.evaluateGate.
 */
async function assertCanStart(tx, { participant, set, gate }) {
  if (!participant || participant.status !== 'ACTIVE') throw new HttpError(403, 'FORBIDDEN', 'Participant is not active');
  await controlPlane.assertOpen(tx, set);
  if (participant.ageYearsAtRegistration < set.participant_min_age || participant.ageYearsAtRegistration > set.participant_max_age) {
    throw new HttpError(422, 'VALIDATION_ERROR', `Age ${participant.ageYearsAtRegistration} is outside the range of this question set`);
  }
  if (!gate.open) throw new HttpError(403, 'CONSENT_GATE_CLOSED', 'The required consent records are not verified');
}

/**
 * Session machine (BUILD 05 section 4): +1 only on a true session boundary.
 * @returns {{ from, patch, event, sessionCount }}
 */
function planBeginOrResume(a, now = new Date()) {
  if (a.status === 'CREATED') {
    return {
      from: 'CREATED', sessionCount: 1,
      patch: { status: 'IN_PROGRESS', session_count: 1, started_at: now, last_activity_at: now },
      event: { event_type: 'SESSION_START', session_number: 1, metadata: {} },
    };
  }
  if (a.status === 'STARTED' || a.status === 'IN_PROGRESS') {
    return {
      from: a.status, sessionCount: a.sessionCount,
      patch: { status: 'IN_PROGRESS', last_activity_at: now },
      event: { event_type: 'RESUME', session_number: a.sessionCount, metadata: { reconnect: true } },
    };
  }
  if (a.status === 'PAUSED') {
    if (a.sessionCount >= MAX_SESSIONS) throw new HttpError(409, 'SESSION_LIMIT', 'The four-session limit has been reached');
    return {
      from: 'PAUSED', sessionCount: a.sessionCount + 1,
      patch: { status: 'IN_PROGRESS', session_count: a.sessionCount + 1, last_activity_at: now },
      event: { event_type: 'SESSION_START', session_number: a.sessionCount + 1, metadata: {} },
    };
  }
  throw locked(a.status);
}

/** Pause / logout / inactivity timeout: only an IN_PROGRESS attempt can be paused; writes PAUSE + SESSION_END. */
function planPause(a, reason, now = new Date()) {
  if (a.status !== 'IN_PROGRESS') throw invalidState(`Only an in-progress attempt can be paused (attempt is ${a.status})`);
  return {
    from: 'IN_PROGRESS',
    patch: { status: 'PAUSED', last_activity_at: now },
    events: [
      { event_type: 'PAUSE', session_number: a.sessionCount, metadata: { reason } },
      { event_type: 'SESSION_END', session_number: a.sessionCount, metadata: { reason } },
    ],
  };
}

/** Submit: from STARTED / IN_PROGRESS / PAUSED; an active session is closed first (SESSION_END), then SUBMIT is recorded. */
function planSubmit(a, submissionKey, now = new Date()) {
  if (!submissionKey || !String(submissionKey).trim()) throw new HttpError(422, 'VALIDATION_ERROR', 'A submission key is required');
  if (!['STARTED', 'IN_PROGRESS', 'PAUSED'].includes(a.status)) throw invalidState(`An attempt in status ${a.status} cannot be submitted`);
  return {
    from: a.status,
    patch: { status: 'SUBMITTED', submitted_at: now, last_activity_at: now },
    events: [
      ...(a.status === 'IN_PROGRESS' ? [{ event_type: 'SESSION_END', session_number: a.sessionCount, metadata: { reason: 'submit' } }] : []),
      { event_type: 'SUBMIT', session_number: a.sessionCount || null, metadata: { idempotency_key: submissionKey } },
    ],
  };
}

/** An event's session number can never exceed the attempt's session count (B05-018). */
function assertEventSession(attempt, event) {
  if (event.session_number !== null && event.session_number !== undefined && event.session_number > attempt.sessionCount) {
    throw new HttpError(422, 'VALIDATION_ERROR', `Event session ${event.session_number} exceeds the attempt session count ${attempt.sessionCount}`);
  }
}

module.exports = {
  MAX_SESSIONS, NONTERMINAL, OPEN_STATES, WRITABLE, TRANSITIONS, canTransition, assertCanStart,
  planBeginOrResume, planPause, planSubmit, assertEventSession, locked, invalidState,
};
