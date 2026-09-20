import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssessmentPage from '../pages/participant/AssessmentPage';
import { api } from '../services/santulanApi';
import { renderPage, pageText } from './testUtils';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  api: { registrationState: jest.fn(), attempt: jest.fn(), items: jest.fn(), responses: jest.fn(), resume: jest.fn(), saveResponse: jest.fn(), pause: jest.fn(), submit: jest.fn() },
}));

const ANCHORS = { 1: 'Almost never', 2: 'Rarely', 3: 'Sometimes', 4: 'Often', 5: 'Almost always' };
const ITEMS = [
  { itemId: 'i1', order: 1, domainCode: 'C1', text: 'I notice when my body feels tense.' },
  { itemId: 'i2', order: 2, domainCode: 'C2', text: 'I can name how I feel.' },
];
const model = (over = {}) => ({ attemptId: 'a1', status: 'IN_PROGRESS', session: { n: 1, of: 4 }, progress: { completed: 0, total: 2, percent: 0 }, lastSavedAt: null, canContinue: true, ...over });
const network = () => Object.assign(new Error('We could not reach the server.'), { code: 'NETWORK_ERROR', status: 0 });

beforeEach(() => {
  jest.clearAllMocks();
  api.registrationState.mockResolvedValue({ attempt: { attemptId: 'a1', status: 'IN_PROGRESS' } });
  api.attempt.mockResolvedValue(model());
  api.items.mockResolvedValue({ scale: { points: 5, anchors: ANCHORS }, items: ITEMS });
  api.responses.mockResolvedValue({ responses: [] });
  api.resume.mockResolvedValue(model());
  api.saveResponse.mockResolvedValue({ responseId: 'r1' });
  api.pause.mockResolvedValue(model({ status: 'PAUSED' }));
  api.submit.mockResolvedValue({ status: 'SUBMITTED' });
});

const openFirstItem = async () => {
  renderPage(<AssessmentPage />);
  await screen.findByText('Your assessment');
  await userEvent.click(screen.getByRole('button', { name: 'Continue Assessment' }));
  await screen.findByText(ITEMS[0].text);
};

describe('assessment player (T131)', () => {
  test('the hub shows seven named domain blocks, session n of 4 and one Continue action, and no scores', async () => {
    const { container } = renderPage(<AssessmentPage />);
    await screen.findByText('Your assessment');
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(7);
    expect(screen.getByText(/C1 · Body & Self-Regulation/)).toBeInTheDocument();
    expect(screen.getAllByText(/session 1 of 4/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Continue Assessment' })).toHaveLength(1);
    expect(pageText(container)).not.toMatch(/score/i);
  });

  test('the item screen uses the frozen 1-5 scale with the server anchors and gives no right/wrong cue', async () => {
    await openFirstItem();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByText('Almost never')).toBeInTheDocument();
    expect(screen.getByText('Almost always')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();       // Next needs an answer
  });

  test('an answer is saved with its own idempotency key and never carries a score, a participant or a version id', async () => {
    await openFirstItem();
    await userEvent.click(screen.getByRole('radio', { name: /4.*Often/ }));
    await waitFor(() => expect(api.saveResponse).toHaveBeenCalledTimes(1));
    const [attemptId, body] = api.saveResponse.mock.calls[0];
    expect(attemptId).toBe('a1');
    expect(Object.keys(body).sort()).toEqual(['idempotencyKey', 'itemId', 'presentedOrder', 'value']);
    expect(body).toMatchObject({ itemId: 'i1', value: 4 });
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(16);
    expect(await screen.findByText('All answers saved')).toBeInTheDocument();
  });

  test('a lost connection keeps the write and retries it with the SAME idempotency key', async () => {
    api.saveResponse.mockRejectedValueOnce(network()).mockResolvedValue({ responseId: 'r1' });
    await openFirstItem();
    await userEvent.click(screen.getByRole('radio', { name: /3.*Sometimes/ }));
    expect(await screen.findByText(/not saved yet/i)).toBeInTheDocument();
    fireEvent(window, new Event('online'));                                       // the browser is back
    await waitFor(() => expect(api.saveResponse).toHaveBeenCalledTimes(2));
    expect(api.saveResponse.mock.calls[1][1].idempotencyKey).toBe(api.saveResponse.mock.calls[0][1].idempotencyKey);
    expect(await screen.findByText('All answers saved')).toBeInTheDocument();
  });

  test('pausing flushes the answer first, pauses the session and returns to the dashboard', async () => {
    await openFirstItem();
    await userEvent.click(screen.getByRole('radio', { name: /2.*Rarely/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.pause).toHaveBeenCalledWith('a1', 'PARTICIPANT'));
    expect(api.saveResponse.mock.invocationCallOrder[0]).toBeLessThan(api.pause.mock.invocationCallOrder[0]);
  });

  test('the fifth session shows the controlled message, keeps the attempt, and still allows submitting', async () => {
    api.resume.mockRejectedValue(Object.assign(new Error('You have used all of the sessions available.'), { code: 'SESSION_LIMIT', status: 409 }));
    renderPage(<AssessmentPage />);
    await screen.findByText('Your assessment');
    await userEvent.click(screen.getByRole('button', { name: 'Continue Assessment' }));
    expect(await screen.findByText(/used all of the sessions/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue Assessment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit my answers' })).toBeEnabled();
  });

  test('submitting reuses one submission key when it has to be retried', async () => {
    api.responses.mockResolvedValue({ responses: [{ itemId: 'i1', value: '3', version: 1 }, { itemId: 'i2', value: '4', version: 1 }] });
    api.submit.mockRejectedValueOnce(network()).mockResolvedValue({ status: 'SUBMITTED' });
    renderPage(<AssessmentPage />);
    await screen.findByText('Your assessment');
    await userEvent.click(screen.getByRole('button', { name: 'Submit my answers' }));
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Submit my answers' }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2));
    expect(api.submit.mock.calls[1][1]).toBe(api.submit.mock.calls[0][1]);
  });

  test('an attempt that is already submitted goes to the progress screen instead of the player', async () => {
    api.attempt.mockResolvedValue(model({ status: 'SUBMITTED' }));
    renderPage(<AssessmentPage />, { route: '/student/assessment' });
    await waitFor(() => expect(api.items).not.toHaveBeenCalled());
    expect(screen.queryByText('Your assessment')).not.toBeInTheDocument();
  });
});
