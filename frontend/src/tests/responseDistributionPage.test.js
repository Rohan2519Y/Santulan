import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import ResponseDistributionPage from '../pages/admin/ResponseDistributionPage';
import { questionSetApi, adminApi } from '../services/santulanApi';
import { renderPage } from './testUtils';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  questionSetApi: { list: jest.fn(), responseDistribution: jest.fn(), downloadResponseDistribution: jest.fn() },
  adminApi: { requestExport: jest.fn(), exportStatus: jest.fn(), downloadExport: jest.fn() },
}));

const SET = (over = {}) => ({
  setId: 's1', versionLabel: 'adolescent-pilot-v3.1', revision: 1, ageGroup: 'ADOLESCENT', status: 'FROZEN', participationState: 'OPEN',
  questionCount: 2, optionCount: 10, createdAt: '2026-09-20T10:00:00.000Z', ...over,
});

const DISTRIBUTION = (over = {}) => ({
  ...SET(),
  totalAttempts: 41,
  items: [
    {
      itemId: 'i1', itemCode: 'C1-01', domainCode: 'C1', displayOrder: 1, questionText: 'I notice how my body feels.', status: 'ACTIVE',
      options: [{ position: 1, text: 'Almost never', count: 7 }, { position: 2, text: 'Rarely', count: 13 }, { position: 3, text: 'Sometimes', count: 17 }],
      answeredCount: 37, skippedCount: 4,
    },
    {
      itemId: 'i2', itemCode: 'C1-02', domainCode: 'C1', displayOrder: 2, questionText: 'A retired question.', status: 'RETIRED',
      options: [{ position: 1, text: 'Almost never', count: 20 }, { position: 2, text: 'Rarely', count: 21 }],
      answeredCount: 41, skippedCount: 0,
    },
  ],
  ...over,
});

const renderIt = () => renderPage(<ResponseDistributionPage />);
const chooseAssessment = async () => {
  await screen.findByRole('option', { name: 'adolescent-pilot-v3.1 r1 · Adolescent' });
  await userEvent.selectOptions(screen.getByLabelText('Assessment'), 's1');
};

beforeEach(() => {
  jest.clearAllMocks();
  questionSetApi.list.mockResolvedValue({ sets: [SET()] });
});

describe('response distribution page', () => {
  test('prompts for an assessment before anything is chosen, and excludes drafts from the picker', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [SET(), SET({ setId: 'd1', versionLabel: 'draft-only', status: 'DRAFT' })] });
    renderIt();
    expect(await screen.findByText(/choose an assessment above/i)).toBeInTheDocument();
    expect(screen.queryByText(/draft-only/)).not.toBeInTheDocument();
    expect(questionSetApi.responseDistribution).not.toHaveBeenCalled();
  });

  test('shows per-question option counts and skip counts once an assessment is chosen', async () => {
    questionSetApi.responseDistribution.mockResolvedValue(DISTRIBUTION());
    renderIt();
    await screen.findByLabelText('Assessment');
    await chooseAssessment();
    expect(questionSetApi.responseDistribution).toHaveBeenCalledWith('s1');

    expect(await screen.findByText(/41 completed attempts/i)).toBeInTheDocument();
    expect(screen.getByText('C1-01 · C1')).toBeInTheDocument();
    expect(screen.getByText('I notice how my body feels.')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument(); // Rarely count for C1-01
    expect(screen.getByText('17')).toBeInTheDocument(); // Sometimes count for C1-01
    expect(screen.getByText('4')).toBeInTheDocument(); // skipped count for C1-01
    expect(screen.getAllByText(/skipped/i).length).toBeGreaterThan(0); // one "Skipped" bar per question
  });

  test('requests and downloads the full research export for the chosen assessment', async () => {
    questionSetApi.responseDistribution.mockResolvedValue(DISTRIBUTION());
    adminApi.requestExport.mockResolvedValue({ exportId: 'e1', status: 'READY' });
    adminApi.downloadExport.mockResolvedValue();
    renderIt();
    await chooseAssessment();
    await screen.findByText(/41 completed attempts/i);
    await userEvent.click(screen.getByRole('button', { name: /download excel/i }));
    await waitFor(() => expect(adminApi.downloadExport).toHaveBeenCalledWith('e1'));
    expect(adminApi.requestExport).toHaveBeenCalledWith(expect.objectContaining({ sourceAssessmentVersionId: 's1' }), expect.any(String));
    expect(adminApi.exportStatus).not.toHaveBeenCalled(); // already READY on request - no need to poll
  });

  test('polls until the export is ready before downloading it', async () => {
    questionSetApi.responseDistribution.mockResolvedValue(DISTRIBUTION());
    adminApi.requestExport.mockResolvedValue({ exportId: 'e1', status: 'REQUESTED' });
    adminApi.exportStatus.mockResolvedValueOnce({ status: 'GENERATING' }).mockResolvedValueOnce({ status: 'READY' });
    adminApi.downloadExport.mockResolvedValue();
    renderIt();
    await chooseAssessment();
    await screen.findByText(/41 completed attempts/i);
    await userEvent.click(screen.getByRole('button', { name: /download excel/i }));
    await waitFor(() => expect(adminApi.downloadExport).toHaveBeenCalledWith('e1'), { timeout: 10000 });
    expect(adminApi.exportStatus).toHaveBeenCalledTimes(2);
  }, 15000);

  test('a failed export shows the error state without crashing', async () => {
    questionSetApi.responseDistribution.mockResolvedValue(DISTRIBUTION());
    adminApi.requestExport.mockResolvedValue({ exportId: 'e1', status: 'FAILED' });
    renderIt();
    await chooseAssessment();
    await screen.findByText(/41 completed attempts/i);
    await userEvent.click(screen.getByRole('button', { name: /download excel/i }));
    expect(await screen.findByText(/export failed/i)).toBeInTheDocument();
    expect(adminApi.downloadExport).not.toHaveBeenCalled();
  });

  test('a request error shows the error state without crashing', async () => {
    questionSetApi.responseDistribution.mockResolvedValue(DISTRIBUTION());
    adminApi.requestExport.mockRejectedValue(new Error('export unavailable'));
    renderIt();
    await chooseAssessment();
    await screen.findByText(/41 completed attempts/i);
    await userEvent.click(screen.getByRole('button', { name: /download excel/i }));
    expect(await screen.findByText('export unavailable')).toBeInTheDocument();
  });

  test('marks a retired question as hidden from participants', async () => {
    questionSetApi.responseDistribution.mockResolvedValue(DISTRIBUTION());
    renderIt();
    await chooseAssessment();
    await screen.findByText('C1-02 · C1');
    expect(screen.getByText('Hidden from participants')).toBeInTheDocument();
  });

  test('a load failure shows the error state, not a crash', async () => {
    questionSetApi.responseDistribution.mockRejectedValue(new Error('offline'));
    renderIt();
    await chooseAssessment();
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  test('is axe-clean once results are shown', async () => {
    questionSetApi.responseDistribution.mockResolvedValue(DISTRIBUTION());
    const { container } = renderIt();
    await chooseAssessment();
    await waitFor(() => expect(screen.getByText(/41 completed attempts/i)).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});
