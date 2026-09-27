import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import QuestionSetsPage from '../pages/admin/QuestionSetsPage';
import { ToastProvider } from '../components/Toast/Toast';
import { questionSetApi, ApiError } from '../services/santulanApi';
import { renderPage } from './testUtils';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  questionSetApi: { upload: jest.fn(), list: jest.fn(), get: jest.fn(), freeze: jest.fn(), open: jest.fn(), close: jest.fn(), delete: jest.fn(), setItemStatus: jest.fn(), downloadTemplate: jest.fn() },
}));

const SET = (over = {}) => ({
  setId: 's1', versionLabel: 'adolescent-pilot-v3.1', revision: 1, ageGroup: 'ADOLESCENT', status: 'DRAFT', participationState: 'CLOSED',
  questionCount: 10, optionCount: 50, contentHash: 'a'.repeat(64), sourceFileHash: 'b'.repeat(64), frozenAt: null, createdAt: '2026-09-20T10:00:00.000Z', ...over,
});

const file = (name = 'questions.xlsx', size = 1000) => {
  const f = new File(['x'.repeat(10)], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

const renderIt = () => renderPage(<ToastProvider><QuestionSetsPage /></ToastProvider>);
const upload = async (f) => userEvent.upload(document.querySelector('input[type="file"]'), f);

beforeEach(() => {
  jest.clearAllMocks();
  questionSetApi.list.mockResolvedValue({ sets: [] });
});

describe('question sets page (T082/T083)', () => {
  test('an empty list shows an empty state and the upload panel names the age groups', async () => {
    renderIt();
    expect(await screen.findByText(/no question sets yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/adolescent \(13–17\)/i)).toBeChecked();
    expect(screen.getByLabelText(/emerging adult \(18–25\)/i)).not.toBeChecked();
    expect(screen.getByRole('button', { name: /download template/i })).toBeInTheDocument();
  });

  test('uploading shows the accepted counts, the status and any warnings, and sends the chosen age group', async () => {
    questionSetApi.upload.mockResolvedValue({ ...SET(), created: true, supersededRevision: null, warnings: [{ code: 'DOMAIN_WITHOUT_QUESTIONS', message: 'No question covers C3 Relational & Social Capability', row: null, column: null }] });
    renderIt();
    await screen.findByText(/no question sets yet/i);
    await userEvent.click(screen.getByLabelText(/emerging adult/i));
    await upload(file());
    expect((await screen.findAllByText(/saved as a draft/i)).length).toBeGreaterThan(0);
    expect(questionSetApi.upload).toHaveBeenCalledWith(expect.any(File), 'EMERGING_ADULT');
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText(/no question covers c3/i)).toBeInTheDocument();
    await waitFor(() => expect(questionSetApi.list).toHaveBeenCalledTimes(2));
  });

  test('a 422 renders every problem with its row and column and says nothing was saved', async () => {
    questionSetApi.upload.mockRejectedValue(new ApiError('The file has 3 problems; nothing was saved.', {
      status: 422, code: 'UPLOAD_VALIDATION_FAILED', totalProblems: 3,
      details: [
        { row: 2, column: 'keying', code: 'KEYING_NOT_SUPPORTED', message: 'Only Positive keying is supported' },
        { row: 3, column: 'item_code', code: 'ITEM_CODE_DUPLICATE', message: 'item_code C1-01 already appears in row 2' },
        { row: null, column: null, code: 'FILE_UNREADABLE', message: 'The file could not be read' },
      ],
    }));
    renderIt();
    await screen.findByText(/no question sets yet/i);
    await upload(file());
    expect(await screen.findByText(/the file has 3 problems\. nothing was saved\./i)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /problems found/i });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('KEYING_NOT_SUPPORTED')).toBeInTheDocument();
    expect(within(table).getByText('item_code')).toBeInTheDocument();
  });

  test('the old-format message points to the template', async () => {
    questionSetApi.upload.mockRejectedValue(new ApiError('The file has 1 problem; nothing was saved.', {
      status: 422, code: 'UPLOAD_VALIDATION_FAILED', totalProblems: 1, details: [{ row: null, column: null, code: 'OLD_FORMAT_NOT_SUPPORTED', message: 'This file has no option columns.' }],
    }));
    renderIt();
    await screen.findByText(/no question sets yet/i);
    await upload(file());
    expect(await screen.findByText(/use the template/i)).toBeInTheDocument();
  });

  test('a wrong file type or an oversized file is refused before any request', async () => {
    renderIt();
    await screen.findByText(/no question sets yet/i);
    await userEvent.upload(document.querySelector('input[type="file"]'), file('notes.csv'), { applyAccept: false });
    expect(await screen.findByText(/must be an \.xlsx workbook/i)).toBeInTheDocument();
    await upload(file('big.xlsx', 3 * 1024 * 1024));
    expect(await screen.findByText(/larger than 2 MB/i)).toBeInTheDocument();
    expect(questionSetApi.upload).not.toHaveBeenCalled();
  });

  test('the list shows label, revision, status, participation and counts, and Review reads the questions with their options', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [SET(), SET({ setId: 's2', versionLabel: 'emerging-v1', ageGroup: 'EMERGING_ADULT', status: 'FROZEN', participationState: 'OPEN', questionCount: 7, optionCount: 21 })] });
    questionSetApi.get.mockResolvedValue({ ...SET(), questions: [{ itemId: 'i1', itemCode: 'C1-01', order: 1, domainCode: 'C1', subdomainCode: 'C1.1', subdomainName: 'Interoceptive Awareness', text: 'I notice how I feel.', keying: 'POSITIVE', ageBand: '13–25', context: 'General', layer: 'CORE', options: [{ position: 1, text: 'Never' }, { position: 2, text: 'Sometimes' }, { position: 3, text: 'Always' }] }] });
    renderIt();
    const table = await screen.findByRole('table', { name: /^question sets$/i });
    expect(within(table).getByText('adolescent-pilot-v3.1')).toBeInTheDocument();
    expect(within(table).getByText('OPEN')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /review adolescent-pilot-v3\.1 revision 1/i }));
    const opts = await screen.findByRole('list', { name: /options for c1-01/i });
    expect(within(opts).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Never', 'Sometimes', 'Always']);

    await userEvent.click(screen.getByRole('button', { name: 'Close review of adolescent-pilot-v3.1 revision 1' }));
    expect(screen.queryByRole('list', { name: /options for c1-01/i })).not.toBeInTheDocument();
    expect(screen.getByText('Nothing selected. Read every question and its options before freezing.')).toBeInTheDocument();
  });

  test('a question can be hidden from or shown to participants, but only once the set is frozen', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [SET({ status: 'FROZEN' })] });
    const active = { itemId: 'i1', itemCode: 'C1-01', order: 1, domainCode: 'C1', subdomainCode: 'C1.1', subdomainName: 'Interoceptive Awareness', text: 'I notice how I feel.', keying: 'POSITIVE', ageBand: '13–25', context: 'General', layer: 'CORE', status: 'ACTIVE', options: [{ position: 1, text: 'Never' }, { position: 2, text: 'Always' }] };
    const hidden = { ...active, itemId: 'i2', itemCode: 'C1-02', status: 'RETIRED' };
    questionSetApi.get.mockResolvedValue({ ...SET({ status: 'FROZEN' }), questions: [active, hidden] });
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /review adolescent-pilot-v3\.1 revision 1/i }));

    expect(await screen.findByRole('button', { name: 'Hide C1-01 from participants' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show C1-02 to participants' })).toBeInTheDocument();
    expect(screen.getByText('Hidden from participants')).toBeInTheDocument(); // C1-02's status pill only

    await userEvent.click(screen.getByRole('button', { name: 'Hide C1-01 from participants' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hide C1-01 from participants?' });
    expect(within(dialog).getByRole('button', { name: 'Hide' })).toBeDisabled(); // no reason yet
    await userEvent.type(within(dialog).getByRole('textbox'), 'flagged as ambiguous wording');
    questionSetApi.setItemStatus.mockResolvedValue({ itemId: 'i1', status: 'RETIRED' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hide' }));

    expect(questionSetApi.setItemStatus).toHaveBeenCalledWith('s1', 'i1', 'RETIRED', 'flagged as ambiguous wording');
    await waitFor(() => expect(questionSetApi.get).toHaveBeenCalledTimes(2)); // reloaded after the change
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('a refused hide (e.g. the last question showing in its domain) keeps the dialog open and shows the server\'s reason', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [SET({ status: 'FROZEN' })] });
    const only = { itemId: 'i1', itemCode: 'C1-01', order: 1, domainCode: 'C1', subdomainCode: 'C1.1', subdomainName: 'x', text: 'x', keying: 'POSITIVE', ageBand: '13–25', context: 'General', layer: 'CORE', status: 'ACTIVE', options: [{ position: 1, text: 'A' }, { position: 2, text: 'B' }] };
    questionSetApi.get.mockResolvedValue({ ...SET({ status: 'FROZEN' }), questions: [only] });
    questionSetApi.setItemStatus.mockRejectedValue(new ApiError('Domain C1 would have no question left showing for ADOLESCENT - every domain needs at least one', { status: 409, code: 'SET_INCOMPLETE' }));
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /review adolescent-pilot-v3\.1 revision 1/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hide C1-01 from participants' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hide C1-01 from participants?' });
    await userEvent.type(within(dialog).getByRole('textbox'), 'trying to hide the only one');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hide' }));
    expect(await within(dialog).findByText(/no question left showing for ADOLESCENT/)).toBeInTheDocument();
  });

  test('the show/hide button is not offered on a draft set - there is nothing to show or hide before freezing', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [SET()] }); // DRAFT
    questionSetApi.get.mockResolvedValue({ ...SET(), questions: [{ itemId: 'i1', itemCode: 'C1-01', order: 1, domainCode: 'C1', subdomainCode: 'C1.1', subdomainName: 'x', text: 'x', keying: 'POSITIVE', ageBand: '13–25', context: 'General', layer: 'CORE', status: 'ACTIVE', options: [{ position: 1, text: 'A' }, { position: 2, text: 'B' }] }] });
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /review adolescent-pilot-v3\.1 revision 1/i }));
    await screen.findByText('C1-01');
    expect(screen.queryByRole('button', { name: /hide c1-01|show c1-01/i })).not.toBeInTheDocument();
  });

  test('freeze is offered on drafts, open on frozen closed sets, close on open sets (US4)', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [SET(), SET({ setId: 's2', versionLabel: 'frozen-closed', status: 'FROZEN' }), SET({ setId: 's3', versionLabel: 'frozen-open', status: 'FROZEN', participationState: 'OPEN' })] });
    renderIt();
    await screen.findByRole('table', { name: /^question sets$/i });
    expect(screen.getByRole('button', { name: /freeze adolescent-pilot-v3\.1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open frozen-closed for participation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close frozen-open/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /freeze frozen-open/i })).not.toBeInTheDocument();
  });

  test('opening needs a reason of at least 3 characters before the confirm button works', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [SET({ status: 'FROZEN' })] });
    questionSetApi.open.mockResolvedValue({});
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /open adolescent-pilot-v3\.1 for participation/i }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /^open$/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'Pilot week 1');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(questionSetApi.open).toHaveBeenCalledWith('s1', 'Pilot week 1'));
  });

  test('a server refusal (another set is open) is shown, not swallowed', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [SET({ status: 'FROZEN' })] });
    questionSetApi.open.mockRejectedValue(new ApiError('Another question set is already open for this age group.', { status: 409, code: 'OPEN_SET_EXISTS' }));
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /open adolescent-pilot-v3\.1 for participation/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'Switch sets');
    await userEvent.click(within(dialog).getByRole('button', { name: /^open$/i }));
    expect(await screen.findByText(/already open for this age group/i)).toBeInTheDocument();
  });

  test('freeze that is blocked because a domain has no question shows the reason', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [SET()] });
    questionSetApi.freeze.mockRejectedValue(new ApiError('Every domain needs at least one eligible question; missing: C3, C5', { status: 409, code: 'SET_INCOMPLETE', details: { missingDomains: ['C3', 'C5'] } }));
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /freeze adolescent-pilot-v3\.1/i }));
    expect(await screen.findByText(/missing: c3, c5/i)).toBeInTheDocument();
  });

  test('the page has no accessibility violations', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [SET()] });
    const { container } = renderIt();
    await screen.findByRole('table', { name: /^question sets$/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
