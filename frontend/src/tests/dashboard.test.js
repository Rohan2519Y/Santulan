import { screen } from '@testing-library/react';
import DashboardPage from '../pages/participant/DashboardPage';
import { deriveState, describeState, timeline, STATES } from '../pages/participant/dashboardState';
import { api } from '../services/santulanApi';
import { renderPage, pageText } from './testUtils';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  api: { registrationState: jest.fn(), consentGate: jest.fn(), attempt: jest.fn(), createAttempt: jest.fn() },
}));

const OPEN = { open: true, missingTypes: [] };
const CLOSED = { open: false, missingTypes: ['ADULT_SELF_CONSENT'] };
const model = (status, n = 1, percent = 0) => ({ attemptId: 'a1', status, session: { n, of: 4 }, progress: { completed: 0, total: 175, percent }, lastSavedAt: null, canContinue: true });

/** One row per dashboards.md §1.2: [name, input, expected state, expected primary action label]. */
const ROWS = [
  ['consent pending', { gate: CLOSED, attempt: null, model: null }, STATES.CONSENT_PENDING, 'Complete consent'],
  ['ready', { gate: OPEN, attempt: null, model: null }, STATES.READY, 'Start assessment'],
  ['assessment not open', { gate: OPEN, attempt: null, model: null, assessmentClosed: true }, STATES.CLOSED, null],
  ['in progress', { gate: OPEN, attempt: { status: 'IN_PROGRESS' }, model: model('IN_PROGRESS', 2, 40) }, STATES.IN_PROGRESS, 'Continue Assessment'],
  ['paused', { gate: OPEN, attempt: { status: 'PAUSED' }, model: model('PAUSED', 3) }, STATES.IN_PROGRESS, 'Continue Assessment'],
  ['submitted', { gate: OPEN, attempt: { status: 'SUBMITTED' }, model: model('SUBMITTED') }, STATES.SUBMITTED, 'See progress'],
  ['scoring', { gate: OPEN, attempt: { status: 'SCORING' }, model: model('SCORING') }, STATES.SUBMITTED, 'See progress'],
  ['report preparing (scored)', { gate: OPEN, attempt: { status: 'SCORED' }, model: model('SCORED') }, STATES.SUBMITTED, 'See progress'],
  ['report ready', { gate: OPEN, attempt: { status: 'REPORT_READY' }, model: model('REPORT_READY') }, STATES.REPORT_READY, 'View your report'],
  ['T11 quality hold', { gate: OPEN, attempt: { status: 'QUALITY_HOLD' }, model: model('QUALITY_HOLD') }, STATES.HELD, null],
  ['T12 invalid', { gate: OPEN, attempt: { status: 'INVALID' }, model: model('INVALID') }, STATES.INVALID, 'Go to Support'],
  ['expired', { gate: OPEN, attempt: { status: 'EXPIRED' }, model: model('EXPIRED') }, STATES.EXPIRED, 'Go to Support'],
];

describe('dashboard state mapping (T117, dashboards.md §1.2)', () => {
  test.each(ROWS)('%s', (name, input, state, label) => {
    expect(deriveState(input)).toBe(state);
    const view = describeState(state, { model: input.model });
    expect(view.action ? view.action.label : null).toBe(label);
  });

  test('"Session n of 4" and progress are shown while in progress; a failed report keeps "Still preparing your report"', () => {
    expect(describeState(STATES.IN_PROGRESS, { model: model('IN_PROGRESS', 2, 40) }).body).toBe('Session 2 of 4 · 40% answered');
    expect(describeState(STATES.SUBMITTED, { reportStatus: 'FAILED_RETRYABLE' }).headline).toBe('Still preparing your report');
  });

  test('every hold reason reads the same, and the timeline never invents stages or a growth-plan step', () => {
    expect(describeState(STATES.HELD).headline).toBe('Your responses are being reviewed.');
    const labels = timeline(STATES.IN_PROGRESS, { gateOpen: true }).map((t) => t.label);
    expect(labels).toEqual(['Account registered', 'Consent verified', 'Assessment', 'Report']);
  });
});

describe('dashboard page (T117)', () => {
  beforeEach(() => jest.clearAllMocks());

  const mount = async (reg, gate, m) => {
    api.registrationState.mockResolvedValue(reg);
    api.consentGate.mockResolvedValue(gate);
    api.attempt.mockResolvedValue(m);
    const view = renderPage(<DashboardPage />);
    await screen.findByText('Your journey matters');
    return view;
  };

  test('consent pending: "Complete consent" and the reason the start is not available', async () => {
    await mount({ isMinor: true, attempt: null }, CLOSED, null);
    expect(screen.getByRole('button', { name: 'Complete consent' })).toBeInTheDocument();
    expect(screen.getByText(/assessment starts once consent is verified/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start assessment/i })).not.toBeInTheDocument();
  });

  test('in progress: Continue Assessment with "Session n of 4"', async () => {
    await mount({ isMinor: false, attempt: { attemptId: 'a1', status: 'IN_PROGRESS' } }, OPEN, model('IN_PROGRESS', 2, 40));
    expect(screen.getByRole('button', { name: 'Continue Assessment' })).toBeInTheDocument();
    expect(screen.getByText(/Session 2 of 4/)).toBeInTheDocument();
  });

  test('ready: Start assessment calls POST /attempts; a closed assessment shows the safe message with no button', async () => {
    const { container } = await mount({ isMinor: false, attempt: null }, OPEN, null);
    api.createAttempt.mockRejectedValue(Object.assign(new Error('closed'), { code: 'ASSESSMENT_NOT_OPEN' }));
    screen.getByRole('button', { name: 'Start assessment' }).click();
    expect(await screen.findByText("The assessment isn't open right now")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start assessment/i })).not.toBeInTheDocument();
    expect(pageText(container)).not.toMatch(/DRAFT|FROZEN|CLOSED|participation_state/);
  });

  test('no name, date of birth, score, band or percentile appears, and the deferred tiles are absent', async () => {
    const { container } = await mount({ isMinor: false, attempt: { attemptId: 'a1', status: 'SCORED' } }, OPEN, model('SCORED'));
    const text = pageText(container);
    expect(text).not.toMatch(/\b(score|percentile|band|Aarav|Mehta)\b/i);
    expect(text).not.toMatch(/date of birth/i);
    for (const deferred of [/resources/i, /wellbeing/i, /mentor/i, /notification/i]) expect(text).not.toMatch(deferred);
    expect(screen.getByText(/good (morning|afternoon|evening)/i)).toBeInTheDocument();
  });

  test('a load failure shows a calm retry, not a crash', async () => {
    api.registrationState.mockRejectedValue(new Error('We could not reach the server.'));
    renderPage(<DashboardPage />);
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
