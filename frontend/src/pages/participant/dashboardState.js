/*
 * Dashboard state (specs/003 contracts/dashboards.md §1.2). Pure functions so the mapping is unit-testable:
 * one real state -> exactly one primary action. Copy is neutral and never exposes internal state names.
 * No score, band, quality flag or pathway data is read here (§1.4).
 */

export const STATES = {
  CONSENT_PENDING: 'consent-pending',
  READY: 'ready',
  CLOSED: 'closed',
  IN_PROGRESS: 'in-progress',
  SUBMITTED: 'submitted',
  REPORT_READY: 'report-ready',
  HELD: 'held',           // QUALITY_HOLD: identical wording for every hold reason (T11)
  INVALID: 'invalid',     // T12
  EXPIRED: 'expired',
};

/**
 * @param {{ gate: {open:boolean}|null, attempt: {status:string}|null, model: {status:string, session:{n:number}}|null,
 *           assessmentClosed?: boolean, reportStatus?: string|null }} input
 */
export function deriveState({ gate, attempt, model, assessmentClosed = false, reportStatus = null }) {
  const status = (model && model.status) || (attempt && attempt.status) || null;
  if (status === 'EXPIRED') return STATES.EXPIRED;
  if (status === 'QUALITY_HOLD') return STATES.HELD;
  if (status === 'INVALID') return STATES.INVALID;
  if (status === 'REPORT_READY') return STATES.REPORT_READY;
  if (['SUBMITTED', 'SCORING', 'SCORED'].includes(status)) return reportStatus === 'REPORT_READY' ? STATES.REPORT_READY : STATES.SUBMITTED;
  if (['CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED'].includes(status)) return STATES.IN_PROGRESS;
  if (!gate || !gate.open) return STATES.CONSENT_PENDING;
  return assessmentClosed ? STATES.CLOSED : STATES.READY;
}

/** TODO(copy): all wording below is placeholder text awaiting the content owner. */
export function describeState(state, { isMinor = false, model = null, reportStatus = null } = {}) {
  switch (state) {
    case STATES.CONSENT_PENDING:
      return {
        headline: 'Consent needs to be verified first',
        body: isMinor ? 'We are waiting for your parent or guardian, and your own assent, to be verified.' : 'Your consent needs to be verified before you can begin.',
        action: { label: 'Complete consent', to: '/student/privacy' },
        startDisabledReason: 'The assessment starts once consent is verified.',
      };
    case STATES.READY:
      return { headline: 'You are ready to begin', body: 'Take your time. You can pause and come back, up to four sessions.', action: { label: 'Start assessment', kind: 'start' } };
    case STATES.CLOSED:
      return { headline: "The assessment isn't open right now", body: 'Please check back later.', action: null };
    case STATES.IN_PROGRESS: {
      const n = model && model.session ? Math.max(model.session.n, 1) : 1;
      const percent = model && model.progress ? model.progress.percent : 0;
      return { headline: 'Continue where you left off', body: `Session ${n} of 4 · ${percent}% answered`, action: { label: 'Continue Assessment', to: '/student/assessment' } };
    }
    case STATES.SUBMITTED:
      return {
        headline: reportStatus === 'FAILED_RETRYABLE' ? 'Still preparing your report' : 'Your answers were received',
        body: 'We are preparing your report. This can take a little while.',
        action: { label: 'See progress', to: '/student/generating' },
      };
    case STATES.REPORT_READY:
      return { headline: 'Your report is ready', body: 'You can now view your report.', action: { label: 'View your report', to: '/student/results' } };
    case STATES.HELD:
      return { headline: 'Your responses are being reviewed.', body: 'We will let you know when there is something to see.', action: null };
    case STATES.INVALID:
      return { headline: 'This attempt could not be processed for a report.', body: 'Please contact Support if you would like help.', action: { label: 'Go to Support', to: '/student/support' } };
    case STATES.EXPIRED:
      return { headline: 'This attempt has ended', body: 'Please contact Support if you would like to know what to do next.', action: { label: 'Go to Support', to: '/student/support' } };
    default:
      return { headline: '', body: '', action: null };
  }
}

/** Real stages only (§1.3); the growth-plan stage is hidden while its release flag is off. */
export function timeline(state, { gateOpen }) {
  const attemptStarted = [STATES.IN_PROGRESS, STATES.SUBMITTED, STATES.REPORT_READY, STATES.HELD, STATES.INVALID, STATES.EXPIRED].includes(state);
  const submitted = [STATES.SUBMITTED, STATES.REPORT_READY, STATES.HELD, STATES.INVALID].includes(state);
  return [
    { label: 'Account registered', done: true },
    { label: 'Consent verified', done: Boolean(gateOpen) || attemptStarted },
    { label: 'Assessment', done: submitted, current: state === STATES.IN_PROGRESS },
    { label: 'Report', done: state === STATES.REPORT_READY, current: state === STATES.SUBMITTED },
  ];
}

export const greeting = (hour) => (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
