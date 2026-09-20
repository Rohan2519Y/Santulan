import { screen, waitFor } from '@testing-library/react';
import { GeneratingReportPage, STAGES, stageFor } from '../pages/participant/AfterSubmitPages';
import { api } from '../services/santulanApi';
import { renderPage, pageText } from './testUtils';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  api: { registrationState: jest.fn(), attempt: jest.fn() },
}));

const withStatuses = (...statuses) => {
  api.registrationState.mockResolvedValue({ attempt: { attemptId: 'a1', status: statuses[0] } });
  statuses.forEach((s, i) => {
    const call = { attemptId: 'a1', status: s };
    if (i === statuses.length - 1) api.attempt.mockResolvedValue(call); else api.attempt.mockResolvedValueOnce(call);
  });
};

describe('stage mapping (T119)', () => {
  test.each([
    ['SUBMITTED', 1], ['SCORING', 2], ['SCORED', 2], ['REPORT_READY', 3],
  ])('%s -> stage %i', (status, index) => expect(stageFor(status).index).toBe(index));

  test('quality hold, invalid and expired are terminal notices, not stages', () => {
    expect(stageFor('QUALITY_HOLD')).toEqual({ terminal: 'held' });
    expect(stageFor('INVALID')).toEqual({ terminal: 'invalid' });
    expect(stageFor('EXPIRED')).toEqual({ terminal: 'expired' });
  });

  test('a retryable report failure reads "Still preparing your report" and does not go backwards', () => {
    expect(stageFor('SCORED', 'FAILED_RETRYABLE')).toEqual({ index: 2, notice: 'Still preparing your report' });
  });
});

describe('generating page (T119)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('the stepper follows the mocked pipeline: SUBMITTED -> SCORING -> SCORED -> REPORT_READY', async () => {
    withStatuses('SUBMITTED', 'SCORING', 'SCORED', 'REPORT_READY');
    renderPage(<GeneratingReportPage pollMs={10} />);
    await screen.findByText(/Checking your responses \(in progress\)/);
    await screen.findByText(/Preparing your report \(in progress\)/);
    await screen.findByRole('link', { name: /view your report/i });
    for (const stage of STAGES) expect(screen.getByText(new RegExp(`${stage} \\(done\\)`))).toBeInTheDocument();
  });

  test('it never shows a percentage', async () => {
    withStatuses('SUBMITTED', 'SCORING', 'SCORED');
    const { container } = renderPage(<GeneratingReportPage pollMs={10} />);
    await screen.findByText(/Checking your responses/);
    await waitFor(() => expect(api.attempt.mock.calls.length).toBeGreaterThan(1));
    expect(pageText(container)).not.toMatch(/\d\s*%/);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  test('a quality hold shows the neutral review copy (T11) and stops polling', async () => {
    withStatuses('QUALITY_HOLD');
    const { container } = renderPage(<GeneratingReportPage pollMs={10} />);
    expect(await screen.findByText('Your responses are being reviewed.')).toBeInTheDocument();
    expect(pageText(container)).not.toMatch(/insight|personalis|because|reason/i);
    const calls = api.attempt.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(api.attempt.mock.calls.length).toBe(calls);
  });

  test('an invalid attempt shows the neutral administrative message (T12)', async () => {
    withStatuses('INVALID');
    renderPage(<GeneratingReportPage pollMs={10} />);
    expect(await screen.findByText('This attempt could not be processed for a report.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to support/i })).toBeInTheDocument();
  });

  test('a temporary network failure is announced calmly and polling continues', async () => {
    api.registrationState.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ attempt: { attemptId: 'a1', status: 'SUBMITTED' } });
    api.attempt.mockResolvedValue({ attemptId: 'a1', status: 'SUBMITTED' });
    renderPage(<GeneratingReportPage pollMs={300} />);           // the retry comes after 2 x pollMs, so the notice stays visible long enough to assert
    expect(await screen.findByText(/could not check on your report just now/i)).toBeInTheDocument();
    expect(await screen.findByText(/Checking your responses \(in progress\)/, {}, { timeout: 2000 })).toBeInTheDocument();
  });
});
